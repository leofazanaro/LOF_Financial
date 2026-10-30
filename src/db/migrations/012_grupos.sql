-- Grupos de categorias: juntam categorias afins (ex.: "Alimentação" = Marmita + Restaurante)
-- para o gráfico por grupo. Cada categoria fica em no máximo um grupo; sem grupo, aparece sozinha.

CREATE TABLE IF NOT EXISTS grupos (
  id    INTEGER PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE
);

ALTER TABLE categorias ADD COLUMN grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL;
