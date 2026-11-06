import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import { apagarConta, editarConta, lancarConta } from '../src/contas.js';
import { criarCategoria, criarRegra } from '../src/categorias.js';
import { importacoes, resumo, transacoes } from '../src/consultas.js';
import { assinaturas, ultimaReferencia } from '../src/analises.js';
import { apagarBanco } from '../src/bancos.js';

const csv = (linhas) => Buffer.from(`date,title,amount\n${linhas.join('\n')}\n`);

async function banco() {
  const db = openDb(':memory:');
  await importar(db, { nome: 'Nubank_2026-10-14.csv', buffer: csv(['2026-10-05,Mercadinho,100.00']) });
  return db;
}

test('conta lançada entra no resumo do mês do vencimento', async () => {
  const db = await banco();
  const casa = criarCategoria(db, 'Moradia');
  lancarConta(db, { data: '2026-10-10', descricao: 'Aluguel', valorCentavos: 150000, categoriaId: casa });

  const r = resumo(db, { de: '2026-10', ate: '2026-10' });
  assert.equal(r.total, 10000 + 150000);
  assert.equal(r.porCategoria.find((c) => c.nome === 'Moradia').total, 150000);
  assert.deepEqual({ ...r.porMesBanco.find((m) => m.banco === 'contas') }, { referencia: '2026-10', banco: 'contas', total: 150000 });
  const t = transacoes(db, { banco: 'contas' })[0];
  assert.equal(t.manual, 1);
  assert.equal(t.categoria_origem, 'manual');
  assert.equal(resumo(db, { de: '2026-11', ate: '2026-11' }).total, 0);
});

test('sem categoria, as regras decidem; a categoria escolhida tem prioridade', async () => {
  const db = await banco();
  const luz = criarCategoria(db, 'Energia');
  const outra = criarCategoria(db, 'Outra');
  criarRegra(db, { padrao: 'ENEL', categoria: luz });

  const { id } = lancarConta(db, { data: '2026-10-12', descricao: 'Enel conta de luz', valorCentavos: 23456 });
  let t = transacoes(db, { banco: 'contas' })[0];
  assert.equal(t.categoria_id, luz);
  assert.equal(t.categoria_origem, 'regra');

  editarConta(db, id, { categoriaId: outra });
  t = transacoes(db, { banco: 'contas' })[0];
  assert.equal(t.categoria_id, outra);
  assert.equal(t.categoria_origem, 'manual');

  editarConta(db, id, { categoriaId: null }); // volta às regras
  assert.equal(transacoes(db, { banco: 'contas' })[0].categoria_id, luz);
});

test('editar a data troca o mês; apagar a última conta do mês limpa a fatura', async () => {
  const db = await banco();
  const { id } = lancarConta(db, { data: '2026-10-10', descricao: 'Internet', valorCentavos: 9990 });
  editarConta(db, id, { data: '2026-11-10', valorCentavos: 10990, descricao: 'Internet fibra' });

  const t = transacoes(db, { banco: 'contas' })[0];
  assert.deepEqual([t.referencia, t.data, t.valor_centavos, t.descricao], ['2026-11', '2026-11-10', 10990, 'Internet fibra']);
  // o mês de outubro ficou vazio e foi removido
  assert.equal(db.prepare("SELECT count(*) AS n FROM faturas WHERE banco = 'contas'").get().n, 1);

  apagarConta(db, id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM faturas WHERE banco = 'contas'").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM importacoes WHERE formato = 'manual'").get().n, 0);
});

test('lançamentos importados não são editados nem apagados como conta', async () => {
  const db = await banco();
  const importada = transacoes(db, {})[0].id;
  assert.throws(() => editarConta(db, importada, { valorCentavos: 1 }), /lançadas à mão/);
  assert.throws(() => apagarConta(db, importada), /lançadas à mão/);
  assert.throws(() => lancarConta(db, { data: '2026-10-10', descricao: 'X', valorCentavos: 0 }), /maior que zero/);
  assert.throws(() => lancarConta(db, { data: '10/10/2026', descricao: 'X', valorCentavos: 1 }), /Data inválida/);
  assert.throws(() => lancarConta(db, { data: '2026-10-10', descricao: '  ', valorCentavos: 1 }), /descrição/);
  assert.throws(() => apagarBanco(db, 'contas'), /não pode ser apagado/);
});

test('contas não mudam o mês padrão, a lista de importações nem as assinaturas', async () => {
  const db = await banco();
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-12']) {
    lancarConta(db, { data: `${m}-05`, descricao: 'Condomínio', valorCentavos: 50000 });
  }
  assert.equal(ultimaReferencia(db), '2026-10'); // a conta de dezembro não conta
  assert.equal(importacoes(db).length, 1);
  assert.equal(assinaturas(db).sugestoes.filter((s) => s.banco === 'contas').length, 0);
});
