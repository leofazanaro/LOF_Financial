// Consultas de leitura para o painel. Valores sempre em centavos.
// Gasto = compras + tarifas − estornos. Itens desconsiderados (pagamentos de fatura, Pix de
// pagamento, o que o usuário marcar) ficam de fora de tudo.

export const CONSIDERADA = 't.desconsiderada = 0';

/**
 * Monta o WHERE comum a partir dos filtros da tela.
 * Período (de/ate) é pelo mês da fatura, que é como o cartão cobra.
 */
function filtrar({ de, ate, banco, cartao, categoria, etiqueta, q, pendentes } = {}) {
  const where = [CONSIDERADA];
  const args = [];
  if (de) { where.push('f.referencia >= ?'); args.push(de); }
  if (ate) { where.push('f.referencia <= ?'); args.push(ate); }
  if (banco) { where.push('t.banco = ?'); args.push(banco); }
  if (cartao) { where.push('t.cartao_final = ?'); args.push(cartao); }
  if (categoria === 'sem' || pendentes) where.push('t.categoria_id IS NULL');
  else if (categoria) { where.push('t.categoria_id = ?'); args.push(Number(categoria)); }
  if (etiqueta) {
    where.push('EXISTS (SELECT 1 FROM transacao_etiquetas te WHERE te.transacao_id = t.id AND te.etiqueta_id = ?)');
    args.push(Number(etiqueta));
  }
  if (q) {
    where.push('(t.descricao LIKE ? OR t.descricao_original LIKE ? OR a.apelido LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { sql: where.join(' AND '), args };
}

const FROM = `FROM transacoes t JOIN faturas f ON f.id = t.fatura_id
              LEFT JOIN categorias c ON c.id = t.categoria_id
              LEFT JOIN apelidos a ON a.chave = t.chave`;

// Etiquetas da transação como JSON [{id, nome}].
const ETIQUETAS = `(SELECT json_group_array(json_object('id', e.id, 'nome', e.nome))
  FROM transacao_etiquetas te JOIN etiquetas e ON e.id = te.etiqueta_id WHERE te.transacao_id = t.id) AS etiquetas`;
const comEtiquetas = (linhas) => linhas.map((l) => ({ ...l, etiquetas: JSON.parse(l.etiquetas) }));

export function opcoesDeFiltro(db) {
  return {
    bancos: db.prepare('SELECT DISTINCT banco FROM transacoes ORDER BY banco').all().map((r) => r.banco),
    cartoes: db.prepare(`SELECT DISTINCT t.banco, t.cartao_final, c.apelido FROM transacoes t
                         LEFT JOIN cartoes c ON c.banco = t.banco AND c.final = t.cartao_final
                         WHERE t.cartao_final IS NOT NULL ORDER BY t.banco, t.cartao_final`).all(),
    // Nome e cor de exibição de todos os bancos cadastrados (ordem alfabética do código = cor padrão estável).
    bancosInfo: db.prepare('SELECT codigo, nome, cor FROM bancos ORDER BY codigo').all(),
    referencias: db.prepare('SELECT DISTINCT referencia FROM faturas ORDER BY referencia').all().map((r) => r.referencia),
    categorias: db.prepare('SELECT id, nome, cor, grupo_id FROM categorias ORDER BY nome').all(),
    grupos: db.prepare('SELECT id, nome FROM grupos ORDER BY nome').all(),
    etiquetas: db.prepare('SELECT id, nome FROM etiquetas ORDER BY nome').all(),
  };
}

export function resumo(db, filtros) {
  const { sql, args } = filtrar(filtros);
  const desconsiderados = db.prepare(`SELECT count(*) AS qtd, coalesce(sum(t.valor_centavos), 0) AS total
    FROM transacoes t JOIN faturas f ON f.id = t.fatura_id WHERE t.desconsiderada = 1
    ${filtros?.de ? 'AND f.referencia >= ?' : ''} ${filtros?.ate ? 'AND f.referencia <= ?' : ''}
    ${filtros?.banco ? 'AND t.banco = ?' : ''}`).get(...[filtros?.de, filtros?.ate, filtros?.banco].filter(Boolean));
  const totais = db.prepare(`SELECT coalesce(sum(t.valor_centavos), 0) AS total, count(*) AS qtd,
      coalesce(sum(CASE WHEN t.categoria_id IS NULL THEN 1 END), 0) AS pendentes,
      coalesce(sum(CASE WHEN t.categoria_id IS NULL THEN t.valor_centavos END), 0) AS totalPendentes,
      coalesce(sum(CASE WHEN t.parcela_total IS NOT NULL THEN t.valor_centavos END), 0) AS totalParcelado
    ${FROM} WHERE ${sql}`).get(...args);

  const porCategoria = db.prepare(`SELECT t.categoria_id AS id, coalesce(c.nome, 'Sem categoria') AS nome,
      c.cor, c.grupo_id AS grupoId, g.nome AS grupo, sum(t.valor_centavos) AS total, count(*) AS qtd
    ${FROM} LEFT JOIN grupos g ON g.id = c.grupo_id
    WHERE ${sql} GROUP BY t.categoria_id ORDER BY total DESC`).all(...args);

  const porMesBanco = db.prepare(`SELECT f.referencia, t.banco, sum(t.valor_centavos) AS total
    ${FROM} WHERE ${sql} GROUP BY f.referencia, t.banco ORDER BY f.referencia, t.banco`).all(...args);

  const maiores = db.prepare(`SELECT t.id, t.data, t.banco, coalesce(a.apelido, t.descricao) AS descricao, t.valor_centavos,
      t.parcela_atual, t.parcela_total, c.nome AS categoria
    ${FROM} WHERE ${sql} ORDER BY t.valor_centavos DESC LIMIT 10`).all(...args);

  return { ...totais, porCategoria, porMesBanco, maiores, desconsiderados };
}

/** Gasto total do período (todos os bancos e cartões), para comparar com a renda. */
export function totalGasto(db, { de, ate } = {}) {
  const { sql, args } = filtrar({ de, ate });
  return db.prepare(`SELECT coalesce(sum(t.valor_centavos), 0) AS total ${FROM} WHERE ${sql}`).get(...args).total;
}

export function transacoes(db, filtros) {
  const { sql, args } = filtrar(filtros);
  return comEtiquetas(db.prepare(`SELECT t.id, t.banco, t.cartao_final, f.referencia, t.data, t.descricao,
      t.descricao_original, t.chave, a.apelido, t.valor_centavos, t.tipo, t.parcela_atual, t.parcela_total,
      t.categoria_id, c.nome AS categoria, t.categoria_origem, r.padrao AS regra, t.desconsiderada_origem, t.manual, ${ETIQUETAS}
    ${FROM} LEFT JOIN regras r ON r.id = t.regra_id
    WHERE ${sql} ORDER BY t.data DESC, t.id DESC`).all(...args));
}

export function regras(db) {
  return db.prepare(`SELECT r.id, r.padrao, r.tipo_match, r.banco, r.origem, r.categoria_id, c.nome AS categoria,
      (SELECT count(*) FROM transacoes t WHERE t.regra_id = r.id) AS usos
    FROM regras r JOIN categorias c ON c.id = r.categoria_id
    ORDER BY r.origem = 'usuario' DESC, c.nome, r.padrao`).all();
}

export function categoriasComUso(db) {
  return db.prepare(`SELECT c.id, c.nome, c.cor, c.grupo_id AS grupoId, count(t.id) AS qtd, coalesce(sum(t.valor_centavos), 0) AS total,
      (SELECT count(*) FROM regras r WHERE r.categoria_id = c.id) AS regras,
      (SELECT limite_centavos FROM orcamentos o WHERE o.categoria_id = c.id) AS limite,
      (SELECT max(t2.data) FROM transacoes t2 WHERE t2.categoria_id = c.id) AS ultimo
    FROM categorias c LEFT JOIN transacoes t ON t.categoria_id = c.id AND t.desconsiderada = 0
    GROUP BY c.id ORDER BY c.nome`).all();
}

export function gruposComUso(db) {
  return db.prepare(`SELECT g.id, g.nome, count(c.id) AS categorias
    FROM grupos g LEFT JOIN categorias c ON c.grupo_id = g.id
    GROUP BY g.id ORDER BY g.nome`).all();
}

export function etiquetas(db) {
  return db.prepare(`SELECT e.id, e.nome, count(t.id) AS qtd, coalesce(sum(t.valor_centavos), 0) AS total
    FROM etiquetas e LEFT JOIN transacao_etiquetas te ON te.etiqueta_id = e.id
    LEFT JOIN transacoes t ON t.id = te.transacao_id AND t.desconsiderada = 0
    GROUP BY e.id ORDER BY e.nome`).all();
}

export function importacoes(db) {
  return db.prepare(`SELECT i.id, i.banco, i.formato, i.arquivo_nome, i.importado_em, i.qtd_transacoes,
      f.referencia, f.total_centavos
    FROM importacoes i LEFT JOIN faturas f ON f.importacao_id = i.id WHERE i.formato <> 'manual' ORDER BY i.id DESC`).all();
}
