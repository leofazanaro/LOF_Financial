-- Itens que não entram em relatórios, totais e análises (pagamentos de fatura, transferências...).
-- desconsiderada_origem: NULL = segue o automático (ainda não decidido);
--   'auto'   = decidido pelo sistema (pagamento de fatura ou regra de desconsiderar);
--   'manual' = decidido pelo usuário; nunca é alterado pelo automático.
ALTER TABLE transacoes ADD COLUMN desconsiderada INTEGER NOT NULL DEFAULT 0 CHECK (desconsiderada IN (0, 1));
ALTER TABLE transacoes ADD COLUMN desconsiderada_origem TEXT CHECK (desconsiderada_origem IN ('auto', 'manual'));
ALTER TABLE transacoes ADD COLUMN desconsiderada_motivo TEXT;
CREATE INDEX IF NOT EXISTS idx_transacoes_desconsiderada ON transacoes(desconsiderada);

-- Regras: lançamento cuja descrição casa com o padrão é desconsiderado automaticamente.
CREATE TABLE IF NOT EXISTS regras_desconsiderar (
  id          INTEGER PRIMARY KEY,
  padrao      TEXT NOT NULL,
  tipo_match  TEXT NOT NULL DEFAULT 'contem' CHECK (tipo_match IN ('contem', 'regex')),
  banco       TEXT,
  so_creditos INTEGER NOT NULL DEFAULT 0 CHECK (so_creditos IN (0, 1)),  -- 1 = só valores negativos
  motivo      TEXT,
  criada_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (padrao, tipo_match, banco, so_creditos)
);

-- Regra padrão: crédito com "PIX" na fatura é pagamento feito por Pix.
INSERT OR IGNORE INTO regras_desconsiderar (padrao, so_creditos, motivo) VALUES ('PIX', 1, 'Pagamento por Pix');
