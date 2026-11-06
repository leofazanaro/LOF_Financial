import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar, importarExtrato } from '../src/importacao.js';
import { apagarConta, lancarConta } from '../src/contas.js';
import { criarRegra } from '../src/categorias.js';
import { definirDesconsiderada } from '../src/desconsiderar.js';

/** OFX de conta corrente (Nubank) com os lançamentos [fitid, yyyymmdd, valor, memo]. */
const extrato = (linhas) => Buffer.from(`<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS<FID>260</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0260<ACCTID>12345-6</BANKACCTFROM><BANKTRANLIST>
${linhas.map(([id, d, v, m]) => `<STMTTRN><DTPOSTED>${d}<TRNAMT>${v}<FITID>${id}<MEMO>${m}</STMTTRN>`).join('\n')}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);

const pix = (db) => Object.fromEntries(db.prepare(`SELECT descricao, valor_centavos, desconsiderada, desconsiderada_motivo AS motivo
  FROM transacoes WHERE banco = 'pix'`).all().map((t) => [t.descricao, t]));

test('extrato: só saídas, gasto positivo, um mês por data, categoria por regra e sem duplicar', async () => {
  const db = openDb(':memory:');
  criarRegra(db, { padrao: 'MERCADINHO', categoria: 'Mercado' });
  const r = await importarExtrato(db, {
    nome: 'extrato.ofx',
    buffer: extrato([
      ['a', '20261028', '-50.00', 'Pix enviado MERCADINHO'],
      ['b', '20261030', '3000.00', 'Salario'],
      ['c', '20261102', '-120.00', 'Pix enviado Joao'],
      ['d', '20261103', '-800.00', 'Pagamento de fatura'],
    ]),
  });
  assert.equal(r.status, 'importado');
  assert.equal(r.origem, 'nubank');
  assert.deepEqual(r.meses, ['2026-10', '2026-11']);
  assert.equal(r.inseridas, 3);
  const t = pix(db);
  assert.equal(t.Salario, undefined);
  assert.equal(t['Pix enviado Joao'].valor_centavos, 12000);
  assert.equal(t['Pagamento de fatura'].motivo, 'Pagamento de fatura do cartão'); // regra padrão
  const cat = db.prepare("SELECT c.nome FROM transacoes t JOIN categorias c ON c.id = t.categoria_id WHERE t.descricao LIKE '%MERCADINHO'").get();
  assert.equal(cat.nome, 'Mercado');
  assert.deepEqual(db.prepare("SELECT referencia FROM faturas WHERE banco = 'pix' ORDER BY 1").all().map((f) => f.referencia), ['2026-10', '2026-11']);

  // Outro extrato com período sobreposto: o FITID evita duplicar.
  const r2 = await importarExtrato(db, { nome: 'extrato2.ofx', buffer: extrato([['c', '20261102', '-120.00', 'Pix enviado Joao'], ['e', '20261104', '-10.00', 'Padaria']]) });
  assert.deepEqual([r2.inseridas, r2.duplicadas], [1, 1]);
  assert.equal((await importarExtrato(db, { nome: 'de novo.ofx', buffer: extrato([['c', '20261102', '-120.00', 'Pix enviado Joao'], ['e', '20261104', '-10.00', 'Padaria']]) })).status, 'repetido');
  await assert.rejects(importarExtrato(db, { nome: 'so-entradas.ofx', buffer: extrato([['x', '20261101', '10.00', 'Pix recebido']]) }), /não tem saídas/);
});

test('conciliação: conta lançada (antes ou depois), um para um, janela e decisão manual', async () => {
  const db = openDb(':memory:');
  lancarConta(db, { data: '2026-11-10', descricao: 'Aluguel', valorCentavos: 150000 });
  lancarConta(db, { data: '2026-11-05', descricao: 'Internet', valorCentavos: 9990 });
  const r = await importarExtrato(db, {
    nome: 'extrato.ofx',
    buffer: extrato([
      ['1', '20261107', '-1500.00', 'Pix enviado Imobiliaria'],  // 3 dias antes do aluguel
      ['2', '20261108', '-1500.00', 'Pix enviado Fulano'],      // mesmo valor, mas o aluguel já tem par
      ['3', '20261120', '-99.90', 'Boleto Operadora'],          // 15 dias da internet: fora da janela
      ['4', '20261112', '-45.00', 'Pagamento conta de luz'],
    ]),
  });
  assert.equal(r.conciliadas, 1);
  let t = pix(db);
  assert.equal(t['Pix enviado Imobiliaria'].motivo, 'Conta já lançada: Aluguel (10/11)');
  assert.equal(t['Pix enviado Fulano'].desconsiderada, 0);
  assert.equal(t['Boleto Operadora'].desconsiderada, 0);

  // Conta lançada depois do extrato: o pagamento sai dos gastos na hora; apagada, volta.
  const { id } = lancarConta(db, { data: '2026-11-15', descricao: 'Luz', valorCentavos: 4500 });
  assert.equal(pix(db)['Pagamento conta de luz'].motivo, 'Conta já lançada: Luz (15/11)');
  apagarConta(db, id);
  assert.equal(pix(db)['Pagamento conta de luz'].desconsiderada, 0);

  // "Considerar" manual vence a conciliação, e o par livre passa para o outro Pix igual.
  const imob = db.prepare("SELECT id FROM transacoes WHERE descricao = 'Pix enviado Imobiliaria'").get().id;
  definirDesconsiderada(db, [imob], false);
  t = pix(db);
  assert.equal(t['Pix enviado Imobiliaria'].desconsiderada, 0);
  assert.equal(t['Pix enviado Fulano'].motivo, 'Conta já lançada: Aluguel (10/11)');
});

test('conciliação: pagamento na fatura do cartão, importada antes ou depois do extrato', async () => {
  const db = openDb(':memory:');
  await importarExtrato(db, { nome: 'extrato.ofx', buffer: extrato([['1', '20261012', '-735.10', 'Transferencia enviada NU']]) });
  assert.equal(pix(db)['Transferencia enviada NU'].desconsiderada, 0);
  await importar(db, {
    nome: 'Nubank_2026-11-14.csv',
    buffer: Buffer.from('date,title,amount\n2026-10-15,Supermercado,100.00\n2026-10-14,Pagamento recebido,-735.10\n'),
  });
  assert.equal(pix(db)['Transferencia enviada NU'].motivo, 'Pagamento da fatura Nubank 11/2026');
});
