-- Contas pagas fora do cartão (aluguel, luz...), lançadas à mão. Viram transações do banco 'contas'
-- numa "fatura" por mês de vencimento, então entram em todos os totais, categorias e análises.
INSERT OR IGNORE INTO bancos (codigo, nome, cor) VALUES ('contas', 'Contas', '#8a8a85');

-- 1 = lançada à mão: pode ser editada e apagada pela tela.
ALTER TABLE transacoes ADD COLUMN manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1));
