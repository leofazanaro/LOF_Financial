import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converter } from '../src/importers/index.js';
import { extrairParcela } from '../src/importers/util.js';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';

// OFX 1.x (SGML, sem tags de fechamento nos campos), em Windows-1252 como o Itaú exporta.
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261030120000[-3:BRT]<LANGUAGE>POR
<FI><ORG>Banco Itaú<FID>341</FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<CCSTMTRS><CURDEF>BRL<CCACCTFROM><ACCTID>5162********4321</CCACCTFROM>
<BANKTRANLIST><DTSTART>20260925<DTEND>20261025
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001120000[-3:BRT]<TRNAMT>-123.45<FITID>1<MEMO>PADARIA SÃO JOÃO
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003<TRNAMT>-250.00<FITID>2<MEMO>MAGAZINE LUIZA 03/10
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261004<TRNAMT>-30,00<FITID>3<MEMO>RESTAURANTE 31/12
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>1500.00<FITID>4<MEMO>PAGAMENTO EFETUADO
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261012<TRNAMT>45.90<FITID>5<NAME>ESTORNO LOJA X
</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-327.55<DTASOF>20261025</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

// OFX 2.x (XML), em UTF-8 e sem FID: o banco sai do <ORG>.
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><FI><ORG>C6 Bank</ORG></FI></SONRS></SIGNONMSGSRSV1>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
    <CCACCTFROM><ACCTID>9988</ACCTID></CCACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20260901</DTSTART><DTEND>20260928</DTEND>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260915</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>a</FITID><MEMO>Farmácia Araújo</MEMO></STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260915</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>b</FITID><MEMO>Farmácia Araújo</MEMO></STMTTRN>
    </BANKTRANLIST>
  </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

const CONTA_CORRENTE = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0341</BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNAMT>-10.00<DTPOSTED>20261001<MEMO>PIX</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const latin1 = (s) => Buffer.from(s, 'latin1');

test('OFX 1.x: banco, cartão, sinais, acentos em 1252 e parcelas', async () => {
  const { resultado: r } = await converter({ nome: 'extrato.ofx', buffer: latin1(SGML) });
  assert.equal(r.banco, 'itau');
  assert.equal(r.formato, 'ofx');
  const t = r.transacoes;
  assert.equal(t.length, 5);
  assert.deepEqual(t.map((x) => x.valorCentavos), [12345, 25000, 3000, -150000, -4590]);
  assert.ok(t.every((x) => x.cartaoFinal === '4321'));
  assert.equal(t[0].descricao, 'PADARIA SÃO JOÃO');
  assert.equal(t[0].data, '2026-10-01');
  assert.deepEqual([t[1].descricao, t[1].parcelaAtual, t[1].parcelaTotal], ['MAGAZINE LUIZA', 3, 10]);
  assert.equal(t[2].parcelaAtual, null); // "31/12" não é parcela
  assert.deepEqual(t.map((x) => x.tipo), ['compra', 'compra', 'compra', 'pagamento', 'estorno']);
  assert.equal(t[4].descricao, 'ESTORNO LOJA X'); // sem MEMO, usa NAME
});

test('OFX: fatura no mês do vencimento estimado (fechamento + 10 dias) ou da data no nome', async () => {
  const sgml = await converter({ nome: 'extrato.ofx', buffer: latin1(SGML) });
  assert.equal(sgml.resultado.fatura.referencia, '2026-11'); // fecha 25/10 -> vence em novembro
  const xml = await converter({ nome: 'c6.ofx', buffer: Buffer.from(XML) });
  assert.equal(xml.resultado.fatura.referencia, '2026-10'); // fecha 28/09 -> vence em outubro
  const nomeado = await converter({ nome: 'itau_2026-10-30.ofx', buffer: latin1(SGML) });
  assert.equal(nomeado.resultado.fatura.referencia, '2026-10');
  assert.equal(nomeado.resultado.fatura.vencimento, '2026-10-30');
});

test('OFX 2.x: banco pelo nome, UTF-8 e compras iguais no mesmo dia', async () => {
  const { resultado: r } = await converter({ nome: 'c6.ofx', buffer: Buffer.from(XML) });
  assert.equal(r.banco, 'c6');
  assert.equal(r.transacoes[0].descricao, 'Farmácia Araújo');
  assert.equal(r.transacoes[0].cartaoFinal, '9988');
  assert.notEqual(r.transacoes[0].hash, r.transacoes[1].hash);
});

test('OFX de conta corrente é recusado com mensagem clara', async () => {
  await assert.rejects(converter({ nome: 'conta.ofx', buffer: Buffer.from(CONTA_CORRENTE) }), /conta corrente/);
});

test('OFX: importação grava fatura, cadastra o banco e não duplica', async () => {
  const db = openDb(':memory:');
  const r = await importar(db, { nome: 'itau.ofx', buffer: latin1(SGML), pastaArquivos: null });
  assert.equal(r.status, 'importado');
  assert.equal(r.inseridas, 5);
  assert.equal(db.prepare("SELECT nome FROM bancos WHERE codigo = 'itau'").get().nome, 'Itaú');
  const pagamento = db.prepare("SELECT desconsiderada FROM transacoes WHERE tipo = 'pagamento'").get();
  assert.equal(pagamento.desconsiderada, 1);
  const repetido = await importar(db, { nome: 'itau-copia.ofx', buffer: latin1(SGML), pastaArquivos: null });
  assert.equal(repetido.status, 'repetido');
});

test('parcela no formato OFX: "LOJA 03/10" e "LOJA PARC 03/10"', () => {
  assert.deepEqual(extrairParcela('LOJA X 03/10'), { descricao: 'LOJA X', parcelaAtual: 3, parcelaTotal: 10 });
  assert.deepEqual(extrairParcela('LOJA X PARC 3/10'), { descricao: 'LOJA X', parcelaAtual: 3, parcelaTotal: 10 });
  assert.equal(extrairParcela('LOJA 12/10').parcelaAtual, null);
  assert.equal(extrairParcela('LOJA 1/1').parcelaAtual, null);
});
