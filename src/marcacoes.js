// Apelidos de estabelecimentos e etiquetas livres nas transações.

/** Define (ou remove, com apelido vazio) o apelido de um estabelecimento. Vale para todas as faturas. */
export function definirApelido(db, chave, apelido) {
  if (!db.prepare('SELECT 1 FROM transacoes WHERE chave = ? LIMIT 1').get(chave)) {
    throw new Error('Estabelecimento não encontrado');
  }
  const nome = apelido?.trim();
  if (!nome) db.prepare('DELETE FROM apelidos WHERE chave = ?').run(chave);
  else {
    db.prepare(`INSERT INTO apelidos (chave, apelido) VALUES (?, ?)
                ON CONFLICT (chave) DO UPDATE SET apelido = excluded.apelido`).run(chave, nome);
  }
}

function obterEtiqueta(db, nome) {
  const limpo = nome.trim();
  if (!limpo) throw new Error('Nome da etiqueta vazio');
  db.prepare('INSERT OR IGNORE INTO etiquetas (nome) VALUES (?)').run(limpo);
  return db.prepare('SELECT id FROM etiquetas WHERE nome = ?').get(limpo).id;
}

/** Adiciona a etiqueta (criando-a se preciso) a uma ou mais transações. */
export function etiquetar(db, transacaoIds, nome) {
  const id = obterEtiqueta(db, nome);
  const ins = db.prepare('INSERT OR IGNORE INTO transacao_etiquetas (transacao_id, etiqueta_id) VALUES (?, ?)');
  let n = 0;
  for (const t of transacaoIds) n += Number(ins.run(t, id).changes);
  return { etiquetaId: id, adicionadas: n };
}

export function desetiquetar(db, transacaoId, etiquetaId) {
  db.prepare('DELETE FROM transacao_etiquetas WHERE transacao_id = ? AND etiqueta_id = ?').run(transacaoId, etiquetaId);
}

export function removerEtiqueta(db, etiquetaId) {
  if (!db.prepare('DELETE FROM etiquetas WHERE id = ?').run(etiquetaId).changes) throw new Error('Etiqueta não existe');
}
