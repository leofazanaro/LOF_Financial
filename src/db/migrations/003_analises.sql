-- Chave do estabelecimento: descrição limpa, maiúscula e sem acento. Agrupa lançamentos do mesmo
-- lugar em faturas diferentes (apelidos, assinaturas). Preenchida pela aplicação.
ALTER TABLE transacoes ADD COLUMN chave TEXT;
CREATE INDEX IF NOT EXISTS idx_transacoes_chave ON transacoes(chave);

-- Apelido exibido no lugar da descrição; a descrição e o texto original continuam guardados.
CREATE TABLE IF NOT EXISTS apelidos (
  chave    TEXT PRIMARY KEY,
  apelido  TEXT NOT NULL
);

-- Etiquetas livres (viagem, reembolsável...), várias por transação, independentes da categoria.
CREATE TABLE IF NOT EXISTS etiquetas (
  id    INTEGER PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS transacao_etiquetas (
  transacao_id  INTEGER NOT NULL REFERENCES transacoes(id) ON DELETE CASCADE,
  etiqueta_id   INTEGER NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  PRIMARY KEY (transacao_id, etiqueta_id)
);

-- Limite mensal de gasto por categoria (mês = mês da fatura).
CREATE TABLE IF NOT EXISTS orcamentos (
  categoria_id     INTEGER PRIMARY KEY REFERENCES categorias(id) ON DELETE CASCADE,
  limite_centavos  INTEGER NOT NULL CHECK (limite_centavos > 0)
);

-- Assinaturas confirmadas (ou sugestões descartadas) pelo usuário, por banco + estabelecimento.
CREATE TABLE IF NOT EXISTS assinaturas (
  id         INTEGER PRIMARY KEY,
  banco      TEXT NOT NULL,
  chave      TEXT NOT NULL,
  nome       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'ignorada')),
  criada_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (banco, chave)
);
