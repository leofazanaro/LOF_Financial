#!/usr/bin/env node
// Lança contas normais a partir da planilha do ano (.xlsx ou CSV) — o mesmo da tela Importar.
// Uso: npm run contas -- <contas.xlsx|csv> [--gravar] [--apagar-sumidas]
// Colunas "Ano, Mes, Dia, item, VALOR, Categoria" (o cabeçalho pode estar abaixo de outras linhas).
// Linhas da categoria Cartao e sem valor são puladas. Contas já lançadas são comparadas por nome
// e mês: iguais ficam, data/valor diferente é atualizado; contas do app que sumiram da planilha
// só são apagadas com --apagar-sumidas. Sem --gravar, só mostra o que seria feito.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { openDb } from '../src/db/index.js';
import { importarPlanilhaContas } from '../src/planilha-contas.js';

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith('--'));
if (!arquivo) { console.error('Uso: npm run contas -- <contas.xlsx|csv> [--gravar] [--apagar-sumidas]'); process.exit(1); }
const gravar = args.includes('--gravar');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const db = openDb();
const nome = basename(arquivo);
const buffer = readFileSync(arquivo);
const previa = importarPlanilhaContas(db, { nome, buffer });
for (const e of previa.erros) console.error(`Linha ${e.linha}: ${e.erro}`);
if (previa.novas.length) {
  console.log('Novas:');
  console.table(previa.novas.map((c) => ({ data: c.data, conta: c.descricao, valor: brl(c.valorCentavos),
    categoria: c.categoria ? `${c.categoria.nome}${c.categoria.nova ? ' (nova)' : ''}` : '' })));
}
if (previa.alteradas.length) {
  console.log('Alteradas:');
  console.table(previa.alteradas.map((a) => ({ conta: a.descricao, antes: `${a.de.data} ${brl(a.de.valorCentavos)}`,
    depois: `${a.para.data} ${brl(a.para.valorCentavos)}` })));
}
if (previa.sumidas.length) {
  console.log('No app mas não na planilha:');
  console.table(previa.sumidas.map((c) => ({ data: c.data, conta: c.descricao, valor: brl(c.valorCentavos) })));
}
console.log(`${previa.iguais} já lançadas · ${previa.novas.length} novas · ${previa.alteradas.length} alteradas · ${previa.sumidas.length} sumidas`);
console.log(`Puladas: ${previa.ignoradas.cartao} de cartão · ${previa.ignoradas.semValor} sem valor`);

if (gravar) {
  const apagar = args.includes('--apagar-sumidas') ? previa.sumidas.map((s) => s.id) : [];
  const { gravado: g } = importarPlanilhaContas(db, { nome, buffer, gravar: true, apagar });
  console.log(`Gravado: ${g.lancadas} novas, ${g.alteradas} alteradas, ${g.apagadas} apagadas, ${g.categoriasCriadas} categorias criadas.`);
} else console.log('Simulação: nada foi gravado (use --gravar).');
db.close();
