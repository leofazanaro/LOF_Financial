import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import { lancarConta } from '../src/contas.js';
import { transacoes } from '../src/consultas.js';
import { definirDesconsiderada } from '../src/desconsiderar.js';
import { criarCarteira, salvarRegistro } from '../src/patrimonio.js';
import { apagarRenda, balanco, editarRenda, lancarRenda, listarRendas, repetirMesAnterior } from '../src/renda.js';

const csv = (linhas) => Buffer.from(`date,title,amount\n${linhas.join('\n')}\n`);

async function banco() {
  const db = openDb(':memory:');
  await importar(db, { nome: 'Nubank_2026-10-14.csv', buffer: csv(['2026-10-05,Mercadinho,100.00', '2026-10-06,Padaria,20.00']) });
  return db;
}

test('lança, edita, lista por período e apaga renda', async () => {
  const db = await banco();
  const { id } = lancarRenda(db, { data: '2026-10-05', descricao: ' Salário ', valorCentavos: 500000 });
  lancarRenda(db, { data: '2026-09-05', descricao: 'Salário', valorCentavos: 480000 });
  assert.deepEqual(listarRendas(db, { de: '2026-10', ate: '2026-10' }).map((r) => ({ ...r })),
    [{ id, data: '2026-10-05', descricao: 'Salário', valor_centavos: 500000 }]);
  editarRenda(db, id, { valorCentavos: 510000 });
  assert.equal(listarRendas(db, { de: '2026-10' })[0].valor_centavos, 510000);
  assert.equal(listarRendas(db).length, 2);
  apagarRenda(db, id);
  assert.equal(listarRendas(db, { de: '2026-10' }).length, 0);
  assert.throws(() => apagarRenda(db, id), /não encontrado/);
});

test('valida data, descrição e valor', async () => {
  const db = await banco();
  assert.throws(() => lancarRenda(db, { data: '2026-13-01', descricao: 'x', valorCentavos: 1 }), /Data/);
  assert.throws(() => lancarRenda(db, { data: '2026-10-01', descricao: '  ', valorCentavos: 1 }), /descrição/);
  assert.throws(() => lancarRenda(db, { data: '2026-10-01', descricao: 'x', valorCentavos: 0 }), /valor/);
  assert.throws(() => editarRenda(db, 999, { descricao: 'x' }), /não encontrado/);
});

test('balanço do mês: renda − gastos (cartão + contas) − aportes; desconsiderado não entra', async () => {
  const db = await banco();
  lancarRenda(db, { data: '2026-10-05', descricao: 'Salário', valorCentavos: 500000 });
  lancarConta(db, { data: '2026-10-10', descricao: 'Aluguel', valorCentavos: 150000 });
  const c = criarCarteira(db, { nome: 'Tesouro' });
  salvarRegistro(db, '2026-10-07', { valores: { [c]: 93500 }, aporte: 93500 });
  const padaria = transacoes(db, {}).find((t) => t.descricao === 'Padaria');
  definirDesconsiderada(db, [padaria.id], true);

  const b = balanco(db, { de: '2026-10', ate: '2026-10' });
  assert.deepEqual(b, { renda: 500000, gastos: 10000 + 150000, investido: 93500, sobra: 500000 - 160000 - 93500, rendimento: null, mesesSemRenda: [] });
});

test('período com vários meses aponta meses sem renda; resgate reduz o investido', async () => {
  const db = await banco();
  lancarConta(db, { data: '2026-09-10', descricao: 'Aluguel', valorCentavos: 150000 });
  lancarRenda(db, { data: '2026-10-05', descricao: 'Salário', valorCentavos: 500000 });
  const c = criarCarteira(db, { nome: 'Tesouro' });
  salvarRegistro(db, '2026-09-07', { valores: { [c]: 100000 }, aporte: 100000 });
  salvarRegistro(db, '2026-10-07', { valores: { [c]: 70000 }, aporte: -30000 });

  const b = balanco(db, {});
  assert.equal(b.investido, 70000);
  assert.equal(b.gastos, 12000 + 150000);
  assert.deepEqual(b.mesesSemRenda, ['2026-09']);
  assert.equal(balanco(db, { de: '2026-10', ate: '2026-10' }).investido, -30000);
});

test('rendimento do período: variação menos aporte das anotações no período', async () => {
  const db = await banco();
  const c = criarCarteira(db, { nome: 'Tesouro' });
  salvarRegistro(db, '2026-08-31', { valores: { [c]: 100000 } });
  salvarRegistro(db, '2026-09-30', { valores: { [c]: 151000 }, aporte: 50000 }); // rendeu 1.000
  salvarRegistro(db, '2026-10-31', { valores: { [c]: 152500 } });                // rendeu 1.500
  assert.equal(balanco(db, { de: '2026-09', ate: '2026-09' }).rendimento, 1000);
  assert.equal(balanco(db, {}).rendimento, 2500);
  assert.equal(balanco(db, { de: '2026-11', ate: '2026-11' }).rendimento, null);
});

test('repete a renda do mês anterior, ajustando o dia ao fim do mês', async () => {
  const db = await banco();
  lancarRenda(db, { data: '2027-01-31', descricao: 'Salário', valorCentavos: 500000 });
  lancarRenda(db, { data: '2027-01-15', descricao: 'Aluguel recebido', valorCentavos: 80000 });
  assert.deepEqual(repetirMesAnterior(db, '2027-02'), { qtd: 2 });
  assert.deepEqual(listarRendas(db, { de: '2027-02', ate: '2027-02' }).map((r) => [r.data, r.descricao, r.valor_centavos]),
    [['2027-02-28', 'Salário', 500000], ['2027-02-15', 'Aluguel recebido', 80000]]);
  assert.throws(() => repetirMesAnterior(db, '2027-02'), /já tem renda/);
  assert.throws(() => repetirMesAnterior(db, '2027-05'), /não tem renda/);
  lancarRenda(db, { data: '2026-12-10', descricao: 'Bônus', valorCentavos: 1000 });
  assert.throws(() => repetirMesAnterior(db, '2026-12'), /já tem renda/);
});
