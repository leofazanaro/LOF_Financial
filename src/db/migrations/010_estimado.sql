-- Anotações estimadas (reconstruídas a partir de aportes), separadas das anotações reais.
-- Uma linha em patrimonio_aportes existe para toda data anotada; o indicador fica nela.
ALTER TABLE patrimonio_aportes ADD COLUMN estimado INTEGER NOT NULL DEFAULT 0 CHECK (estimado IN (0, 1));
