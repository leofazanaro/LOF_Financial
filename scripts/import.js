#!/usr/bin/env node
// Uso: npm run import -- <arquivo.csv|arquivo.pdf> [...]
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_DB_PATH, openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('Uso: npm run import -- <arquivo> [...]');
  process.exit(1);
}

const db = openDb();
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let falhou = false;

for (const caminho of arquivos) {
  try {
    const r = await importar(db, {
      nome: basename(caminho), buffer: readFileSync(caminho), pastaArquivos: join(dirname(DEFAULT_DB_PATH), 'arquivos'),
    });
    if (r.status === 'repetido') {
      console.log(`= ${r.arquivo}: já importado (importação #${r.importacaoId}), ignorado`);
      continue;
    }
    console.log(`✓ ${r.arquivo} [${r.banco}] fatura ${r.referencia}: ` +
      `${r.inseridas} transações novas, ${r.duplicadas} duplicadas, ${r.classificadas} categorizadas, gastos ${brl(r.gastosCentavos)}` +
      (r.totalImpresso != null ? `, total impresso ${brl(r.totalImpresso)}` : ''));
  } catch (err) {
    falhou = true;
    console.error(`✗ ${caminho}: ${err.message}`);
  }
}

db.close();
process.exit(falhou ? 1 : 0);
