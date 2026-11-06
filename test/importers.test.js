import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveDe, classificarTipo, extrairParcela, parseDataExtenso, parseValorCentavos } from '../src/importers/util.js';
import * as nubank from '../src/importers/nubank-csv.js';

test('valor: formatos pt-BR, en e detecção automática', () => {
  assert.equal(parseValorCentavos('R$ 1.234,56'), 123456);
  assert.equal(parseValorCentavos('2.229,14'), 222914);
  assert.equal(parseValorCentavos('19.90', { decimal: '.' }), 1990);
  const auto = (v) => parseValorCentavos(v, { decimal: 'auto' });
  assert.equal(auto('19.90'), 1990);
  assert.equal(auto('19,90'), 1990);
  assert.equal(auto('-56,75'), -5675);
  assert.equal(auto('-27.39'), -2739);
  assert.equal(auto('1.081,70'), 108170);
  assert.equal(auto('1,081.70'), 108170);
  assert.equal(auto('108,1'), 10810);
  assert.equal(auto('60'), 6000);
  assert.equal(auto('1.234'), 123400); // ponto com 3 dígitos = milhar
  assert.throws(() => auto(''));
  assert.throws(() => auto('abc'));
});

test('tipo: pagamentos com várias grafias, estorno, tarifa e compra', () => {
  assert.equal(classificarTipo('PAGAMENTO ON LINE', -100), 'pagamento');
  assert.equal(classificarTipo('Pagamento recebido', -100), 'pagamento');
  assert.equal(classificarTipo('PGTO PIX', -286255), 'pagamento');
  assert.equal(classificarTipo('PAGTO DEBITO AUTOMATICO', -100), 'pagamento');
  assert.equal(classificarTipo('AMAZON BR', -27582), 'estorno');
  assert.equal(classificarTipo('IOF COMPRA INTERNACIONAL', 50), 'tarifa');
  assert.equal(classificarTipo('PGTO PIX', 100), 'compra'); // valor positivo nunca é pagamento
  assert.equal(classificarTipo('PAGTOSHOP', -100), 'estorno'); // "pagto" só como palavra
});

test('parcela: formatos Nubank e Inter', () => {
  assert.deepEqual(extrairParcela('Mp *Aliexpress - Parcela 10/12'), { descricao: 'Mp *Aliexpress', parcelaAtual: 10, parcelaTotal: 12 });
  assert.deepEqual(extrairParcela('EBN *EPICGAMES (Parcela 03 de 05)'), { descricao: 'EBN *EPICGAMES', parcelaAtual: 3, parcelaTotal: 5 });
  assert.deepEqual(extrairParcela('Google One'), { descricao: 'Google One', parcelaAtual: null, parcelaTotal: null });
});

test('data por extenso do Inter', () => {
  assert.equal(parseDataExtenso('06 de dez. 2025'), '2025-12-06');
  assert.equal(parseDataExtenso('7 de mar. 2026'), '2026-03-07');
  assert.throws(() => parseDataExtenso('06 de xyz. 2025'));
});

const csvNubank = (corpo, nome = 'Nubank_2026-06-14.csv') => {
  const texto = corpo;
  assert.ok(nubank.detectar({ nome, texto }));
  return nubank.importar({ nome, texto });
};

test('Nubank CSV: formato antigo (ponto decimal)', () => {
  const r = csvNubank('date,title,amount\n2026-01-11,Ec *Melimais,19.90\n2025-12-17,Pagamento recebido,-27.39\n', 'Nubank_2026-01-24.csv');
  assert.equal(r.fatura.referencia, '2026-01');
  assert.deepEqual(r.transacoes.map((t) => [t.valorCentavos, t.tipo]), [[1990, 'compra'], [-2739, 'pagamento']]);
});

test('Nubank CSV: vírgula decimal entre aspas, ponto e vírgula, BOM e data dd/mm/aaaa', () => {
  const aspas = csvNubank('date,title,amount\n2026-05-30,Google Youtubepremium,"53,90"\n2026-05-07,Pagamento recebido,"-500,00"\n');
  assert.deepEqual(aspas.transacoes.map((t) => t.valorCentavos), [5390, -50000]);

  const pv = csvNubank('﻿date;title;amount\n30/05/2026;KaBuM! - NuPay - Parcela 7/8;26,38\n', 'qualquer.csv');
  assert.equal(pv.transacoes[0].valorCentavos, 2638);
  assert.equal(pv.transacoes[0].data, '2026-05-30');
  assert.equal(pv.transacoes[0].parcelaAtual, 7);
});

