// Itens desconsiderados: ficam guardados, mas fora de relatórios, totais e análises.
//
// - Automático: pagamentos de fatura, lançamentos que casam com uma regra de desconsiderar e saídas
//   do extrato (banco 'pix') conciliadas com algo que já está no app (conta lançada ou pagamento de
//   fatura do cartão), para não contar o mesmo gasto duas vezes.
// - Manual: o usuário desconsidera (ou força considerar) qualquer item; o automático nunca
//   altera uma decisão manual.

import { normalizar } from './importers/util.js';
import { BANCO_EXTRATO } from './importers/ofx.js';

const MOTIVO_PAGAMENTO = 'Pagamento de fatura';
/** Distância máxima, em dias, entre a saída do extrato e a conta lançada / o pagamento na fatura. */
const JANELA_CONTA = 7;
const JANELA_FATURA = 5;

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

const dias = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const dataCurta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const mesAno = (ref) => `${ref.slice(5, 7)}/${ref.slice(0, 4)}`;

/**
 * Pareia, um para um, as saídas do extrato ainda sem motivo com contas lançadas (mesmo valor, até
 * JANELA_CONTA dias do vencimento) e pagamentos de fatura de cartão (mesmo valor, até JANELA_FATURA
 * dias). As saídas vão em ordem de data e cada uma fica com o candidato livre mais próximo.
 * Devolve Map(id da saída -> motivo).
 */
function conciliar(db, saidas) {
  const pares = new Map();
  if (!saidas.length) return pares;
  const candidatos = db.prepare(`SELECT t.id, t.banco, t.data, abs(t.valor_centavos) AS valor, f.referencia,
      coalesce(a.apelido, t.descricao) AS nome, b.nome AS banco_nome
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
    LEFT JOIN apelidos a ON a.chave = t.chave LEFT JOIN bancos b ON b.codigo = t.banco
    WHERE (t.banco = 'contas' AND t.desconsiderada = 0 AND t.valor_centavos > 0)
       OR (t.tipo = 'pagamento' AND t.banco NOT IN ('contas', ?))`).all(BANCO_EXTRATO);
  const usados = new Set();
  for (const s of [...saidas].sort((x, y) => x.data.localeCompare(y.data) || x.id - y.id)) {
    let melhor = null, distancia = Infinity;
    for (const c of candidatos) {
      if (usados.has(c.id) || c.valor !== s.valor_centavos) continue;
      const d = dias(s.data, c.data);
      if (d <= (c.banco === 'contas' ? JANELA_CONTA : JANELA_FATURA) && d < distancia) { melhor = c; distancia = d; }
    }
    if (!melhor) continue;
    usados.add(melhor.id);
    pares.set(s.id, melhor.banco === 'contas'
      ? `Conta já lançada: ${melhor.nome} (${dataCurta(melhor.data)})`
      : `Pagamento da fatura ${melhor.banco_nome ?? melhor.banco} ${mesAno(melhor.referencia)}`);
  }
  return pares;
}

/**
 * Reaplica o automático aos itens sem decisão manual (todos, ou só de uma fatura/banco).
 * As saídas do extrato são sempre recalculadas todas, porque a conciliação depende de outros
 * lançamentos (uma conta lançada agora pode parear com um Pix de qualquer mês).
 */
export function aplicarAutomatico(db, { faturaId, banco } = {}) {
  const regras = carregarRegras(db);
  const automaticas = `SELECT id, banco, fatura_id, tipo, data, descricao, descricao_original, valor_centavos,
      desconsiderada, desconsiderada_motivo FROM transacoes
    WHERE (desconsiderada_origem IS NULL OR desconsiderada_origem = 'auto')`;
  const upd = db.prepare(`UPDATE transacoes SET desconsiderada = ?, desconsiderada_origem = ?, desconsiderada_motivo = ?
                          WHERE id = ?`);
  const gravar = (t, motivo) => {
    const alvo = motivo ? 1 : 0;
    if (alvo === t.desconsiderada && (motivo ?? null) === (t.desconsiderada_motivo ?? null)) return;
    upd.run(alvo, motivo ? 'auto' : null, motivo, t.id);
  };
  const noEscopo = (t) => (faturaId == null || t.fatura_id === faturaId) && (banco == null || t.banco === banco);

  let desconsideradas = 0, conciliadas = 0;
  if (banco !== BANCO_EXTRATO) {
    const filtros = [], args = [BANCO_EXTRATO];
    if (faturaId != null) { filtros.push('AND fatura_id = ?'); args.push(faturaId); }
    if (banco != null) { filtros.push('AND banco = ?'); args.push(banco); }
    for (const t of db.prepare(`${automaticas} AND banco != ? ${filtros.join(' ')}`).all(...args)) {
      const motivo = motivoAutomatico(regras, t);
      if (motivo) desconsideradas++;
      gravar(t, motivo);
    }
  }

  // Extrato: regras primeiro; o que sobra tenta a conciliação.
  const extrato = db.prepare(`${automaticas} AND banco = ?`).all(BANCO_EXTRATO);
  const porRegra = new Map(extrato.map((t) => [t.id, motivoAutomatico(regras, t)]));
  const pares = conciliar(db, extrato.filter((t) => !porRegra.get(t.id) && t.valor_centavos > 0));
  for (const t of extrato) {
    const motivo = porRegra.get(t.id) ?? pares.get(t.id) ?? null;
    if (noEscopo(t) && motivo) {
      desconsideradas++;
      if (pares.has(t.id)) conciliadas++;
    }
    gravar(t, motivo);
  }
  return { desconsideradas, conciliadas };
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
    aplicarAutomatico(db, { banco: BANCO_EXTRATO }); // conta desconsiderada deixa de parear com o extrato
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
