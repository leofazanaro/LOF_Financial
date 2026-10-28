import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { apagarRegistro, criarCarteira, editarCarteira, evolucao, salvarRegistro } from '../src/patrimonio.js';

// Dados da planilha do usuário (centavos): data, Inter PF, Inter PJ, Nu, aportado
const PLANILHA = [
  ['2026-09-28', 11407604, 4818965, 85737, 0],
  ['2026-10-01', 11424393, 4826467, 135894, 50000],
  ['2026-10-04', 11435767, 4831473, 135974, 0],
  ['2026-10-07', 11446965, 5636889, 271169, 935000],
  ['2026-10-20', 11493853, 5660247, 272273, 0],
  ['2026-10-26', 11517499, 5671961, 272699, 0],
];

function bancoComPlanilha() {
  const db = openDb(':memory:');
  const ids = ['Inter PF', 'Inter PJ', 'Nu'].map((nome) => criarCarteira(db, { nome }));
  for (const [data, pf, pj, nu, aporte] of PLANILHA) {
    salvarRegistro(db, data, { valores: { [ids[0]]: pf, [ids[1]]: pj, [ids[2]]: nu }, aporte });
  }
  return { db, ids };
}

test('cálculos batem com a planilha (total, saldo, ganho, dias, ganho por dia)', () => {
  const { db } = bancoComPlanilha();
  const { linhas, resumo } = evolucao(db);
  assert.deepEqual(linhas.map((l) => [l.total, l.variacao, l.ganho, l.dias, l.ganhoDia]), [
    [16312306, null, null, null, null],
    [16386754, 74448, 24448, 3, 8149],
    [16403214, 16460, 16460, 3, 5487],
    [17355023, 951809, 16809, 3, 5603],
    [17426373, 71350, 71350, 13, 5488],
    [17462159, 35786, 35786, 6, 5964],
  ]);
  assert.equal(resumo.atual, 17462159);
  assert.equal(resumo.aportadoTotal, 985000);
  assert.equal(resumo.ganhoTotal, 24448 + 16460 + 16809 + 71350 + 35786);
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
  assert.throws(() => criarCarteira(db, { nome: 'inter pf' }), /Já existe/);
  editarCarteira(db, ids[2], { nome: 'Nubank', ativa: false });
  assert.deepEqual(evolucao(db).carteiras.map((c) => [c.nome, c.ativa]), [['Inter PF', 1], ['Inter PJ', 1], ['Nubank', 0]]);
});

test('objetivo: progresso, previsão no ritmo atual e necessário por mês', async () => {
  const { definirObjetivo, removerObjetivo } = await import('../src/patrimonio.js');
  const { db } = bancoComPlanilha();
  assert.equal(evolucao(db).objetivo, null);

  definirObjetivo(db, { nome: 'Primeiro 200 mil', valorCentavos: 20000000, dataAlvo: '2027-10-26' });
  const o = evolucao(db).objetivo;
  assert.equal(o.falta, 20000000 - 17462159);
  assert.ok(Math.abs(o.progresso - 0.87310795) < 1e-6);
  // ritmo: (174.621,59 − 163.123,06) / 28 dias ≈ R$ 410,66/dia
  assert.equal(o.ritmoMes, Math.round(((17462159 - 16312306) / 28) * 30.4375));
  assert.equal(o.dataPrevista, '2026-12-27'); // 26/10 + ceil(2537841 / 41066,18) = 62 dias
  assert.equal(o.diasAteAlvo, 365);
  assert.equal(o.necessarioMes, Math.round((2537841 / 365) * 30.4375));
  assert.equal(o.noPrazo, true);
  // só 28 dias de anotações: sem base para os últimos 3 meses
  assert.equal(o.desde3m, null);
  assert.equal(o.ritmo3mMes, null);

  definirObjetivo(db, { valorCentavos: 10000000 });
  assert.equal(evolucao(db).objetivo.alcancado, true);
  assert.throws(() => definirObjetivo(db, { valorCentavos: 0 }), /maior que zero/);
  assert.throws(() => definirObjetivo(db, { valorCentavos: 1, dataAlvo: '31/12/2027' }), /Data inválida/);
  removerObjetivo(db);
  assert.equal(evolucao(db).objetivo, null);
});

test('objetivo com aporte desejado e anotações estimadas', async () => {
  const { definirObjetivo, apagarEstimados } = await import('../src/patrimonio.js');
  const { db, ids } = bancoComPlanilha();
  definirObjetivo(db, { valorCentavos: 25000000, aporteDesejadoCentavos: 500000 });
  const o = evolucao(db).objetivo;
  // taxa média sem aportes ≈ 1,06% a.m. sobre o patrimônio; rendimento hoje = taxa × atual
  assert.ok(o.taxaMes > 0.0100 && o.taxaMes < 0.0112, String(o.taxaMes));
  assert.equal(o.rendimentoMes, Math.round(o.taxaMes * 17462159));
  assert.equal(o.ritmoPlanejadoMes, o.rendimentoMes + 500000);
  assert.equal(o.mesAtual, '2026-10');
  assert.equal(o.aportadoMes, 50000 + 935000);
  assert.ok(o.dataPrevistaPlanejada > '2026-10-26');
  assert.throws(() => definirObjetivo(db, { valorCentavos: 1, aporteDesejadoCentavos: -1 }), /Aporte/);

  // estimada antes da primeira real: não entra no resumo, mas entra no histórico do objetivo
  salvarRegistro(db, '2026-08-31', { valores: { [ids[0]]: 10000000 }, aporte: 0, estimado: true });
  const ev = evolucao(db);
  assert.equal(ev.linhas[0].estimado, true);
  assert.equal(ev.resumo.desde, '2026-09-28');
  assert.equal(ev.objetivo.desde3m, null); // 31/08 é posterior a 26/07

  // últimos 3 meses: parte da anotação mais recente até 26/07 (31/05 ignora a de 30/04)
  salvarRegistro(db, '2026-04-30', { valores: { [ids[0]]: 5000000 }, aporte: 0, estimado: true });
  salvarRegistro(db, '2026-05-31', { valores: { [ids[0]]: 9000000 }, aporte: 0, estimado: true });
  const o3 = evolucao(db).objetivo;
  assert.equal(o3.desde3m, '2026-05-31');
  assert.equal(o3.ritmo3mMes, Math.round(((17462159 - 9000000) / 148) * 30.4375));
  assert.equal(o3.dataPrevista3m, '2027-03-07'); // 26/10 + ceil(7537841 / 57176,75) = 132 dias
  assert.equal(apagarEstimados(db).apagadas, 3);
  assert.equal(evolucao(db).linhas[0].data, '2026-09-28');
});

test('resumo: rendimento anualizado e variação desde a anotação anterior', () => {
  const { db } = bancoComPlanilha();
  const { resumo } = evolucao(db);
  assert.ok(resumo.taxaMes > 0.0100 && resumo.taxaMes < 0.0112, String(resumo.taxaMes));
  assert.ok(Math.abs(resumo.rendimentoAno - ((1 + resumo.taxaMes) ** 12 - 1)) < 1e-12);
  assert.deepEqual(resumo.ultimo, { variacao: 35786, ganho: 35786, aportado: 0, dias: 6 });
  apagarRegistro(db, '2026-10-26');
  for (const d of ['2026-10-20', '2026-10-07', '2026-10-04', '2026-10-01']) apagarRegistro(db, d);
  assert.equal(evolucao(db).resumo.ultimo, null);
  assert.equal(evolucao(db).resumo.taxaMes, null);
});
