-- Vários objetivos de patrimônio (ex.: Fase 1, Fase 2): tira a restrição de um só (id = 1).
CREATE TABLE patrimonio_objetivo_novo (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                      TEXT,
  valor_centavos            INTEGER NOT NULL CHECK (valor_centavos > 0),
  data_alvo                 TEXT,                         -- YYYY-MM-DD ou NULL
  aporte_desejado_centavos  INTEGER CHECK (aporte_desejado_centavos >= 0)
);
INSERT INTO patrimonio_objetivo_novo (id, nome, valor_centavos, data_alvo, aporte_desejado_centavos)
  SELECT id, nome, valor_centavos, data_alvo, aporte_desejado_centavos FROM patrimonio_objetivo;
DROP TABLE patrimonio_objetivo;
ALTER TABLE patrimonio_objetivo_novo RENAME TO patrimonio_objetivo;
