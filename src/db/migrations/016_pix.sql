-- Saídas da conta corrente (Pix, boleto, débito...) importadas do OFX do extrato. Viram transações do
-- banco 'pix' numa "fatura" por mês da data, como as contas lançadas à mão.
INSERT OR IGNORE INTO bancos (codigo, nome, cor) VALUES ('pix', 'Pix', '#32bcad');

-- O pagamento do cartão feito pela conta já está na fatura. A conciliação pega o pagamento quando a
-- fatura foi importada; esta regra cobre o caso em que ela não foi.
INSERT OR IGNORE INTO regras_desconsiderar (padrao, banco, so_creditos, motivo)
  VALUES ('FATURA', 'pix', 0, 'Pagamento de fatura do cartão');
