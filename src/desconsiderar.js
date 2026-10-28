// Itens desconsiderados: ficam guardados, mas fora de relatórios, totais e análises.
//
// - Automático: pagamentos de fatura e lançamentos que casam com uma regra de desconsiderar.
// - Manual: o usuário desconsidera (ou força considerar) qualquer item; o automático nunca
//   altera uma decisão manual.

import { normalizar } from './importers/util.js';

const MOTIVO_PAGAMENTO = 'Pagamento de fatura';

function carregarRegras(db) {
  return db.prepare('SELECT * FROM regras_desconsiderar ORDER BY id').all().map((r) => ({
    ...r,
    testar: r.tipo_match === 'regex'
      ? ((re) => (txt) => re.test(txt))(new RegExp(r.padrao, 'i'))
      : ((p) => (txt) => normalizar(txt).includes(p))(normalizar(r.padrao)),
  }));
}

/** Motivo para desconsiderar automaticamente, ou null se o item deve ser considerado. */
function motivoAutomatico(regras, t) {
  if (t.tipo === 'pagamento') return MOTIVO_PAGAMENTO;
  const r = regras.find((x) => (x.banco == null || x.banco === t.banco)
    && (!x.so_creditos || t.valor_centavos < 0)
    && (x.testar(t.descricao_original) || x.testar(t.descricao)));
  return r ? (r.motivo || `Regra: contém “${r.padrao}”`) : null;
}

/** Reaplica o automático aos itens sem decisão manual (todos, ou só de uma fatura). */
export function aplicarAutomatico(db, { faturaId } = {}) {
  const regras = carregarRegras(db);
  const linhas = db.prepare(`SELECT id, banco, tipo, descricao, descricao_original, valor_centavos,
      desconsiderada, desconsiderada_motivo FROM transacoes
    WHERE (desconsiderada_origem IS NULL OR desconsiderada_origem = 'auto')
    ${faturaId != null ? 'AND fatura_id = ?' : ''}`).all(...(faturaId != null ? [faturaId] : []));
  const upd = db.prepare(`UPDATE transacoes SET desconsiderada = ?, desconsiderada_origem = ?, desconsiderada_motivo = ?
                          WHERE id = ?`);
  let desconsideradas = 0;
  for (const t of linhas) {
    const motivo = motivoAutomatico(regras, t);
    if (motivo) desconsideradas++;
    const alvo = motivo ? 1 : 0;
    if (alvo === t.desconsiderada && (motivo ?? null) === (t.desconsiderada_motivo ?? null)) continue;
    upd.run(alvo, motivo ? 'auto' : null, motivo, t.id);
  }
  return { desconsideradas };
}

function emLote(db, fn) {
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

/** Decisão manual: desconsiderar (true) ou considerar (false) os itens. */
export function definirDesconsiderada(db, ids, desconsiderar, motivo = null) {
  return emLote(db, () => {
    const upd = db.prepare(`UPDATE transacoes SET desconsiderada = ?, desconsiderada_origem = 'manual',
                            desconsiderada_motivo = ? WHERE id = ?`);
    let n = 0;
    for (const id of ids) n += Number(upd.run(desconsiderar ? 1 : 0, desconsiderar ? (motivo?.trim() || null) : null, id).changes);
    if (n !== ids.length) throw new Error('Lançamento não encontrado');
    return { alteradas: n };
  });
}

/** Desfaz a decisão manual: os itens voltam a seguir o automático. */
export function voltarAoAutomatico(db, ids) {
  return emLote(db, () => {
    const upd = db.prepare(`UPDATE transacoes SET desconsiderada = 0, desconsiderada_origem = NULL,
                            desconsiderada_motivo = NULL WHERE id = ?`);
    for (const id of ids) upd.run(id);
    aplicarAutomatico(db);
    return { alteradas: ids.length };
  });
}

export function criarRegraDesconsiderar(db, { padrao, tipoMatch = 'contem', banco = null, soCreditos = false, motivo = null }) {
  const p = padrao?.trim();
  if (!p || p.length < 2) throw new Error('O texto da regra precisa ter pelo menos 2 caracteres');
  if (tipoMatch === 'regex') {
    try { new RegExp(p); } catch { throw new Error(`Expressão regular inválida: ${p}`); }
  }
  return emLote(db, () => {
    // UNIQUE não pega banco NULL repetido no SQLite; procura antes.
    const existente = db.prepare(`SELECT id FROM regras_desconsiderar
      WHERE padrao = ? AND tipo_match = ? AND banco IS ? AND so_creditos = ?`).get(p, tipoMatch, banco, soCreditos ? 1 : 0);
    if (existente) db.prepare('UPDATE regras_desconsiderar SET motivo = ? WHERE id = ?').run(motivo?.trim() || null, existente.id);
    else {
      db.prepare('INSERT INTO regras_desconsiderar (padrao, tipo_match, banco, so_creditos, motivo) VALUES (?, ?, ?, ?, ?)')
        .run(p, tipoMatch, banco, soCreditos ? 1 : 0, motivo?.trim() || null);
    }
    return aplicarAutomatico(db);
  });
}

export function removerRegraDesconsiderar(db, id) {
  return emLote(db, () => {
    if (!db.prepare('DELETE FROM regras_desconsiderar WHERE id = ?').run(id).changes) throw new Error('Regra não existe');
    return aplicarAutomatico(db);
  });
}

export function regrasDesconsiderar(db) {
  // Uso calculado na hora: quantos itens automáticos cada regra explica.
  const regras = carregarRegras(db);
  const autos = db.prepare(`SELECT banco, tipo, descricao, descricao_original, valor_centavos FROM transacoes
                            WHERE desconsiderada_origem = 'auto' AND tipo != 'pagamento'`).all();
  return regras.map(({ testar, ...r }) => ({
    ...r,
    usos: autos.filter((t) => (r.banco == null || r.banco === t.banco) && (!r.so_creditos || t.valor_centavos < 0)
      && (testar(t.descricao_original) || testar(t.descricao))).length,
  }));
}

export function listarDesconsiderados(db, { de, ate, banco, origem } = {}) {
  const where = ['t.desconsiderada = 1'];
  const args = [];
  if (de) { where.push('f.referencia >= ?'); args.push(de); }
  if (ate) { where.push('f.referencia <= ?'); args.push(ate); }
  if (banco) { where.push('t.banco = ?'); args.push(banco); }
  if (origem) { where.push('t.desconsiderada_origem = ?'); args.push(origem); }
  return db.prepare(`SELECT t.id, t.banco, t.cartao_final, f.referencia, t.data, t.descricao, t.descricao_original,
      a.apelido, t.valor_centavos, t.tipo, t.parcela_atual, t.parcela_total, c.nome AS categoria,
      t.desconsiderada_origem AS origem, t.desconsiderada_motivo AS motivo
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
    LEFT JOIN categorias c ON c.id = t.categoria_id LEFT JOIN apelidos a ON a.chave = t.chave
    WHERE ${where.join(' AND ')} ORDER BY t.data DESC, t.id DESC`).all(...args);
}
