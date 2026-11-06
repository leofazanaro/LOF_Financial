import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { openDb } from '../src/db/index.js';
import { importarPlanilhaContas, lerPlanilhaContas } from '../src/planilha-contas.js';
import { lancarConta } from '../src/contas.js';
import { criarCategoria } from '../src/categorias.js';
import { transacoes } from '../src/consultas.js';
import { lerXlsx } from '../src/importers/xlsx.js';

// Como a planilha do Google Sheets: totais acima do cabeçalho e "R$ -" para zero.
const CABECALHO = ',,,,Falta pagar,,,\n,,,,"R$ 1.234,56",,,\n\nAno,Mes,Dia,item,VALOR,PAGO,Saldo,Categoria\n';
const csv = (linhas) => ({ nome: '2026.csv', buffer: Buffer.from(CABECALHO + linhas.join('\n')) });
const contas = (db) => transacoes(db, { banco: 'contas' }).map((t) => `${t.data} ${t.descricao} ${t.valor_centavos}`).sort();

/** Monta um .xlsx mínimo (zip com deflate) com uma aba. */
function xlsx(linhas) {
  const cel = (v, c, r) => {
    const ref = `${String.fromCharCode(65 + c)}${r}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  };
  const sheet = `<worksheet><sheetData><row r="1"/>${linhas.map((l, i) => `<row r="${i + 2}">${l.map((v, c) => (v === '' ? '' : cel(v, c, i + 2))).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const arquivos = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Dados &amp; contas" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  const locais = [], centrais = [];
  let offset = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const n = Buffer.from(nome), dados = deflateRawSync(Buffer.from(conteudo));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(dados.length, 18); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(dados.length, 20); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locais.push(local, n, dados); centrais.push(central, n);
    offset += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

test('lê .xlsx com o cabeçalho abaixo dos totais e números crus', () => {
  const buffer = xlsx([
    ['', '', '', '', 'Falta pagar'],
    ['Ano', 'Mes', 'Dia', 'item', 'VALOR', 'PAGO', 'Saldo', 'Categoria'],
    [2026, 1, 10, 'condominio', 248.1, 248.1, 0, 'Casa'],
    [2026, 1, 15, 'iptu', 0, 0, 0, 'Taxas'],
    [2026, 1, 24, 'nu leo', 590, 590, 0, 'Cartao'],
    [2026, 11, 13, 'luz', 1281.05, '', -1281.05, 'Casa'],
  ]);
  assert.equal(lerXlsx(buffer)[0].nome, 'Dados & contas');
  const r = lerPlanilhaContas({ nome: '2026.xlsx', buffer });
  assert.deepEqual(r.contas.map(({ data, descricao, valorCentavos, categoria }) => [data, descricao, valorCentavos, categoria]), [
    ['2026-01-10', 'Condominio', 24810, 'Casa'],
    ['2026-11-13', 'Luz', 128105, 'Casa'],
  ]);
  assert.deepEqual(r.ignoradas, { semValor: 1, cartao: 1 });
  assert.equal(r.contas[1].linha, 7);
});

test('CSV: valores formatados, "R$ -" pulado e linhas inválidas apontadas', () => {
  const r = lerPlanilhaContas(csv([
    '2026,1,10,condominio,"R$ 1.248,10",,,Casa',
    '2026,1,15,iptu,R$ -,,,Taxas',
    '2026,13,15,prev,"R$ 49,00",,,Taxas',
    '2026,1,21,agua,abc,,,Casa',
  ]));
  assert.deepEqual(r.contas.map((c) => c.valorCentavos), [124810]);
  assert.equal(r.ignoradas.semValor, 1);
  assert.deepEqual(r.erros.map((e) => e.linha), [7, 8]);
  assert.throws(() => lerPlanilhaContas({ nome: 'x.csv', buffer: Buffer.from('a,b\n1,2') }), /cabeçalho/);
});

test('reenviar a planilha só grava o que mudou e não duplica', () => {
  const db = openDb(':memory:');
  const ano = ['2026,10,10,condominio,"R$ 248,10",,,Casa', '2026,10,13,luz,"R$ 281,05",,,Casa', '2026,10,15,impostos,"R$ 1.271,20",,,Taxas'];
  let r = importarPlanilhaContas(db, { ...csv(ano), gravar: true });
  assert.deepEqual(r.gravado, { lancadas: 3, alteradas: 0, apagadas: 0, categoriasCriadas: 1 }); // Taxas (Casa já vem no banco novo)

  r = importarPlanilhaContas(db, { ...csv(ano), gravar: true });
  assert.equal(r.iguais, 3);
  assert.deepEqual(r.gravado, { lancadas: 0, alteradas: 0, apagadas: 0, categoriasCriadas: 0 });

  // Luz corrigida, impostos passou para novembro, condomínio de novembro novo.
  const novo = ['2026,10,10,condominio,"R$ 248,10",,,Casa', '2026,10,14,luz,"R$ 290,00",,,Casa',
    '2026,11,10,condominio,"R$ 248,10",,,Casa', '2026,11,15,impostos,"R$ 1.271,20",,,Taxas'];
  const previa = importarPlanilhaContas(db, csv(novo));
  assert.equal(previa.iguais, 1);
  assert.deepEqual(previa.alteradas.map((a) => [a.descricao, a.para]), [['Luz', { data: '2026-10-14', valorCentavos: 29000 }]]);
  assert.deepEqual(previa.novas.map((c) => `${c.data} ${c.descricao}`), ['2026-11-10 Condominio', '2026-11-15 Impostos']);
  assert.deepEqual(previa.sumidas.map((c) => `${c.data} ${c.descricao}`), ['2026-10-15 Impostos']);
  assert.equal(contas(db).length, 3, 'a prévia não grava nada');

  // Sem marcar, a sumida fica; marcada, é apagada.
  importarPlanilhaContas(db, { ...csv(novo), gravar: true });
  assert.ok(contas(db).includes('2026-10-15 Impostos 127120'));
  importarPlanilhaContas(db, { ...csv(novo), gravar: true, apagar: [previa.sumidas[0].id] });
  assert.deepEqual(contas(db), ['2026-10-10 Condominio 24810', '2026-10-14 Luz 29000',
    '2026-11-10 Condominio 24810', '2026-11-15 Impostos 127120']);
});

test('conta nova herda a categoria que a conta de mesmo nome tem no app', () => {
  const db = openDb(':memory:');
  const custos = criarCategoria(db, 'Casa - Custos');
  lancarConta(db, { data: '2026-10-13', descricao: 'Luz', valorCentavos: 28105, categoriaId: custos });
  const r = importarPlanilhaContas(db, { ...csv(['2026,11,13,luz,"R$ 281,05",,,Casa', '2026,11,20,gas,"R$ 90,00",,,Utilidades']), gravar: true });
  assert.deepEqual(r.novas.map((c) => c.categoria), [{ id: custos, nome: 'Casa - Custos' }, { id: null, nome: 'Utilidades', nova: true }]);
  const cat = Object.fromEntries(transacoes(db, { banco: 'contas' }).map((t) => [`${t.data} ${t.descricao}`, t.categoria]));
  assert.equal(cat['2026-11-13 Luz'], 'Casa - Custos');
  assert.equal(cat['2026-11-20 Gas'], 'Utilidades');
});

test('planilha com erro não grava nada', () => {
  const db = openDb(':memory:');
  assert.throws(() => importarPlanilhaContas(db, { ...csv(['2026,10,10,luz,"R$ 10,00",,,Casa', '2026,10,99,agua,"R$ 5,00",,,Casa']), gravar: true }), /erro/);
  assert.deepEqual(contas(db), []);
});
