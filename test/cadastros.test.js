import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import {
  apagarCategoria, apagarGrupo, buscarCategoria, criarCategoria, criarGrupo, criarRegra, definirCategoria, editarCategoria, renomearGrupo,
} from '../src/categorias.js';
import { resumo } from '../src/consultas.js';
import { definirOrcamento } from '../src/analises.js';
import { apagarBanco, criarBanco, definirApelidoCartao, editarBanco, listarBancos } from '../src/bancos.js';

async function banco() {
  const db = openDb(':memory:');
  await importar(db, {
    nome: 'Nubank_2026-03-14.csv',
    buffer: Buffer.from('date,title,amount\n2026-03-01,Supermercado Bom,100.00\n2026-03-02,Loja Rara,40.00\n2026-03-03,Loja Rara,10.00\n'),
  });
  return db;
}
const cat = (db, desc) => db.prepare('SELECT categoria_id FROM transacoes WHERE descricao = ?').get(desc).categoria_id;

test('categoria: criar, renomear, trocar cor e validar duplicadas', async () => {
  const db = await banco();
  const id = criarCategoria(db, 'Viagem', '#AABBCC');
  assert.equal(buscarCategoria(db, id).cor, '#aabbcc');
  assert.throws(() => criarCategoria(db, ' viagem '), /já existe/);
  assert.throws(() => criarCategoria(db, 'X', 'azul'), /Cor inválida/);

  editarCategoria(db, id, { nome: 'Viagens' });
  assert.equal(buscarCategoria(db, id).nome, 'Viagens');
  assert.equal(buscarCategoria(db, id).cor, '#aabbcc'); // cor não mudou
  editarCategoria(db, id, { nome: 'VIAGENS' }); // mesma categoria, só caixa
  assert.throws(() => editarCategoria(db, id, { nome: 'Mercado' }), /já existe/);
  assert.throws(() => editarCategoria(db, id, { nome: '  ' }), /Informe/);
});

test('categoria: apagar movendo lançamentos, regras e orçamento', async () => {
  const db = await banco();
  const viagem = criarCategoria(db, 'Viagem');
  const lazer = buscarCategoria(db, 'Lazer/Jogos').id;
  criarRegra(db, { padrao: 'LOJA RARA', categoria: viagem });
  definirOrcamento(db, viagem, 50000);
  assert.equal(cat(db, 'Loja Rara'), viagem);

  const r = apagarCategoria(db, viagem, { moverPara: lazer });
  assert.equal(r.lancamentos, 2);
  assert.equal(cat(db, 'Loja Rara'), lazer);
  assert.equal(db.prepare("SELECT categoria_id FROM regras WHERE padrao = 'LOJA RARA'").get().categoria_id, lazer);
  assert.equal(db.prepare('SELECT limite_centavos FROM orcamentos WHERE categoria_id = ?').get(lazer).limite_centavos, 50000);
  assert.throws(() => buscarCategoria(db, viagem), /não encontrada/);
});

test('categoria: apagar sem mover deixa sem categoria, apaga regras e respeita reclassificação', async () => {
  const db = await banco();
  const viagem = criarCategoria(db, 'Viagem');
  criarRegra(db, { padrao: 'LOJA RARA', categoria: viagem });
  const t = db.prepare("SELECT id FROM transacoes WHERE descricao = 'Supermercado Bom'").get().id;
  definirCategoria(db, t, viagem); // manual
  apagarCategoria(db, viagem);
  assert.equal(cat(db, 'Loja Rara'), null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM regras WHERE padrao = 'LOJA RARA'").get().n, 0);
  // o manual apagado volta para o automático: "SUPERMERCADO" é regra padrão de Mercado
  assert.equal(cat(db, 'Supermercado Bom'), buscarCategoria(db, 'Mercado').id);
  assert.throws(() => apagarCategoria(db, buscarCategoria(db, 'Mercado').id, { moverPara: buscarCategoria(db, 'Mercado').id }), /outra/);
});

test('bancos: cadastro automático na importação, edição, validação e apelido de cartão', async () => {
  const db = await banco();
  const nubank = listarBancos(db).find((b) => b.codigo === 'nubank');
  assert.equal(nubank.nome, 'Nubank');
  assert.equal(nubank.lancamentos, 3);

  editarBanco(db, 'nubank', { nome: 'Nu Roxinho', cor: '#112233', diaFechamento: 7, diaVencimento: 14, limiteCentavos: 500000 });
  const b = listarBancos(db).find((x) => x.codigo === 'nubank');
  assert.deepEqual([b.nome, b.cor, b.dia_fechamento, b.dia_vencimento, b.limite_centavos], ['Nu Roxinho', '#112233', 7, 14, 500000]);
  assert.throws(() => editarBanco(db, 'nubank', { diaVencimento: 32 }), /entre 1 e 31/);
  assert.throws(() => editarBanco(db, 'nubank', { nome: 'inter' }), /Já existe/);
  assert.throws(() => apagarBanco(db, 'nubank'), /lançamentos/);

  const { codigo } = criarBanco(db, { nome: 'Itaú Personnalité', cor: '#ff6600' });
  assert.equal(codigo, 'itau-personnalite');
  apagarBanco(db, codigo);
  assert.ok(!listarBancos(db).some((x) => x.codigo === codigo));
  assert.throws(() => definirApelidoCartao(db, 'nubank', '9999', 'x'), /não encontrado/);
});

test('grupos: criar, renomear, agrupar categorias e apagar', async () => {
  const db = await banco();
  const alim = criarGrupo(db, 'Alimentação');
  assert.throws(() => criarGrupo(db, ' alimentacao '), /O grupo "Alimentação" já existe/);
  assert.throws(() => criarGrupo(db, ' '), /Informe o nome do grupo/);
  renomearGrupo(db, alim, 'Comida');

  const mercado = buscarCategoria(db, 'Mercado').id;
  editarCategoria(db, mercado, { grupoId: alim });
  assert.equal(buscarCategoria(db, mercado).grupo_id, alim);
  editarCategoria(db, mercado, { nome: 'Supermercado' }); // grupo fica
  assert.equal(buscarCategoria(db, mercado).grupo_id, alim);
  assert.throws(() => editarCategoria(db, mercado, { grupoId: 999 }), /Grupo não encontrado/);

  const linha = resumo(db, {}).porCategoria.find((c) => c.id === mercado);
  assert.equal(linha.grupoId, alim);
  assert.equal(linha.grupo, 'Comida');

  assert.deepEqual(apagarGrupo(db, alim), { categorias: 1 });
  assert.equal(buscarCategoria(db, mercado).grupo_id, null);
  editarCategoria(db, mercado, { grupoId: null });
});
