-- Esquema padrão: todo importador converte o arquivo do banco para estas tabelas.
-- Valores monetários são guardados em centavos (INTEGER) para evitar erro de ponto flutuante.
-- Datas são texto ISO (YYYY-MM-DD).

CREATE TABLE IF NOT EXISTS importacoes (
  id            INTEGER PRIMARY KEY,
  banco         TEXT NOT NULL,              -- 'nubank', 'inter', ...
  formato       TEXT NOT NULL,              -- 'csv' | 'pdf'
  arquivo_nome  TEXT NOT NULL,
  arquivo_hash  TEXT NOT NULL UNIQUE,       -- sha256 do arquivo; impede importar o mesmo arquivo 2x
  importado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  qtd_transacoes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS faturas (
  id               INTEGER PRIMARY KEY,
  banco            TEXT NOT NULL,
  referencia       TEXT NOT NULL,           -- mês da fatura: 'YYYY-MM'
  vencimento       TEXT,                    -- 'YYYY-MM-DD' quando conhecido
  total_centavos   INTEGER,                 -- total informado pelo banco (NULL se o arquivo não traz)
  importacao_id    INTEGER NOT NULL REFERENCES importacoes(id) ON DELETE CASCADE,
  UNIQUE (banco, referencia)
);

CREATE TABLE IF NOT EXISTS categorias (
  id    INTEGER PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE,
  cor   TEXT
);

CREATE TABLE IF NOT EXISTS transacoes (
  id                  INTEGER PRIMARY KEY,
  banco               TEXT NOT NULL,        -- banco de origem: 'nubank', 'inter', ...
  cartao_final        TEXT,                 -- últimos 4 dígitos, quando o arquivo informa
  fatura_id           INTEGER NOT NULL REFERENCES faturas(id) ON DELETE CASCADE,
  data                TEXT NOT NULL,        -- data da compra/lançamento
  descricao           TEXT NOT NULL,        -- descrição limpa (sem o sufixo de parcela)
  descricao_original  TEXT NOT NULL,        -- texto exatamente como veio do banco
  valor_centavos      INTEGER NOT NULL,     -- positivo = gasto; negativo = pagamento/crédito/estorno
  tipo                TEXT NOT NULL CHECK (tipo IN ('compra', 'pagamento', 'estorno', 'tarifa')),
  parcela_atual       INTEGER,
  parcela_total       INTEGER,
  categoria_id        INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  hash                TEXT NOT NULL UNIQUE  -- identidade estável da linha para deduplicar
);

CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data);
CREATE INDEX IF NOT EXISTS idx_transacoes_banco ON transacoes(banco);
CREATE INDEX IF NOT EXISTS idx_transacoes_categoria ON transacoes(categoria_id);
