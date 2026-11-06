import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { apagarRegistro, criarCarteira, editarCarteira, evolucao, salvarRegistro } from '../src/patrimonio.js';

// Dados fictícios (centavos): data, Corretora, Banco, Reserva, aportado
const PLANILHA = [
  ['2026-09-28', 6502334, 2746810, 48870, 0],
  ['2026-10-01', 6511904, 2751086, 77460, 28500],
  ['2026-10-04', 6518387, 2753940, 77505, 0],
  ['2026-10-07', 6524770, 3213027, 154566, 532950],
  ['2026-10-20', 6551496, 3226341, 155196, 0],
  ['2026-10-26', 6564974, 3233018, 155438, 0],
];

function bancoComPlanilha() {
  const db = openDb(':memory:');
  const ids = ['Corretora', 'Banco', 'Reserva'].map((nome) => criarCarteira(db, { nome }));
  for (const [data, pf, pj, nu, aporte] of PLANILHA) {
    salvarRegistro(db, data, { valores: { [ids[0]]: pf, [ids[1]]: pj, [ids[2]]: nu }, aporte });
  }
  return { db, ids };
}

test('cálculos batem com a planilha (total, saldo, ganho, dias, ganho por dia)', () => {
  const { db } = bancoComPlanilha();
  const { linhas, resumo } = evolucao(db);
  assert.deepEqual(linhas.map((l) => [l.total, l.variacao, l.ganho, l.dias, l.ganhoDia]), [
    [9298014, null, null, null, null],
    [9340450, 42436, 13936, 3, 4645],
    [9349832, 9382, 9382, 3, 3127],
    [9892363, 542531, 9581, 3, 3194],
    [9933033, 40670, 40670, 13, 3128],
    [9953430, 20397, 20397, 6, 3400],
  ]);
  assert.equal(resumo.atual, 9953430);
  assert.equal(resumo.aportadoTotal, 561450);
  assert.equal(resumo.ganhoTotal, 13936 + 9382 + 9581 + 40670 + 20397);
  assert.equal(resumo.diasTotal, 28);
  const soma = Object.values(linhas[0].participacao).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9);
});

test('substituir e apagar anotação; validações', () => {
  const { db, ids } = bancoComPlanilha();
  salvarRegistro(db, '2026-10-26', { valores: { [ids[0]]: 100 }, aporte: 0 });
  assert.deepEqual(evolucao(db).linhas.at(-1).valores, { [ids[0]]: 100 });
  apagarRegistro(db, '2026-10-26');
  assert.equal(evolucao(db).linhas.length, 5);
  assert.throws(() => salvarRegistro(db, '26/10/2026', { valores: { [ids[0]]: 1 } }), /Data inválida/);
  assert.throws(() => salvarRegistro(db, '2026-10-27', { valores: {} }), /pelo menos uma/);
  assert.throws(() => salvarRegistro(db, '2026-10-27', { valores: { 999: 1 } }), /não existe/);
  assert.throws(() => criarCarteira(db, { nome: 'corretora' }), /Já existe/);
  editarCarteira(db, ids[2], { nome: 'Poupança', ativa: false });
  assert.deepEqual(evolucao(db).carteiras.map((c) => [c.nome, c.ativa]), [['Corretora', 1], ['Banco', 1], ['Poupança', 0]]);
});

