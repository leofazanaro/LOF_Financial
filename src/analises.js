// Análises sobre os lançamentos: parcelas futuras, assinaturas, orçamento e comparação com a média.
// "Mês" é sempre o mês de referência da fatura (YYYY-MM). Valores em centavos.
// Itens desconsiderados não entram em nenhuma análise.

const CONSIDERADA = 't.desconsiderada = 0';

/** '2026-01' + 2 -> '2026-03' */
export function somarMeses(ref, n) {
  const [a, m] = ref.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Última fatura importada de cada banco: { nubank: '2026-01', inter: '2026-01' } */
function ultimaReferenciaPorBanco(db) {
  return Object.fromEntries(db.prepare('SELECT banco, max(referencia) AS ref FROM faturas GROUP BY banco').all()
    .map((r) => [r.banco, r.ref]));
}

export function ultimaReferencia(db) {
  return db.prepare('SELECT max(referencia) AS ref FROM faturas').get().ref;
}

// ---------- 1. parcelas futuras ----------

/**
 * Projeta as parcelas que ainda vão cair nas próximas faturas.
 *
 * Um parcelamento é identificado por banco + cartão + estabelecimento + valor + nº de parcelas +
 * mês da 1ª parcela (mês da fatura − parcela atual + 1). Vale a observação mais recente; ele só é
 * projetado se apareceu na última fatura importada daquele banco — se uma fatura mais nova não o
 * trouxe, foi quitado/antecipado.
 */
export function parcelasFuturas(db, { banco, cartao } = {}) {
  const where = ['t.parcela_total IS NOT NULL', "t.tipo = 'compra'", CONSIDERADA];
  const args = [];
  if (banco) { where.push('t.banco = ?'); args.push(banco); }
  if (cartao) { where.push('t.cartao_final = ?'); args.push(cartao); }
  const linhas = db.prepare(`SELECT t.id, t.banco, t.cartao_final, t.chave, t.descricao, a.apelido,
      t.valor_centavos, t.parcela_atual, t.parcela_total, f.referencia, c.nome AS categoria
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
    LEFT JOIN categorias c ON c.id = t.categoria_id
    LEFT JOIN apelidos a ON a.chave = t.chave
    WHERE ${where.join(' AND ')}`).all(...args);

  const ultimas = ultimaReferenciaPorBanco(db);
  const grupos = new Map();
  for (const l of linhas) {
    const inicio = somarMeses(l.referencia, -(l.parcela_atual - 1));
    const k = [l.banco, l.cartao_final, l.chave, l.valor_centavos, l.parcela_total, inicio].join('|');
    const g = grupos.get(k);
    if (!g || l.referencia > g.referencia) grupos.set(k, { ...l, inicio, qtd: 1 });
    else if (l.referencia === g.referencia) g.qtd++; // parcelamentos idênticos na mesma fatura
  }

  const parcelamentos = [];
  const porMes = new Map();
  for (const p of grupos.values()) {
    const restantes = p.parcela_total - p.parcela_atual;
    if (restantes <= 0 || p.referencia !== ultimas[p.banco]) continue;
    const valor = p.valor_centavos * p.qtd;
    for (let k = 1; k <= restantes; k++) {
      const ref = somarMeses(p.referencia, k);
      const mes = porMes.get(ref) ?? { referencia: ref, total: 0, porBanco: {} };
      mes.total += valor;
      mes.porBanco[p.banco] = (mes.porBanco[p.banco] ?? 0) + valor;
      porMes.set(ref, mes);
    }
    parcelamentos.push({
      banco: p.banco, cartao: p.cartao_final, nome: p.apelido ?? p.descricao, descricao: p.descricao,
      categoria: p.categoria, qtd: p.qtd, valorParcela: p.valor_centavos,
      parcelaAtual: p.parcela_atual, parcelaTotal: p.parcela_total, restantes,
      restanteCentavos: valor * restantes, terminaEm: somarMeses(p.referencia, restantes),
    });
  }
  parcelamentos.sort((a, b) => b.restanteCentavos - a.restanteCentavos);
  const meses = [...porMes.values()].sort((a, b) => a.referencia.localeCompare(b.referencia));
  return {
    meses,
    parcelamentos,
    totalRestante: parcelamentos.reduce((s, p) => s + p.restanteCentavos, 0),
    proximoMes: meses[0] ?? null,
  };
}

// ---------- 2. assinaturas ----------

/** Histórico mensal de cada estabelecimento (só compras à vista). */
function historicoPorEstabelecimento(db) {
  const linhas = db.prepare(`SELECT t.banco, t.chave, f.referencia, sum(t.valor_centavos) AS valor, count(*) AS qtd,
      max(t.descricao) AS descricao, max(c.nome) AS categoria
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
    LEFT JOIN categorias c ON c.id = t.categoria_id
    WHERE t.tipo = 'compra' AND t.parcela_total IS NULL AND ${CONSIDERADA}
    GROUP BY t.banco, t.chave, f.referencia ORDER BY f.referencia`).all();
  const mapa = new Map();
  for (const l of linhas) {
    const k = `${l.banco}|${l.chave}`;
    if (!mapa.has(k)) mapa.set(k, { banco: l.banco, chave: l.chave, descricao: l.descricao, categoria: l.categoria, meses: [] });
    mapa.get(k).meses.push({ referencia: l.referencia, valor: l.valor, qtd: l.qtd });
  }
  return mapa;
}

/**
 * Assinaturas confirmadas, com custo e alertas, e sugestões de novas.
 * Sugestão: cobrança à vista que aparece em 2+ meses com valor parecido (±20%),
 * ou que está na categoria "Assinaturas".
 */
export function assinaturas(db) {
  const hist = historicoPorEstabelecimento(db);
  const ultimas = ultimaReferenciaPorBanco(db);
  const apelidos = new Map(db.prepare('SELECT chave, apelido FROM apelidos').all().map((a) => [a.chave, a.apelido]));
  const cadastradas = db.prepare('SELECT * FROM assinaturas').all();
  const conhecidas = new Set(cadastradas.map((a) => `${a.banco}|${a.chave}`));

  const ativas = cadastradas.filter((a) => a.status === 'ativa').map((a) => {
    const meses = hist.get(`${a.banco}|${a.chave}`)?.meses ?? [];
    const ultimo = meses.at(-1);
    const anterior = meses.at(-2);
    const alertas = [];
    if (ultimo && meses.length === 1 && ultimo.referencia === ultimas[a.banco]) alertas.push({ tipo: 'nova' });
    if (ultimo && anterior && ultimo.valor !== anterior.valor) {
      alertas.push({ tipo: 'preco', de: anterior.valor, para: ultimo.valor });
    }
    if (!ultimo || ultimo.referencia < ultimas[a.banco]) alertas.push({ tipo: 'ausente' });
    return {
      id: a.id, banco: a.banco, chave: a.chave, nome: a.nome,
      valorMensal: ultimo?.valor ?? 0, ultimaCobranca: ultimo?.referencia ?? null,
      primeiraCobranca: meses[0]?.referencia ?? null, historico: meses, alertas,
    };
  }).sort((a, b) => b.valorMensal - a.valorMensal);

  const sugestoes = [];
  for (const [k, h] of hist) {
    if (conhecidas.has(k)) continue;
    const valores = h.meses.map((m) => m.valor);
    const media = valores.reduce((s, v) => s + v, 0) / valores.length;
    // Recorrente: 3+ meses, uma cobrança por mês e valor estável (±20%). Lugares frequentados
    // várias vezes no mês (padaria, mercado) não entram.
    const recorrente = h.meses.length >= 3 && h.meses.every((m) => m.qtd === 1)
      && valores.every((v) => Math.abs(v - media) <= media * 0.2);
    // Qualquer categoria cujo nome fale em assinatura (sobrevive a renomear para "Assinaturas e serviços").
    const naCategoria = /assinatura/i.test(h.categoria ?? '');
    if (!recorrente && !naCategoria) continue;
    sugestoes.push({
      banco: h.banco, chave: h.chave, nome: apelidos.get(h.chave) ?? h.descricao,
      valor: h.meses.at(-1).valor, meses: h.meses.length,
      motivo: recorrente ? `cobrada em ${h.meses.length} meses com valor parecido` : `está na categoria ${h.categoria}`,
    });
  }

  // Ausentes (provavelmente canceladas) não entram no custo mensal.
  const mensal = ativas.filter((a) => !a.alertas.some((x) => x.tipo === 'ausente')).reduce((s, a) => s + a.valorMensal, 0);
  return { ativas, sugestoes, custoMensal: mensal, custoAnual: mensal * 12 };
}

export function salvarAssinatura(db, { banco, chave, nome, status = 'ativa' }) {
  db.prepare(`INSERT INTO assinaturas (banco, chave, nome, status) VALUES (?, ?, ?, ?)
              ON CONFLICT (banco, chave) DO UPDATE SET nome = excluded.nome, status = excluded.status`)
    .run(banco, chave, nome.trim(), status);
}

export function removerAssinatura(db, id) {
  if (!db.prepare('DELETE FROM assinaturas WHERE id = ?').run(id).changes) throw new Error(`Assinatura ${id} não existe`);
}

// ---------- 3. orçamento ----------

/** Gasto do mês por categoria comparado ao limite. Status: ok < 80% ≤ atencao < 100% ≤ estourado. */
export function orcamento(db, referencia = ultimaReferencia(db)) {
  if (!referencia) return { referencia: null, itens: [] };
  const linhas = db.prepare(`SELECT c.id, c.nome, o.limite_centavos AS limite,
      coalesce((SELECT sum(t.valor_centavos) FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
        WHERE t.categoria_id = c.id AND f.referencia = ? AND ${CONSIDERADA}), 0) AS gasto
    FROM categorias c LEFT JOIN orcamentos o ON o.categoria_id = c.id
    ORDER BY o.limite_centavos IS NULL, c.nome`).all(referencia);
  const itens = linhas.filter((l) => l.limite || l.gasto).map((l) => {
    const pct = l.limite ? l.gasto / l.limite : null;
    return {
      ...l, pct,
      status: pct == null ? 'sem-limite' : pct >= 1 ? 'estourado' : pct >= 0.8 ? 'atencao' : 'ok',
      disponivel: l.limite ? l.limite - l.gasto : null,
    };
  });
  const comLimite = itens.filter((i) => i.limite);
  return {
    referencia,
    itens,
    totalLimite: comLimite.reduce((s, i) => s + i.limite, 0),
    totalGastoComLimite: comLimite.reduce((s, i) => s + i.gasto, 0),
  };
}

export function definirOrcamento(db, categoriaId, limiteCentavos) {
  if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(categoriaId)) throw new Error('Categoria não encontrada');
  if (limiteCentavos == null) {
    db.prepare('DELETE FROM orcamentos WHERE categoria_id = ?').run(categoriaId);
    return;
  }
  if (!Number.isInteger(limiteCentavos) || limiteCentavos <= 0) throw new Error('O limite deve ser maior que zero');
  db.prepare(`INSERT INTO orcamentos (categoria_id, limite_centavos) VALUES (?, ?)
              ON CONFLICT (categoria_id) DO UPDATE SET limite_centavos = excluded.limite_centavos`)
    .run(categoriaId, limiteCentavos);
}

