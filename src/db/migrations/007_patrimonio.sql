-- Evolução patrimonial: o valor de cada carteira de investimento em cada data de anotação,
-- mais o aporte (ou resgate, negativo) feito desde a anotação anterior.

CREATE TABLE IF NOT EXISTS carteiras (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cor        TEXT,
  ordem      INTEGER NOT NULL DEFAULT 0,
  ativa      INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),   -- inativa: some do formulário, histórico fica
  criada_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patrimonio_valores (
  data            TEXT NOT NULL,                      -- YYYY-MM-DD
  carteira_id     INTEGER NOT NULL REFERENCES carteiras(id) ON DELETE CASCADE,
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos >= 0),
  PRIMARY KEY (data, carteira_id)
);

CREATE TABLE IF NOT EXISTS patrimonio_aportes (
  data            TEXT PRIMARY KEY,
  valor_centavos  INTEGER NOT NULL DEFAULT 0          -- positivo = aporte, negativo = resgate
);