test('objetivo: progresso, previsão no ritmo atual e necessário por mês', async () => {
  const { criarObjetivo, editarObjetivo, removerObjetivo } = await import('../src/patrimonio.js');
  const { db } = bancoComPlanilha();
  assert.deepEqual(evolucao(db).objetivos, []);

  const id = criarObjetivo(db, { nome: 'Primeiro 120 mil', valorCentavos: 12000000, dataAlvo: '2027-10-26' });
  const [o] = evolucao(db).objetivos;
  assert.equal(o.id, id);
  assert.equal(o.falta, 12000000 - 9953430);
  assert.ok(Math.abs(o.progresso - 0.8294525) < 1e-6);
  // ritmo: (99.534,30 − 92.980,14) / 28 dias ≈ R$ 234,08/dia
  assert.equal(o.ritmoMes, Math.round(((9953430 - 9298014) / 28) * 30.4375));
  assert.equal(o.dataPrevista, '2027-01-22'); // 26/10 + ceil(2046570 / 23407,71) = 88 dias
  assert.equal(o.diasAteAlvo, 365);
  assert.equal(o.necessarioMes, Math.round((2046570 / 365) * 30.4375));
  assert.equal(o.noPrazo, true);
  // só 28 dias de anotações: sem base para os últimos 3 meses
  assert.equal(o.desde3m, null);
  assert.equal(o.ritmo3mMes, null);

  editarObjetivo(db, id, { valorCentavos: 5000000 });
  assert.equal(evolucao(db).objetivos[0].alcancado, true);
  assert.throws(() => criarObjetivo(db, { valorCentavos: 0 }), /maior que zero/);
  assert.throws(() => editarObjetivo(db, id, { valorCentavos: 1, dataAlvo: '31/12/2027' }), /Data inválida/);
  assert.throws(() => editarObjetivo(db, id + 99, { valorCentavos: 1 }), /não encontrado/);

  // vários objetivos, do menor para o maior valor
  const fase2 = criarObjetivo(db, { nome: 'Fase 2', valorCentavos: 50000000 });
  const fase1 = criarObjetivo(db, { nome: 'Fase 1', valorCentavos: 25000000 });
  assert.deepEqual(evolucao(db).objetivos.map((x) => [x.id, x.alcancado]), [[id, true], [fase1, false], [fase2, false]]);
  removerObjetivo(db, id);
  assert.deepEqual(evolucao(db).objetivos.map((x) => x.nome), ['Fase 1', 'Fase 2']);
  assert.throws(() => removerObjetivo(db, id), /não encontrado/);
});

test('objetivo com aporte desejado e anotações estimadas', async () => {
  const { criarObjetivo, apagarEstimados } = await import('../src/patrimonio.js');
  const { db, ids } = bancoComPlanilha();
  criarObjetivo(db, { valorCentavos: 25000000, aporteDesejadoCentavos: 500000 });
  const o = evolucao(db).objetivos[0];
  // taxa média sem aportes ≈ 1,05% a.m. sobre o patrimônio; rendimento hoje = taxa × atual
  assert.ok(o.taxaMes > 0.0100 && o.taxaMes < 0.0112, String(o.taxaMes));
  assert.equal(o.rendimentoMes, Math.round(o.taxaMes * 9953430));
  assert.equal(o.ritmoPlanejadoMes, o.rendimentoMes + 500000);
  assert.equal(o.mesAtual, '2026-10');
  assert.equal(o.aportadoMes, 28500 + 532950);
  assert.ok(o.dataPrevistaPlanejada > '2026-10-26');
  assert.throws(() => criarObjetivo(db, { valorCentavos: 1, aporteDesejadoCentavos: -1 }), /Aporte/);

  // estimada antes da primeira real: não entra no resumo, mas entra no histórico do objetivo
  salvarRegistro(db, '2026-08-31', { valores: { [ids[0]]: 6000000 }, aporte: 0, estimado: true });
  const ev = evolucao(db);
  assert.equal(ev.linhas[0].estimado, true);
  assert.equal(ev.resumo.desde, '2026-09-28');
  assert.equal(ev.objetivos[0].desde3m, null); // 31/08 é posterior a 26/07

  // últimos 3 meses: parte da anotação mais recente até 26/07 (31/05 ignora a de 30/04)
  salvarRegistro(db, '2026-04-30', { valores: { [ids[0]]: 3000000 }, aporte: 0, estimado: true });
  salvarRegistro(db, '2026-05-31', { valores: { [ids[0]]: 5000000 }, aporte: 0, estimado: true });
  const o3 = evolucao(db).objetivos[0];
  assert.equal(o3.desde3m, '2026-05-31');
  assert.equal(o3.ritmo3mMes, Math.round(((9953430 - 5000000) / 148) * 30.4375));
  assert.equal(o3.dataPrevista3m, '2028-01-19'); // 26/10 + ceil(15046570 / 33468,04) = 450 dias
  assert.equal(apagarEstimados(db).apagadas, 3);
  assert.equal(evolucao(db).linhas[0].data, '2026-09-28');
});

