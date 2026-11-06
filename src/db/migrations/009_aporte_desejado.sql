-- Aporte mensal que o usuário pretende fazer para chegar ao objetivo.
ALTER TABLE patrimonio_objetivo ADD COLUMN aporte_desejado_centavos INTEGER CHECK (aporte_desejado_centavos >= 0);
