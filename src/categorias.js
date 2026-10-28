// Classificação de transações em categorias.
//
// - Automática: regras "texto contido" (ou regex) aplicadas à descrição. Regras do usuário
//   vencem as padrão; entre regras do mesmo tipo, vence o padrão mais longo (mais específico).
// - Manual: o usuário escolhe a categoria; transações manuais nunca são alteradas por regras.
// A descrição original do banco é preservada em transacoes.descricao_original.

import { normalizar } from './importers/util.js';

export { normalizar };

// Pagamentos de fatura não são gastos e ficam fora da classificação.
const TIPOS_CLASSIFICAVEIS = "('compra', 'estorno', 'tarifa')";

function carregarRegras(db) {
  return db.prepare(`SELECT id, padrao, tipo_match, categoria_id, banco, origem FROM regras
                     ORDER BY origem = 'usuario' DESC, length(padrao) DESC, id`).all()
    .map((r) => ({
      ...r,
      testar: r.tipo_match === 'regex'
        ? ((re) => (txt) => re.test(txt))(new RegExp(r.padrao, 'i'))
        : contem(r.padrao),
    }));
}

const compacto = (s) => normalizar(s).replace(/[^A-Z0-9]+/g, '');

/**
 * "Texto contido" ignorando maiúsculas, acentos e também espaços/pontuação:
 * a regra "BIG CHURROS" pega "BIG CHURROS DE PIRACIC" e "BIGCHURROS CENTRO".
 */
export function contem(padrao) {
  const p = normalizar(padrao);
  const pc = compacto(padrao);
  return (txt) => normalizar(txt).includes(p) || (pc.length > 0 && compacto(txt).includes(pc));
}

export function encontrarRegra(regras, { banco, descricao }) {
  return regras.find((r) => (r.banco == null || r.banco === banco) && r.testar(descricao)) ?? null;
}

/**
 * Reaplica as regras às transações não manuais (todas, ou só de uma fatura).
 * Transações que deixam de casar com alguma regra voltam a ficar sem categoria.
 */
export function reclassificar(db, { faturaId } = {}) {
  const regras = carregarRegras(db);
  const linhas = db.prepare(`SELECT id, banco, descricao, categoria_id, regra_id FROM transacoes
      WHERE (categoria_origem IS NULL OR categoria_origem = 'regra')
        AND tipo IN ${TIPOS_CLASSIFICAVEIS}
        ${faturaId != null ? 'AND fatura_id = ?' : ''}`)
    .all(...(faturaId != null ? [faturaId] : []));

  const upd = db.prepare(`UPDATE transacoes SET categoria_id = ?, regra_id = ?, categoria_origem = ?
                          WHERE id = ?`);
  let classificadas = 0, semCategoria = 0;
  for (const t of linhas) {
    const regra = encontrarRegra(regras, t);
    if (regra) classificadas++; else semCategoria++;
    if ((regra?.id ?? null) === t.regra_id && (regra?.categoria_id ?? null) === t.categoria_id) continue;
    upd.run(regra?.categoria_id ?? null, regra?.id ?? null, regra ? 'regra' : null, t.id);
  }
  return { classificadas, semCategoria };
}

export function buscarCategoria(db, nomeOuId) {
  // Aceita id ou nome, ignorando maiúsculas e acentos ("saude" encontra "Saúde").
  const cat = /^\d+$/.test(String(nomeOuId))
    ? db.prepare('SELECT * FROM categorias WHERE id = ?').get(Number(nomeOuId))
    : db.prepare('SELECT * FROM categorias').all().find((c) => normalizar(c.nome) === normalizar(String(nomeOuId).trim()));
  if (!cat) throw new Error(`Categoria não encontrada: "${nomeOuId}"`);
  return cat;
}

const COR = /^#[0-9a-f]{6}$/i;

function validarNome(db, nome, ignorarId = null) {
  const limpo = nome?.trim();
  if (!limpo) throw new Error('Informe o nome da categoria');
  if (limpo.length > 40) throw new Error('Nome muito longo (máx. 40 caracteres)');
  const igual = db.prepare('SELECT id, nome FROM categorias').all()
    .find((c) => c.id !== ignorarId && normalizar(c.nome) === normalizar(limpo));
  if (igual) throw new Error(`A categoria "${igual.nome}" já existe`);
  return limpo;
}

function validarCor(cor) {
  if (cor == null || cor === '') return null;
  if (!COR.test(cor)) throw new Error('Cor inválida (use #rrggbb)');
  return cor.toLowerCase();
}

export function criarCategoria(db, nome, cor = null) {
  nome = validarNome(db, nome);
  cor = validarCor(cor);
  const r = db.prepare('INSERT INTO categorias (nome, cor) VALUES (?, ?)').run(nome, cor);
  return Number(r.lastInsertRowid);
}

/** Renomeia e/ou troca a cor. Campos ausentes ficam como estão. */
export function editarCategoria(db, id, { nome, cor } = {}) {
  const atual = buscarCategoria(db, id);
  const novoNome = nome === undefined ? atual.nome : validarNome(db, nome, atual.id);
  const novaCor = cor === undefined ? atual.cor : validarCor(cor);
  db.prepare('UPDATE categorias SET nome = ?, cor = ? WHERE id = ?').run(novoNome, novaCor, atual.id);
  return { ...atual, nome: novoNome, cor: novaCor };
}