// ---------- 4. comparação com a média ----------

/**
 * Gasto de cada categoria no mês vs. a média dos até 3 meses anteriores que têm fatura.
 * Respeita os filtros de banco/cartão.
 */
export function comparacao(db, { referencia = ultimaReferencia(db), banco, cartao } = {}) {
  if (!referencia) return { referencia: null, mesesBase: [], itens: [] };
  const filtro = [];
  const args = [];
  if (banco) { filtro.push('t.banco = ?'); args.push(banco); }
  if (cartao) { filtro.push('t.cartao_final = ?'); args.push(cartao); }
  const extra = filtro.length ? `AND ${filtro.join(' AND ')}` : '';

  const mesesBase = db.prepare(`SELECT DISTINCT referencia FROM faturas WHERE referencia < ?
    ${banco ? 'AND banco = ?' : ''} ORDER BY referencia DESC LIMIT 3`)
    .all(...[referencia, ...(banco ? [banco] : [])]).map((r) => r.referencia).reverse();

  const porMes = db.prepare(`SELECT t.categoria_id AS id, coalesce(c.nome, 'Sem categoria') AS nome,
      f.referencia, sum(t.valor_centavos) AS total
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id LEFT JOIN categorias c ON c.id = t.categoria_id
    WHERE ${CONSIDERADA} AND f.referencia IN (${[referencia, ...mesesBase].map(() => '?').join(',')}) ${extra}
    GROUP BY t.categoria_id, f.referencia`).all(referencia, ...mesesBase, ...args);

  const cats = new Map();
  for (const l of porMes) {
    const c = cats.get(l.id) ?? { id: l.id, nome: l.nome, atual: 0, base: 0 };
    if (l.referencia === referencia) c.atual += l.total; else c.base += l.total;
    cats.set(l.id, c);
  }
  const itens = [...cats.values()].map((c) => {
    const media = mesesBase.length ? Math.round(c.base / mesesBase.length) : null;
    return {
      id: c.id, nome: c.nome, atual: c.atual, media,
      diferenca: media == null ? null : c.atual - media,
      pct: media ? (c.atual - media) / media : null,
    };
  }).sort((a, b) => Math.abs(b.diferenca ?? b.atual) - Math.abs(a.diferenca ?? a.atual));
  return { referencia, mesesBase, itens };
}
