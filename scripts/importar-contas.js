#!/usr/bin/env node
// Lança contas normais a partir de uma planilha.
// Uso: npm run contas -- <contas.csv> [--pular-categoria "Cartao"] [--gravar]
// CSV: "Ano,Mes,Dia,item,VALOR,Categoria" com valores "R$ 1.234,56" ("R$ -" = sem conta no mês, pulada).
// Categorias que ainda não existem são criadas. Contas já lançadas (mesma data, descrição e valor)
// são puladas, então dá para rodar de novo com a planilha atualizada.
// Sem --gravar, só mostra o que seria lançado.
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { openDb } from '../src/db/index.js';
import { lancarConta } from '../src/contas.js';
import { buscarCategoria, criarCategoria } from '../src/categorias.js';
import { normalizar, parseValorCentavos } from '../src/importers/util.js';

const args = process.argv.slice(2);
const opt = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const arquivo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--pular-categoria');
if (!arquivo) { console.error('Uso: npm run contas -- <contas.csv> [--pular-categoria "A,B"] [--gravar]'); process.exit(1); }
const gravar = args.includes('--gravar');
const pular = new Set((opt('--pular-categoria') ?? '').split(',').map((c) => normalizar(c.trim())).filter(Boolean));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const campo = (l, nome) => l[Object.keys(l).find((k) => normalizar(k.trim()) === normalizar(nome))]?.trim() ?? '';

const db = openDb();
const { data: linhas } = Papa.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '').trim(), { header: true, skipEmptyLines: true });
const existe = db.prepare(`SELECT 1 FROM transacoes WHERE banco = 'contas' AND data = ? AND descricao = ? AND valor_centavos = ?`);
const resumo = { lancadas: [], semValor: 0, puladas: 0, repetidas: 0, categoriasNovas: new Set() };

for (const l of linhas) {
  const categoria = campo(l, 'Categoria');
  if (pular.has(normalizar(categoria))) { resumo.puladas++; continue; }
  const valorTxt = campo(l, 'VALOR').replace(/R\$|\s/g, '');
  if (!valorTxt || /^-+$/.test(valorTxt)) { resumo.semValor++; continue; }
  const valorCentavos = parseValorCentavos(valorTxt);
  const item = campo(l, 'item');
  const descricao = item.charAt(0).toUpperCase() + item.slice(1);
  const data = `${campo(l, 'Ano')}-${campo(l, 'Mes').padStart(2, '0')}-${campo(l, 'Dia').padStart(2, '0')}`;
  if (existe.get(data, descricao, valorCentavos)) { resumo.repetidas++; continue; }

  let categoriaId = null;
  if (categoria) {
    try { categoriaId = buscarCategoria(db, categoria).id; } catch {
      resumo.categoriasNovas.add(categoria);
      if (gravar) categoriaId = criarCategoria(db, categoria);
    }
  }
  if (gravar) lancarConta(db, { data, descricao, valorCentavos, categoriaId });
  resumo.lancadas.push({ data, descricao, valorCentavos, categoria });
}

const porMes = Object.groupBy(resumo.lancadas, (c) => c.data.slice(0, 7));
console.table(Object.entries(porMes).map(([mes, cs]) => ({ mes, contas: cs.length,
  total: brl(cs.reduce((s, c) => s + c.valorCentavos, 0)) })));
console.log(`${resumo.lancadas.length} contas · total ${brl(resumo.lancadas.reduce((s, c) => s + c.valorCentavos, 0))}`);
console.log(`Puladas: ${resumo.semValor} sem valor · ${resumo.puladas} por categoria · ${resumo.repetidas} já lançadas`);
if (resumo.categoriasNovas.size) console.log(`Categorias novas: ${[...resumo.categoriasNovas].join(', ')}`);
console.log(gravar ? 'Contas gravadas.' : 'Simulação: nada foi gravado (use --gravar).');
db.close();