/**
 * Apaga a categoria. Com `moverPara`, lançamentos, regras e orçamento passam para a outra
 * categoria; sem ele, os lançamentos ficam sem categoria (e são reavaliados pelas regras) e as
 * regras e o orçamento da categoria são apagados.
 */
export function apagarCategoria(db, id, { moverPara = null } = {}) {
  const cat = buscarCategoria(db, id);
  const destino = moverPara != null ? buscarCategoria(db, moverPara) : null;
  if (destino?.id === cat.id) throw new Error('Escolha outra categoria para mover');

  db.exec('BEGIN');
  try {
    const qtd = db.prepare('SELECT count(*) AS n FROM transacoes WHERE categoria_id = ?').get(cat.id).n;
    if (destino) {
      db.prepare('UPDATE transacoes SET categoria_id = ? WHERE categoria_id = ?').run(destino.id, cat.id);
      db.prepare('UPDATE OR IGNORE regras SET categoria_id = ? WHERE categoria_id = ?').run(destino.id, cat.id);
      // Orçamento: o destino mantém o seu, se já tiver.
      db.prepare('UPDATE OR IGNORE orcamentos SET categoria_id = ? WHERE categoria_id = ?').run(destino.id, cat.id);
    } else {
      db.prepare(`UPDATE transacoes SET categoria_id = NULL, regra_id = NULL, categoria_origem = NULL
                  WHERE categoria_id = ?`).run(cat.id);
    }
    db.prepare('DELETE FROM categorias WHERE id = ?').run(cat.id); // regras/orçamento restantes: cascade
    const r = reclassificar(db);
    db.exec('COMMIT');
    return { lancamentos: qtd, movidosPara: destino?.nome ?? null, semCategoria: r.semCategoria };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Cria (ou atualiza) uma regra do usuário e reclassifica as transações automáticas.
 * Com `banco`, a regra vale só para aquele banco.
 */
export function criarRegra(db, { padrao, categoria, tipoMatch = 'contem', banco = null }) {
  const cat = buscarCategoria(db, categoria);
  if (tipoMatch === 'regex') {
    try { new RegExp(padrao); } catch { throw new Error(`Expressão regular inválida: ${padrao}`); }
  }
  const existente = db.prepare(`SELECT id FROM regras WHERE padrao = ? AND tipo_match = ? AND banco IS ?`)
    .get(padrao, tipoMatch, banco);
  if (existente) {
    db.prepare(`UPDATE regras SET categoria_id = ?, origem = 'usuario' WHERE id = ?`).run(cat.id, existente.id);
  } else {
    db.prepare(`INSERT INTO regras (padrao, tipo_match, categoria_id, banco, origem) VALUES (?, ?, ?, ?, 'usuario')`)
      .run(padrao, tipoMatch, cat.id, banco);
  }
  return reclassificar(db);
}

export function removerRegra(db, id) {
  const r = db.prepare('DELETE FROM regras WHERE id = ?').run(id);
  if (!r.changes) throw new Error(`Regra ${id} não existe`);
  return reclassificar(db);
}

/**
 * Escolha manual: fixa a categoria da transação (a automática deixa de valer para ela).
 * Com `criarRegra`, também cria uma regra com a descrição limpa para as próximas faturas.
 */
export function definirCategoria(db, transacaoId, categoria, { criarRegra: comRegra = false } = {}) {
  const t = db.prepare('SELECT id, descricao FROM transacoes WHERE id = ?').get(transacaoId);
  if (!t) throw new Error(`Transação ${transacaoId} não existe`);
  const cat = buscarCategoria(db, categoria);
  db.prepare(`UPDATE transacoes SET categoria_id = ?, regra_id = NULL, categoria_origem = 'manual' WHERE id = ?`)
    .run(cat.id, transacaoId);
  if (comRegra) criarRegra(db, { padrao: typeof comRegra === 'string' ? comRegra : t.descricao, categoria: cat.id });
  return cat;
}

/** Desfaz a escolha manual: a transação volta a seguir as regras. */
export function voltarParaAutomatico(db, transacaoId) {
  const r = db.prepare(`UPDATE transacoes SET categoria_id = NULL, regra_id = NULL, categoria_origem = NULL
                        WHERE id = ?`).run(transacaoId);
  if (!r.changes) throw new Error(`Transação ${transacaoId} não existe`);
  const { faturaId } = db.prepare('SELECT fatura_id AS faturaId FROM transacoes WHERE id = ?').get(transacaoId);
  reclassificar(db, { faturaId });
}

export function listarTransacoes(db, { pendentes = false, banco, categoria } = {}) {
  const where = [`t.tipo IN ${TIPOS_CLASSIFICAVEIS}`, 't.desconsiderada = 0'];
  const args = [];
  if (pendentes) where.push('t.categoria_id IS NULL');
  if (banco) { where.push('t.banco = ?'); args.push(banco); }
  if (categoria) { where.push('t.categoria_id = ?'); args.push(buscarCategoria(db, categoria).id); }
  return db.prepare(`SELECT t.id, t.banco, t.cartao_final, t.data, t.descricao, t.descricao_original,
        t.valor_centavos, c.nome AS categoria, t.categoria_origem, r.padrao AS regra
      FROM transacoes t
      LEFT JOIN categorias c ON c.id = t.categoria_id
      LEFT JOIN regras r ON r.id = t.regra_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.data DESC, t.id`).all(...args);
}