test('Nubank CSV: linhas idênticas recebem hashes diferentes e reimportar gera os mesmos', () => {
  const corpo = 'date,title,amount\n2026-01-05,Padaria,5.00\n2026-01-05,Padaria,5.00\n';
  const a = csvNubank(corpo, 'Nubank_2026-01-24.csv');
  const b = csvNubank(corpo, 'Nubank_2026-01-24.csv');
  assert.notEqual(a.transacoes[0].hash, a.transacoes[1].hash);
  assert.deepEqual(a.transacoes.map((t) => t.hash), b.transacoes.map((t) => t.hash));
});

test('chave do estabelecimento ignora intermediador, acento e pontuação', () => {
  assert.equal(chaveDe('Ec *Hbomaxassin'), 'HBOMAXASSIN');
  assert.equal(chaveDe('MP *HBOMAXASSIN'), 'HBOMAXASSIN');
  assert.equal(chaveDe('Apple.Com/Bill.'), 'APPLECOMBILL');
  assert.equal(chaveDe('Applecombill'), 'APPLECOMBILL');
  assert.equal(chaveDe('Panificação São José'), 'PANIFICACAOSAOJOSE');
  assert.equal(chaveDe('MERCADOLIVRE*INPOWER3'), 'MERCADOLIVREINPOWER3'); // não é intermediador curto
});

test('regra "contém" ignora espaços e pontuação', async () => {
  const { contem } = await import('../src/categorias.js');
  const bigChurros = contem('BIG CHURROS');
  assert.ok(bigChurros('BIG CHURROS SHOPPING'));
  assert.ok(bigChurros('BIGCHURROS CENTRO'));
  assert.ok(contem('APPLE.COM/BILL')('Applecombill'));
  assert.ok(!bigChurros('BIG BURGER'));
});

test('Digio PDF: parcelas por cartão, pagamento e vencimento no ano seguinte', async () => {
  const { lerLinhas } = await import('../src/importers/digio-pdf.js');
  const linhas = [
    ['Nome:', 'Fulano', 'Valor da fatura:', 'R$ 891,19'],
    ['Fatura emitida em:', '07/12/2025', 'Período:', '06/11/2025 a 05/12/2025'],
    ['Vencimento:', '10 JAN'],
    ['Transações nacionais', 'R$', '891,19'],
    ['Limite total do cartão:', 'R$ 10.000,00', 'Transações internacionais', 'R$', '0,00'],
    ['Tarifas e encargos', 'R$', '0,00'],
    ['Digio virtual Final 1111 - Fulano', 'Gold'],
    ['Data', 'Descrição', 'Parcela', 'Valor (R$)'],
    ['08/04/2025', 'PG *LOJA EXEMPLO', '9/10', '500,00'],
    ['14/07/2025', 'SEGURADORA EXEMPLO', '6/10', '300,00'],
    ['Digio físico Final 2222 - Fulano', 'Gold'],
    ['14/07/2025', 'MERCADOPAGO*LOJAEXEMPLO', '6/9', '91,19'],
    ['08/12/2025', 'Inclusao Pgto fatura QRCode', '-800,00'],
    ['pág', '4 7/'],
  ].map((celulas) => ({ celulas, texto: celulas.join(' ') }));
  const r = lerLinhas(linhas);
  assert.deepEqual(r.fatura, { referencia: '2026-01', vencimento: '2026-01-10', totalCentavos: 89119 });
  assert.deepEqual(r.transacoes.map((t) => [t.cartaoFinal, t.data, t.descricao, t.parcelaAtual, t.valorCentavos, t.tipo]), [
    ['1111', '2025-04-08', 'PG *LOJA EXEMPLO', 9, 50000, 'compra'],
    ['1111', '2025-07-14', 'SEGURADORA EXEMPLO', 6, 30000, 'compra'],
    ['2222', '2025-07-14', 'MERCADOPAGO*LOJAEXEMPLO', 6, 9119, 'compra'],
    ['2222', '2025-12-08', 'Inclusao Pgto fatura QRCode', null, -80000, 'pagamento'],
  ]);
  linhas[8] = { celulas: ['08/04/2025', 'PG *LOJA EXEMPLO', '9/10', '500,01'], texto: '' };
  assert.throws(() => lerLinhas(linhas), /soma dos lançamentos/);
});