test('resumo: rendimento anualizado e variação desde a anotação anterior', () => {
  const { db } = bancoComPlanilha();
  const { resumo } = evolucao(db);
  assert.ok(resumo.taxaMes > 0.0100 && resumo.taxaMes < 0.0112, String(resumo.taxaMes));
  assert.ok(Math.abs(resumo.rendimentoAno - ((1 + resumo.taxaMes) ** 12 - 1)) < 1e-12);
  // ganho por dia no patrimônio da última anotação (R$ 99.534,30)
  assert.equal(resumo.ganhoDiaHoje, Math.round((resumo.taxaMes * 9953430) / 30.4375));
  assert.deepEqual(resumo.ultimo, { variacao: 20397, ganho: 20397, aportado: 0, dias: 6 });
  apagarRegistro(db, '2026-10-26');
  for (const d of ['2026-10-20', '2026-10-07', '2026-10-04', '2026-10-01']) apagarRegistro(db, d);
  assert.equal(evolucao(db).resumo.ultimo, null);
  assert.equal(evolucao(db).resumo.taxaMes, null);
});

test('ritmo sem objetivo: aporte médio e patrimônio para o rendimento superar o aporte', () => {
  const { db } = bancoComPlanilha();
  const { objetivos, ritmo } = evolucao(db);
  assert.deepEqual(objetivos, []);
  // aportes de 285,00 + 5.329,50 em 28 dias
  assert.equal(ritmo.aporteMedioMes, Math.round((561450 / 28) * 30.4375));
  assert.equal(ritmo.patrimonioRendeAporte, Math.round(ritmo.aporteMedioMes / ritmo.taxaMes));
  assert.equal(ritmo.desde3m, null);
  assert.equal(ritmo.aporte3mMes, null);
  assert.equal(ritmo.patrimonioRendeAporte3m, null);
  assert.equal(ritmo.ritmoDia, undefined); // interno, não vai para a tela
});

test('resumo soma o ganho das estimativas entre duas anotações reais', () => {
  const db = openDb(':memory:');
  const id = criarCarteira(db, { nome: 'PF' });
  salvarRegistro(db, '2026-01-31', { valores: { [id]: 1000000 } });
  salvarRegistro(db, '2026-02-28', { valores: { [id]: 1110000 }, aporte: 100000, estimado: true });
  salvarRegistro(db, '2026-03-31', { valores: { [id]: 1130000 } });
  salvarRegistro(db, '2026-04-30', { valores: { [id]: 1200000 }, estimado: true }); // depois da última real: fora
  const { resumo } = evolucao(db);
  assert.equal(resumo.desde, '2026-01-31');
  assert.equal(resumo.atual, 1130000);
  assert.equal(resumo.aportadoTotal, 100000);
  assert.equal(resumo.ganhoTotal, 10000 + 20000);
});

test('aporte extraordinário conta no ganho, mas fica fora da média de aportes', () => {
  const db = openDb(':memory:');
  const id = criarCarteira(db, { nome: 'PF' });
  salvarRegistro(db, '2026-01-31', { valores: { [id]: 1000000 } });
  salvarRegistro(db, '2026-03-02', { valores: { [id]: 5110000 }, aporte: 4100000, extraordinario: 4000000 });
  const { linhas, ritmo, resumo } = evolucao(db);
  assert.equal(linhas[1].ganho, 10000);
  assert.equal(linhas[1].extraordinario, 4000000);
  assert.equal(resumo.aportadoTotal, 4100000);
  assert.equal(resumo.extraordinarioTotal, 4000000);
  assert.equal(ritmo.aporteMedioMes, Math.round((100000 / 30) * 30.4375));
  assert.throws(() => salvarRegistro(db, '2026-03-02', { valores: { [id]: 1 }, aporte: 100, extraordinario: 101 }), /extraordinário/);
  assert.throws(() => salvarRegistro(db, '2026-03-02', { valores: { [id]: 1 }, aporte: -100, extraordinario: 1 }), /extraordinário/);
});
