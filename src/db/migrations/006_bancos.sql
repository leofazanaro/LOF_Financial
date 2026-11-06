-- Cadastro dos bancos/cartões. `codigo` é o identificador gravado em transacoes.banco pelos
-- importadores ('nubank', 'inter'); nome e cor são só de exibição e podem ser editados.
CREATE TABLE IF NOT EXISTS bancos (
  codigo           TEXT PRIMARY KEY,
  nome             TEXT NOT NULL,
  cor              TEXT,
  dia_fechamento   INTEGER CHECK (dia_fechamento BETWEEN 1 AND 31),
  dia_vencimento   INTEGER CHECK (dia_vencimento BETWEEN 1 AND 31),
  limite_centavos  INTEGER CHECK (limite_centavos > 0),
  observacao       TEXT,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Apelido por cartão (final de 4 dígitos), ex.: "•0813" -> "Virtual", "•7510" -> "Físico".
CREATE TABLE IF NOT EXISTS cartoes (
  banco    TEXT NOT NULL REFERENCES bancos(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  final    TEXT NOT NULL,
  apelido  TEXT NOT NULL,
  PRIMARY KEY (banco, final)
);

INSERT OR IGNORE INTO bancos (codigo, nome, cor) VALUES
  ('nubank', 'Nubank', '#6250d6'),
  ('inter',  'Inter',  '#eb6834');

-- Qualquer outro banco que já tenha lançamentos.
INSERT OR IGNORE INTO bancos (codigo, nome) SELECT DISTINCT banco, banco FROM transacoes;
