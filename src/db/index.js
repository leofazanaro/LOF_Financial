import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reclassificar } from '../categorias.js';
import { chaveDe } from '../importers/util.js';
import { aplicarAutomatico } from '../desconsiderar.js';
import { garantirBanco } from '../bancos.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? join(here, '../../data/financeiro.db');
const MIGRATIONS_DIR = join(here, 'migrations');

export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

const versaoFinal = (db) => db.prepare('PRAGMA user_version').get().user_version;

/** Aplica, em ordem, os arquivos NNN_*.sql com número maior que o PRAGMA user_version. */
function migrate(db) {
  const atual = db.prepare('PRAGMA user_version').get().user_version;
  const pendentes = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ versao: Number(f.slice(0, 3)), arquivo: f }))
    .filter((m) => m.versao > atual);

  for (const { versao, arquivo } of pendentes) {
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, arquivo), 'utf8'));
      db.exec(`PRAGMA user_version = ${versao}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${arquivo}: ${err.message}`);
    }
  }
  if (pendentes.length) {
    // Recalcula a chave do estabelecimento (a regra de chave muda com as migrações) e
    // converte apelidos/assinaturas gravados com a chave antiga.
    const upd = db.prepare('UPDATE transacoes SET chave = ? WHERE id = ?');
    for (const t of db.prepare('SELECT id, descricao, chave FROM transacoes').all()) {
      const nova = chaveDe(t.descricao);
      if (nova !== t.chave) upd.run(nova, t.id);
    }
    for (const a of db.prepare('SELECT chave, apelido FROM apelidos').all()) {
      if (chaveDe(a.chave) === a.chave) continue;
      db.prepare('DELETE FROM apelidos WHERE chave = ?').run(a.chave);
      db.prepare('INSERT OR IGNORE INTO apelidos (chave, apelido) VALUES (?, ?)').run(chaveDe(a.chave), a.apelido);
    }
    for (const a of db.prepare('SELECT id, chave FROM assinaturas').all()) {
      if (chaveDe(a.chave) !== a.chave) db.prepare('UPDATE OR IGNORE assinaturas SET chave = ? WHERE id = ?').run(chaveDe(a.chave), a.id);
    }
    // Dados que existiam antes das regras recebem a classificação automática.
    reclassificar(db);
    if (versaoFinal(db) >= 5) aplicarAutomatico(db);
  }
}

/**
 * Grava o resultado padronizado de um importador numa única transação SQL.
 * Linhas cujo hash já existe são ignoradas (contadas em `duplicadas`).
 */
export function saveImport(db, { arquivo, resultado }) {
  const { banco, formato, fatura, transacoes } = resultado;

  db.exec('BEGIN');
  try {
    garantirBanco(db, banco);
    const imp = db
      .prepare(`INSERT INTO importacoes (banco, formato, arquivo_nome, arquivo_hash, qtd_transacoes)
                VALUES (?, ?, ?, ?, 0)`)
      .run(banco, formato, arquivo.nome, arquivo.hash);
    const importacaoId = Number(imp.lastInsertRowid);

    // Mesma fatura pode chegar por outro arquivo (ex.: CSV e PDF); reaproveita a existente.
    db.prepare(`INSERT INTO faturas (banco, referencia, vencimento, total_centavos, importacao_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (banco, referencia) DO UPDATE SET
                  vencimento = COALESCE(excluded.vencimento, vencimento),
                  total_centavos = COALESCE(excluded.total_centavos, total_centavos)`)
      .run(banco, fatura.referencia, fatura.vencimento ?? null, fatura.totalCentavos ?? null, importacaoId);
    const faturaId = db
      .prepare('SELECT id FROM faturas WHERE banco = ? AND referencia = ?')
      .get(banco, fatura.referencia).id;

    const insert = db.prepare(`INSERT OR IGNORE INTO transacoes
      (banco, cartao_final, fatura_id, data, descricao, descricao_original, chave, valor_centavos,
       tipo, parcela_atual, parcela_total, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let inseridas = 0;
    for (const t of transacoes) {
      const r = insert.run(banco, t.cartaoFinal ?? null, faturaId, t.data, t.descricao, t.descricaoOriginal, t.chave,
        t.valorCentavos, t.tipo, t.parcelaAtual ?? null, t.parcelaTotal ?? null, t.hash);
      inseridas += Number(r.changes);
    }

    db.prepare('UPDATE importacoes SET qtd_transacoes = ? WHERE id = ?').run(inseridas, importacaoId);
    const { classificadas } = reclassificar(db, { faturaId });
    const { desconsideradas } = aplicarAutomatico(db, { faturaId });
    db.exec('COMMIT');
    return { importacaoId, faturaId, inseridas, duplicadas: transacoes.length - inseridas, classificadas, desconsideradas };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
