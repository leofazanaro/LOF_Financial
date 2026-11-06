-- Parte do aporte que é extraordinária (doação, herança, venda de um bem): conta como aporte
-- (não é rendimento), mas fica fora da média de aportes, que mede o ritmo habitual.
ALTER TABLE patrimonio_aportes ADD COLUMN extraordinario_centavos INTEGER NOT NULL DEFAULT 0
  CHECK (extraordinario_centavos >= 0);
