#!/usr/bin/env node
// Reconstrói (estima) o patrimônio passado a partir de uma planilha de aportes mensais por carteira.
// Uso: npm run reconstruir -- <aportes.csv> [--taxa 1.06] [--sem-saldo-anterior "Inter PJ,Nu"] [--gravar]
// CSV: "Mês,<carteira>,<carteira>..." com Mês = MM/AA e valores "R$ 1.234,56" (resgate negativo).
// Sem --gravar, só mostra o resultado. Com --gravar, apaga as estimativas anteriores e grava as novas.
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { openDb } from '../src/db/index.js';
import { reconstruir } from '../src/reconstrucao.js';
import { apagarEstimados, evolucao, salvarRegistro } from '../src/patrimonio.js';
import { parseValorCentavos } from '../src/importers/util.js';

const args = process.argv.slice(2);
const opt = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const arquivo = args.find((a) => !a.startsWith('--') && !Object.values({ t: opt('--taxa'), s: opt('--sem-saldo-anterior') }).includes(a));
if (!arquivo) { console.error('Uso: npm run reconstruir -- <aportes.csv> [--taxa 1.06] [--sem-saldo-anterior "A,B"] [--gravar]'); process.exit(1); }
const taxaMes = Number((opt('--taxa') ?? '1.06').replace(',', '.')) / 100;
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const db = openDb();
const ev = evolucao(db);
const porNome = new Map(ev.carteiras.map((c) => [c.nome.toLowerCase(), c]));
const reais = ev.linhas.filter((l) => !l.estimado);
if (!reais.length) { console.error('Faça ao menos uma anotação real antes de reconstruir.'); process.exit(1); }
const ancora = { data: reais[0].data, valores: Object.fromEntries(Object.entries(reais[0].valores).map(([k, v]) => [k, v])) };

const { data: linhas, meta } = Papa.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '').trim(), { header: true, skipEmptyLines: true });
const colunas = meta.fields.slice(1).map((nome) => {
  const c = porNome.get(nome.trim().toLowerCase());
  if (!c) throw new Error(`Coluna "${nome}" não corresponde a nenhuma carteira (${ev.carteiras.map((x) => x.nome).join(', ')})`);
  return { nome, id: String(c.id) };
});
const aportes = linhas.map((l) => {
  const [m, a] = l[meta.fields[0]].trim().split('/');
  const ano = a.length === 2 ? `20${a}` : a;
  return { ref: `${ano}-${m.padStart(2, '0')}`, valores: Object.fromEntries(colunas.map((c) => [c.id, parseValorCentavos(l[c.nome] || '0')])) };
});
const semSaldo = (opt('--sem-saldo-anterior') ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean)
  .map((n) => { const c = porNome.get(n); if (!c) throw new Error(`Carteira "${n}" não existe`); return String(c.id); });

const r = reconstruir({ ancora, aportes, taxaMes, semSaldoAnterior: semSaldo });
const nome = (id) => ev.carteiras.find((c) => String(c.id) === id).nome;
console.log(`Âncora (anotação real mais antiga): ${ancora.data} · taxa ${(taxaMes * 100).toFixed(2)}% a.m.`);
console.log(`Saldo antes de ${aportes[0].ref}: ${Object.entries(r.saldoInicial.valores).map(([id, v]) => `${nome(id)} ${brl(v)}`).join(' · ')}`);
for (const [id, e] of Object.entries(r.aportesExtras)) console.log(`Aporte não listado inferido: ${nome(id)} ${brl(e.valor)} em ${e.ref}`);
console.table(r.pontos.map((p) => ({ data: p.data, ...Object.fromEntries(Object.entries(p.valores).map(([id, v]) => [nome(id), brl(v)])),
  total: brl(Object.values(p.valores).reduce((s, v) => s + v, 0)), aporte: brl(p.aporte) })));

if (args.includes('--gravar')) {
  // apagarEstimados e salvarRegistro já usam transação própria
  apagarEstimados(db);
  for (const p of r.pontos) {
    if (reais.some((l) => l.data === p.data)) continue; // nunca sobrescreve anotação real
    salvarRegistro(db, p.data, { valores: p.valores, aporte: p.aporte, estimado: true });
  }
  console.log(`Gravadas ${r.pontos.length} anotações estimadas.`);
} else {
  console.log('Simulação: nada foi gravado (use --gravar).');
}
db.close();
