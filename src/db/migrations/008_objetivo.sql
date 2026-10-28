-- Objetivo de patrimônio (um só): valor a alcançar e, opcionalmente, até quando.
CREATE TABLE IF NOT EXISTS patrimonio_objetivo (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  nome            TEXT,
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  data_alvo       TEXT                                   -- YYYY-MM-DD ou NULL
);
