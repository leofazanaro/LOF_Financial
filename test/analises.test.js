import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import { assinaturas, comparacao, definirOrcamento, orcamento, parcelasFuturas, salvarAssinatura, somarMeses } from '../src/analises.js';

const csv = (linhas) => Buffer.from(`date,title,amount\n${linhas.join('\n')}\n`);

async function bancoCom(faturas) {
  const db = openDb(':memory:');
  for (const [nome, linhas] of Object.entries(faturas)) await importar(db, { nome, buffer: csv(linhas) });
  return db;
}

test('somarMeses atravessa o ano', () => {
  assert.equal(somarMeses('2025-11', 3), '2026-02');
  assert.equal(somarMeses('2026-01', -1), '2025-12');
});

test('parcelas: projeta a partir da última fatura e descarta quitadas', async () => {
  const db = await bancoCom({
    'Nubank_2026-01-14.csv': ['2026-01-05,Loja A - Parcela 2/4,100.00', '2026-01-05,Loja B - Parcela 1/2,50.00'],
    // Loja B some na fatura seguinte (antecipada); Loja A continua
    'Nubank_2026-02-14.csv': ['2026-02-05,Loja A - Parcela 3/4,100.00'],
  });
  const p = parcelasFuturas(db);
  assert.deepEqual(p.meses.map((m) => [m.referencia, m.total]), [['2026-03', 10000]]);
  assert.equal(p.parcelamentos.length, 1);
  assert.equal(p.parcelamentos[0].terminaEm, '2026-03');
  assert.equal(p.totalRestante, 10000);
});

test('parcelas: dois parcelamentos idênticos na mesma fatura contam em dobro', async () => {
  const db = await bancoCom({ 'Nubank_2026-01-14.csv': ['2026-01-05,Loja - Parcela 1/3,10.00', '2026-01-05,Loja - Parcela 1/3,10.00'] });
  const p = parcelasFuturas(db);
  assert.equal(p.parcelamentos[0].qtd, 2);
  assert.equal(p.totalRestante, 4000);
});

test('assinaturas: sugestão recorrente, mudança de preço, nova e ausente', async () => {
  const db = await bancoCom({
    'Nubank_2026-01-14.csv': ['2026-01-05,Streaming X,30.00', '2026-01-06,Velha Y,10.00'],
    'Nubank_2026-02-14.csv': ['2026-02-05,Streaming X,30.00', '2026-02-06,Velha Y,10.00'],
    'Nubank_2026-03-14.csv': ['2026-03-05,Streaming X,35.00', '2026-03-07,Nova Z,20.00'],
  });
  // Só "Streaming X" tem 3 meses com uma cobrança por mês; Y tem 2 meses.
  assert.deepEqual(assinaturas(db).sugestoes.map((s) => s.chave), ['STREAMINGX']);

  salvarAssinatura(db, { banco: 'nubank', chave: 'STREAMINGX', nome: 'X' });
  salvarAssinatura(db, { banco: 'nubank', chave: 'VELHAY', nome: 'Y' });
  salvarAssinatura(db, { banco: 'nubank', chave: 'NOVAZ', nome: 'Z' });
  const a = assinaturas(db);
  const alerta = (nome) => a.ativas.find((s) => s.nome === nome).alertas.map((x) => x.tipo);
  assert.deepEqual(alerta('X'), ['preco']);
  assert.deepEqual(alerta('Y'), ['ausente']);
  assert.deepEqual(alerta('Z'), ['nova']);
  assert.equal(a.custoMensal, 3500 + 2000); // ausente não conta
});

test('assinaturas: mesmo serviço com prefixo de intermediador diferente é um só', async () => {
  const db = await bancoCom({
    'Nubank_2026-01-14.csv': ['2026-01-05,Ec *Hbomaxassin,31.43'],
    'Nubank_2026-02-14.csv': ['2026-02-05,Mp *Hbomaxassin,31.43'],
    'Nubank_2026-03-14.csv': ['2026-03-05,Mp *Hbomaxassin,31.43', '2026-03-09,Padaria Boa,8.00', '2026-03-19,Padaria Boa,9.00'],
  });
  const s = assinaturas(db).sugestoes;
  assert.equal(s.length, 1);
  assert.equal(s[0].chave, 'HBOMAXASSIN');
  assert.equal(s[0].meses, 3);
});

test('orçamento e comparação com a média', async () => {
  const db = await bancoCom({
    'Nubank_2026-01-14.csv': ['2026-01-05,Supermercado Bom,100.00'],
    'Nubank_2026-02-14.csv': ['2026-02-05,Supermercado Bom,300.00'],
    'Nubank_2026-03-14.csv': ['2026-03-05,Supermercado Bom,450.00'],
  });
  const mercado = db.prepare("SELECT id FROM categorias WHERE nome = 'Mercado'").get().id;
  definirOrcamento(db, mercado, 50000);
  const o = orcamento(db, '2026-03');
  assert.equal(o.itens.find((i) => i.id === mercado).status, 'atencao'); // 90%
  assert.throws(() => definirOrcamento(db, mercado, 0));

  const c = comparacao(db, { referencia: '2026-03' });
  const item = c.itens.find((i) => i.id === mercado);
  assert.deepEqual(c.mesesBase, ['2026-01', '2026-02']);
  assert.equal(item.media, 20000);
  assert.equal(item.diferenca, 25000);
});
