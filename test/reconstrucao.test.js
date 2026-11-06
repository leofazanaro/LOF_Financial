import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstruir } from '../src/reconstrucao.js';

const DIA = 86400000;
const dias = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA;

// Simula para frente com o mesmo modelo e confere que chega no valor real (âncora).
function simular(inicio, dataInicio, pontosAportes, ate, taxaMes) {
  const f = (n) => (1 + taxaMes) ** (n / 30.4375);
  let v = inicio, d = dataInicio;
  for (const { ref, valor } of pontosAportes) {
    const fim = new Date(Date.UTC(+ref.slice(0, 4), +ref.slice(5), 0)).toISOString().slice(0, 10);
    v = v * f(dias(d, fim)) + valor * f(dias(`${ref}-15`, fim));
    d = fim;
  }
  return v * f(dias(d, ate));
}

test('reconstrução: simular para frente a partir do saldo inferido devolve o valor real', () => {
  const aportes = [
    { ref: '2026-01', valores: { a: 100000 } },
    { ref: '2026-02', valores: { a: 50000 } },
    { ref: '2026-04', valores: { a: -20000 } }, // resgate; março sem aporte
  ];
  const r = reconstruir({ ancora: { data: '2026-05-20', valores: { a: 500000 } }, aportes, taxaMes: 0.01 });
  assert.equal(r.pontos.length, 3);
  assert.deepEqual(r.pontos.map((p) => p.data), ['2026-01-31', '2026-02-28', '2026-04-30']);
  const fim = simular(r.saldoInicial.valores.a, r.saldoInicial.data,
    aportes.map((m) => ({ ref: m.ref, valor: m.valores.a })), '2026-05-20', 0.01);
  assert.ok(Math.abs(fim - 500000) < 2, `simulado ${fim}`);
  assert.equal(r.pontos[0].aporte, 100000);
});

test('reconstrução: carteira sem saldo anterior começa zerada e o que falta vira aporte do 1º mês', () => {
  const aportes = [
    { ref: '2026-01', valores: { a: 100000, b: 0 } },
    { ref: '2026-02', valores: { a: 0, b: 30000 } },
  ];
  const r = reconstruir({ ancora: { data: '2026-03-10', valores: { a: 120000, b: 90000 } }, aportes, taxaMes: 0.01, semSaldoAnterior: ['b'] });
  assert.equal(r.pontos[0].valores.b, 0);
  assert.equal(r.saldoInicial.valores.b, 0);
  assert.ok(r.aportesExtras.b.valor > 55000 && r.aportesExtras.b.valor < 60000, JSON.stringify(r.aportesExtras));
  assert.equal(r.aportesExtras.b.ref, '2026-02');
});

test('reconstrução: recusa aportes depois da primeira anotação real e taxa absurda', () => {
  assert.throws(() => reconstruir({ ancora: { data: '2026-03-10', valores: { a: 1 } }, aportes: [{ ref: '2026-03', valores: { a: 1 } }], taxaMes: 0.01 }), /anteriores/);
  assert.throws(() => reconstruir({ ancora: { data: '2026-03-10', valores: { a: 1 } }, aportes: [], taxaMes: 2 }), /Taxa/);
});
