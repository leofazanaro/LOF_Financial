-- Renda recebida (salário, freela...), lançada à mão. Conta no mês da data de recebimento.
CREATE TABLE IF NOT EXISTS rendas (
  id             INTEGER PRIMARY KEY,
  data           TEXT NOT NULL,                       -- YYYY-MM-DD
  descricao      TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  criada_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS rendas_data ON rendas (data);
