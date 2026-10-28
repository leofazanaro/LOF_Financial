// Contas normais (aluguel, luz, internet...) lançadas à mão. Cada conta vira uma transação do
// banco 'contas' numa "fatura" do mês do vencimento, criada sob demanda: assim entram nos totais,
// categorias, orçamento e comparações exatamente como as compras do cartão.
import { randomUUID } from 'node:crypto';
import { definirCategoria, reclassificar } from './categorias.js';
import { garantirBanco } from './bancos.js';
import { chaveDe } from './importers/util.js';

const BANCO = 'contas';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function validar({ data, descricao, valorCentavos }, parcial = false) {
  const out = {};
  if (data !== undefined || !parcial) {
    if (!DATA.test(data ?? '') || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) throw new Error('Data inválida');
    out.data = data;
  }
  if (descricao !== undefined || !parcial) {
    const d = descricao?.trim();
    if (!d) throw new Error('Informe a descrição');
    if (d.length > 120) throw new Error('Descrição muito longa (máx. 120 caracteres)');
    out.descricao = d;
  }
  if (valorCentavos !== undefined || !parcial) {
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('O valor deve ser maior que zero');
    out.valorCentavos = valorCentavos;
  }
  return out;
}

/** Fatura (e a importação que ela exige) do mês de contas; cria se ainda não existe. */
function faturaDoMes(db, referencia) {
  garantirBanco(db, BANCO);
  db.prepare(`INSERT OR IGNORE INTO importacoes (banco, formato, arquivo_nome, arquivo_hash, qtd_transacoes)
              VALUES (?, 'manual', ?, ?, 0)`).run(BANCO, `Contas ${referencia}`, `manual:${BANCO}:${referencia}`);
  const imp = db.prepare('SELECT id FROM importacoes WHERE arquivo_hash = ?').get(`manual:${BANCO}:${referencia}`);
  db.prepare('INSERT OR IGNORE INTO faturas (banco, referencia, importacao_id) VALUES (?, ?, ?)').run(BANCO, referencia, imp.id);
  return db.prepare('SELECT id FROM faturas WHERE banco = ? AND referencia = ?').get(BANCO, referencia).id;
}

/** Apaga a fatura e a importação de um mês de contas que ficou sem lançamentos. */
function limparMes(db, faturaId) {
  if (db.prepare('SELECT 1 FROM transacoes WHERE fatura_id = ? LIMIT 1').get(faturaId)) return;
  const f = db.prepare('SELECT importacao_id FROM faturas WHERE id = ? AND banco = ?').get(faturaId, BANCO);
  if (!f) return;
  db.prepare('DELETE FROM faturas WHERE id = ?').run(faturaId);
  db.prepare("DELETE FROM importacoes WHERE id = ? AND formato = 'manual'").run(f.importacao_id);
}

function aplicarCategoria(db, id, faturaId, categoriaId) {
  if (categoriaId != null) definirCategoria(db, id, categoriaId);
  else {
    db.prepare('UPDATE transacoes SET categoria_id = NULL, regra_id = NULL, categoria_origem = NULL WHERE id = ?').run(id);
    reclassificar(db, { faturaId });
  }
}

function emTransacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Lança uma conta. Sem categoria, as regras automáticas decidem (como numa importação). */
export function lancarConta(db, { data, descricao, valorCentavos, categoriaId = null }) {
  const v = validar({ data, descricao, valorCentavos });
  return emTransacao(db, () => {
    const faturaId = faturaDoMes(db, v.data.slice(0, 7));
    const r = db.prepare(`INSERT INTO transacoes (banco, fatura_id, data, descricao, descricao_original, chave,
        valor_centavos, tipo, manual, hash) VALUES (?, ?, ?, ?, ?, ?, ?, 'compra', 1, ?)`)
      .run(BANCO, faturaId, v.data, v.descricao, v.descricao, chaveDe(v.descricao), v.valorCentavos, `manual:${randomUUID()}`);
    const id = Number(r.lastInsertRowid);
    aplicarCategoria(db, id, faturaId, categoriaId);
    return { id };
  });
}

function contaManual(db, id) {
  const t = db.prepare('SELECT id, fatura_id, data, manual FROM transacoes WHERE id = ?').get(id);
  if (!t) throw new Error('Lançamento não encontrado');
  if (!t.manual) throw new Error('Só contas lançadas à mão podem ser alteradas por aqui');
  return t;
}

/** Edita uma conta lançada à mão. `categoriaId: null` devolve a categoria às regras. */
export function editarConta(db, id, { data, descricao, valorCentavos, categoriaId } = {}) {
  const v = validar({ data, descricao, valorCentavos }, true);
  return emTransacao(db, () => {
    const t = contaManual(db, id);
    let faturaId = t.fatura_id;
    if (v.data && v.data.slice(0, 7) !== t.data.slice(0, 7)) faturaId = faturaDoMes(db, v.data.slice(0, 7));
    db.prepare(`UPDATE transacoes SET fatura_id = ?, data = coalesce(?, data),
        descricao = coalesce(?, descricao), descricao_original = coalesce(?, descricao_original),
        chave = coalesce(?, chave), valor_centavos = coalesce(?, valor_centavos) WHERE id = ?`)
      .run(faturaId, v.data ?? null, v.descricao ?? null, v.descricao ?? null,
        v.descricao ? chaveDe(v.descricao) : null, v.valorCentavos ?? null, id);
    if (categoriaId !== undefined) aplicarCategoria(db, id, faturaId, categoriaId);
    else if (v.descricao) reclassificar(db, { faturaId }); // descrição nova pode casar com outra regra
    if (faturaId !== t.fatura_id) limparMes(db, t.fatura_id);
    return { id };
  });
}

/** Apaga uma conta lançada à mão (e o mês de contas, se ficar vazio). */
export function apagarConta(db, id) {
  return emTransacao(db, () => {
    const t = contaManual(db, id);
    db.prepare('DELETE FROM transacoes WHERE id = ?').run(id);
    limparMes(db, t.fatura_id);
    return { ok: true };
  });
}
