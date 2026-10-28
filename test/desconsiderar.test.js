import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import { resumo, transacoes } from '../src/consultas.js';
import { orcamento } from '../src/analises.js';
import {
  criarRegraDesconsiderar, definirDesconsiderada, listarDesconsiderados, removerRegraDesconsiderar, voltarAoAutomatico,
} from '../src/desconsiderar.js';

async function banco() {
  const db = openDb(':memory:');
  await importar(db, {
    nome: 'Nubank_2026-03-14.csv',
    buffer: Buffer.from([
      'date,title,amount',
      '2026-03-01,Supermercado Bom,100.00',
      '2026-03-02,PGTO PIX,-500.00',          // pagamento por Pix: crédito
      '2026-03-03,Pix no credito Joao,80.00',  // compra via Pix no crédito: gasto real
      '2026-03-04,Pagamento recebido,-300.00',
      '2026-03-05,Transferencia Conta,50.00',
    ].join('\n')),
  });
  return db;
}
const id = (db, desc) => db.prepare('SELECT id FROM transacoes WHERE descricao = ?').get(desc).id;

test('na importação, pagamentos e créditos com PIX são desconsiderados; Pix no crédito não', async () => {
  const db = await banco();
  const motivos = Object.fromEntries(listarDesconsiderados(db).map((t) => [t.descricao, [t.origem, t.motivo]]));
  assert.deepEqual(motivos, {
    'PGTO PIX': ['auto', 'Pagamento de fatura'],
    'Pagamento recebido': ['auto', 'Pagamento de fatura'],
  });
  assert.equal(resumo(db, {}).total, 10000 + 8000 + 5000);
});

test('desconsiderar manual tira dos totais, análises e listagem; considerar devolve', async () => {
  const db = await banco();
  const t = id(db, 'Transferencia Conta');
  definirDesconsiderada(db, [t], true, 'transferência entre contas');
  assert.equal(resumo(db, {}).total, 18000);
  assert.ok(!transacoes(db, {}).some((x) => x.id === t));
  const mercado = db.prepare("SELECT id FROM categorias WHERE nome = 'Mercado'").get().id;
  assert.equal(orcamento(db, '2026-03').itens.find((i) => i.id === mercado).gasto, 10000);

  const [item] = listarDesconsiderados(db, { origem: 'manual' });
  assert.deepEqual([item.id, item.motivo], [t, 'transferência entre contas']);

  definirDesconsiderada(db, [t], false);
  assert.equal(resumo(db, {}).total, 23000);
});

test('decisão manual não é desfeita por regra; voltar ao automático reaplica', async () => {
  const db = await banco();
  const pix = id(db, 'Pix no credito Joao');
  definirDesconsiderada(db, [pix], false); // usuário decidiu: considerar
  const r = criarRegraDesconsiderar(db, { padrao: 'pix', soCreditos: false, motivo: 'tudo com pix' });
  assert.ok(r.desconsideradas >= 2);
  assert.equal(db.prepare('SELECT desconsiderada FROM transacoes WHERE id = ?').get(pix).desconsiderada, 0);

  voltarAoAutomatico(db, [pix]);
  const linha = db.prepare('SELECT desconsiderada, desconsiderada_origem, desconsiderada_motivo FROM transacoes WHERE id = ?').get(pix);
  assert.deepEqual({ ...linha }, { desconsiderada: 1, desconsiderada_origem: 'auto', desconsiderada_motivo: 'tudo com pix' });

  const regra = db.prepare("SELECT id FROM regras_desconsiderar WHERE padrao = 'pix'").get().id;
  removerRegraDesconsiderar(db, regra);
  assert.equal(db.prepare('SELECT desconsiderada FROM transacoes WHERE id = ?').get(pix).desconsiderada, 0);
});

test('regra repetida atualiza em vez de duplicar; regex inválida é recusada', async () => {
  const db = await banco();
  criarRegraDesconsiderar(db, { padrao: 'TRANSFER', motivo: 'a' });
  criarRegraDesconsiderar(db, { padrao: 'TRANSFER', motivo: 'b' });
  assert.deepEqual(db.prepare("SELECT motivo FROM regras_desconsiderar WHERE padrao = 'TRANSFER'").all().map((x) => x.motivo), ['b']);
  assert.throws(() => criarRegraDesconsiderar(db, { padrao: '([', tipoMatch: 'regex' }), /inválida/);
});
