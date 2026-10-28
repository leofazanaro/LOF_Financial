-- Classificação: regras automáticas + escolha manual do usuário.
-- A descrição original do banco nunca é alterada (transacoes.descricao_original);
-- a categoria é só um rótulo ligado à transação.

CREATE TABLE IF NOT EXISTS regras (
  id            INTEGER PRIMARY KEY,
  padrao        TEXT NOT NULL,                       -- texto procurado na descrição
  tipo_match    TEXT NOT NULL DEFAULT 'contem' CHECK (tipo_match IN ('contem', 'regex')),
  categoria_id  INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  banco         TEXT,                                -- NULL = vale para todos os bancos
  origem        TEXT NOT NULL DEFAULT 'usuario' CHECK (origem IN ('padrao', 'usuario')),
  criada_em     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (padrao, tipo_match, banco)
);

ALTER TABLE transacoes ADD COLUMN categoria_origem TEXT
  CHECK (categoria_origem IN ('regra', 'manual'));     -- NULL = sem categoria
ALTER TABLE transacoes ADD COLUMN regra_id INTEGER REFERENCES regras(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO categorias (nome, cor) VALUES
  ('Mercado',            '#2e7d32'),
  ('Alimentação',        '#ef6c00'),
  ('Veículo/Transporte', '#1565c0'),
  ('Assinaturas',        '#6a1b9a'),
  ('Compras online',     '#f9a825'),
  ('Eletrônicos',        '#00838f'),
  ('Lazer/Jogos',        '#ad1457'),
  ('Telefonia',          '#4e342e'),
  ('Saúde',              '#c62828'),
  ('Casa',               '#558b2f'),
  ('Outros',             '#757575');

WITH r(padrao, categoria) AS (VALUES
  ('MAX PIRACICABA', 'Mercado'), ('CARREFOUR', 'Mercado'), ('ASSAI', 'Mercado'),
  ('ATACADAO', 'Mercado'), ('PAO DE ACUCAR', 'Mercado'), ('SUPERMERCADO', 'Mercado'),
  ('PANIFICADORA', 'Alimentação'), ('PADARIA', 'Alimentação'), ('ACAI', 'Alimentação'),
  ('IFOOD', 'Alimentação'), ('RESTAURANTE', 'Alimentação'), ('LANCHONETE', 'Alimentação'),
  ('SHELL', 'Veículo/Transporte'), ('IPIRANGA', 'Veículo/Transporte'), ('POSTO', 'Veículo/Transporte'),
  ('ABAST', 'Veículo/Transporte'), ('ESTACAOLUB', 'Veículo/Transporte'), ('UBER', 'Veículo/Transporte'),
  ('NETFLIX', 'Assinaturas'), ('HBOMAX', 'Assinaturas'), ('YOUTUBEPREMIUM', 'Assinaturas'),
  ('SPOTIFY', 'Assinaturas'), ('GOOGLE ONE', 'Assinaturas'), ('APPLE.COM/BILL', 'Assinaturas'),
  ('MELIMAIS', 'Assinaturas'), ('AMAZON PRIME', 'Assinaturas'),
  ('MERCADOLIVRE', 'Compras online'), ('MERCADOPAGO', 'Compras online'), ('ALIEXPRESS', 'Compras online'),
  ('SHOPEE', 'Compras online'), ('AMAZON', 'Compras online'), ('NETSHOES', 'Compras online'),
  ('KABUM', 'Eletrônicos'), ('PICHAU', 'Eletrônicos'),
  ('STEAM', 'Lazer/Jogos'), ('EPICGAMES', 'Lazer/Jogos'), ('PLAY BOOKS', 'Lazer/Jogos'),
  ('RECARGA', 'Telefonia'),
  ('FARMACIA', 'Saúde'), ('DROGA', 'Saúde')
)
INSERT OR IGNORE INTO regras (padrao, categoria_id, origem)
SELECT r.padrao, c.id, 'padrao' FROM r JOIN categorias c ON c.nome = r.categoria;
