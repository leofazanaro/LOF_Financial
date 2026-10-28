-- Nova regra de chave do estabelecimento (sem prefixo de intermediador e pontuação):
-- recalculada pela aplicação após esta migração.
-- Regras padrão adicionais para redes comuns.
WITH r(padrao, categoria) AS (VALUES
  ('TENDA ATACADO', 'Mercado'), ('SAMS CLUB', 'Mercado'), ('JAU SERVE', 'Mercado'), ('OXXO', 'Mercado'),
  ('HORTIFRUTI', 'Mercado'), ('SACOLAO', 'Mercado'), ('ACOUGUE', 'Mercado'), ('CASA DE CARNES', 'Mercado'),
  ('FRIOS', 'Mercado'), ('ATACADISTA', 'Mercado'), ('SAVEGNAGO', 'Mercado'), ('GOOD BOM', 'Mercado'),
  ('RESTAUR', 'Alimentação'), ('REFEICO', 'Alimentação'), ('ALIMENTACAO', 'Alimentação'), ('OUTBACK', 'Alimentação'),
  ('LANCHES', 'Alimentação'), ('PIZZ', 'Alimentação'), ('BURGER', 'Alimentação'), ('MCDONALDS', 'Alimentação'),
  ('CAFE', 'Alimentação'), ('SORVET', 'Alimentação'), ('CHURRASC', 'Alimentação'),
  ('99APP', 'Veículo/Transporte'), ('ESTACIONAMENTO', 'Veículo/Transporte'), ('AUTO POSTO', 'Veículo/Transporte'),
  ('SEM PARAR', 'Veículo/Transporte'), ('CONECTCAR', 'Veículo/Transporte'),
  ('RAIA', 'Saúde'), ('PAGUE MENOS', 'Saúde'), ('PANVEL', 'Saúde'),
  ('SHOPPING INTER', 'Compras online'), ('MAGALU', 'Compras online'), ('MAGAZINELUIZA', 'Compras online'),
  ('GODADDY', 'Assinaturas'), ('DISNEY', 'Assinaturas'), ('PRIME VIDEO', 'Assinaturas'), ('DEEZER', 'Assinaturas'),
  ('LEROY MERLIN', 'Casa'), ('TELHANORTE', 'Casa'), ('C&C', 'Casa')
)
INSERT OR IGNORE INTO regras (padrao, categoria_id, origem)
SELECT r.padrao, c.id, 'padrao' FROM r JOIN categorias c ON c.nome = r.categoria
WHERE NOT EXISTS (SELECT 1 FROM regras x WHERE x.padrao = r.padrao);
