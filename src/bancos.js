// Cadastro dos bancos e apelidos de cartões. O código do banco é o que os importadores gravam
// nos lançamentos; nome, cor e os demais campos são só informativos/de exibição.

import { normalizar } from './importers/util.js';

const COR = /^#[0-9a-f]{6}$/i;

/** Nomes usados quando um importador traz um banco ainda não cadastrado. */
const NOMES_PADRAO = { nubank: 'Nubank', inter: 'Inter', contas: 'Contas' };

export function garantirBanco(db, codigo) {
  db.prepare('INSERT OR IGNORE INTO bancos (codigo, nome) VALUES (?, ?)').run(codigo, NOMES_PADRAO[codigo] ?? codigo);
}

function validar(db, dados, codigoAtual = null) {
  const out = {};
  if (dados.nome !== undefined) {
    const nome = dados.nome?.trim();
    if (!nome) throw new Error('Informe o nome do banco');
    if (nome.length > 40) throw new Error('Nome muito longo (máx. 40 caracteres)');
    const igual = db.prepare('SELECT codigo, nome FROM bancos').all()
      .find((b) => b.codigo !== codigoAtual && normalizar(b.nome) === normalizar(nome));
    if (igual) throw new Error(`Já existe um banco chamado "${igual.nome}"`);
    out.nome = nome;
  }
  if (dados.cor !== undefined) {
    if (dados.cor && !COR.test(dados.cor)) throw new Error('Cor inválida (use #rrggbb)');
    out.cor = dados.cor ? dados.cor.toLowerCase() : null;
  }
  for (const campo of ['diaFechamento', 'diaVencimento']) {
    if (dados[campo] === undefined) continue;
    const v = dados[campo];
    if (v != null && (!Number.isInteger(v) || v < 1 || v > 31)) throw new Error('Dia deve ser entre 1 e 31');
    out[campo] = v ?? null;
  }
  if (dados.limiteCentavos !== undefined) {
    const v = dados.limiteCentavos;
    if (v != null && (!Number.isInteger(v) || v <= 0)) throw new Error('Limite deve ser maior que zero');
    out.limiteCentavos = v ?? null;
  }
  if (dados.observacao !== undefined) out.observacao = dados.observacao?.trim() || null;
  return out;
}

export function listarBancos(db) {
  const bancos = db.prepare(`SELECT b.*,
      (SELECT count(*) FROM transacoes t WHERE t.banco = b.codigo) AS lancamentos,
      (SELECT count(*) FROM faturas f WHERE f.banco = b.codigo) AS faturas,
      (SELECT max(referencia) FROM faturas f WHERE f.banco = b.codigo) AS ultima_fatura,
      (SELECT coalesce(sum(t.valor_centavos), 0) FROM transacoes t WHERE t.banco = b.codigo AND t.desconsiderada = 0) AS total
    FROM bancos b ORDER BY b.nome`).all();
  const cartoes = db.prepare(`SELECT t.banco, t.cartao_final AS final, c.apelido, count(*) AS lancamentos
    FROM transacoes t LEFT JOIN cartoes c ON c.banco = t.banco AND c.final = t.cartao_final
    WHERE t.cartao_final IS NOT NULL GROUP BY t.banco, t.cartao_final ORDER BY t.cartao_final`).all();
  return bancos.map((b) => ({ ...b, cartoes: cartoes.filter((c) => c.banco === b.codigo) }));
}

/** Cria um banco manualmente (para importadores futuros). O código vem do nome. */
export function criarBanco(db, dados) {
  const v = validar(db, { nome: dados.nome, cor: dados.cor ?? null, diaFechamento: dados.diaFechamento,
    diaVencimento: dados.diaVencimento, limiteCentavos: dados.limiteCentavos, observacao: dados.observacao });
  const codigo = normalizar(v.nome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!codigo) throw new Error('Nome inválido');
  if (db.prepare('SELECT 1 FROM bancos WHERE codigo = ?').get(codigo)) throw new Error(`Já existe um banco com o código "${codigo}"`);
  db.prepare(`INSERT INTO bancos (codigo, nome, cor, dia_fechamento, dia_vencimento, limite_centavos, observacao)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(codigo, v.nome, v.cor, v.diaFechamento ?? null, v.diaVencimento ?? null, v.limiteCentavos ?? null, v.observacao ?? null);
  return { codigo };
}

export function editarBanco(db, codigo, dados) {
  if (!db.prepare('SELECT 1 FROM bancos WHERE codigo = ?').get(codigo)) throw new Error('Banco não encontrado');
  const v = validar(db, dados, codigo);
  const colunas = { nome: 'nome', cor: 'cor', diaFechamento: 'dia_fechamento', diaVencimento: 'dia_vencimento',
    limiteCentavos: 'limite_centavos', observacao: 'observacao' };
  const campos = Object.keys(v);
  if (!campos.length) return;
  db.prepare(`UPDATE bancos SET ${campos.map((c) => `${colunas[c]} = ?`).join(', ')} WHERE codigo = ?`)
    .run(...campos.map((c) => v[c]), codigo);
}

/** Só apaga banco sem lançamentos — os dados de faturas não são apagados por aqui. */
export function apagarBanco(db, codigo) {
  if (codigo === 'contas') throw new Error('O banco "Contas" guarda as contas lançadas à mão e não pode ser apagado');
  const b = db.prepare('SELECT (SELECT count(*) FROM transacoes WHERE banco = ?) AS n').get(codigo);
  if (b.n > 0) throw new Error(`Este banco tem ${b.n} lançamentos importados; não pode ser apagado`);
  if (!db.prepare('DELETE FROM bancos WHERE codigo = ?').run(codigo).changes) throw new Error('Banco não encontrado');
}

export function definirApelidoCartao(db, banco, final, apelido) {
  if (!db.prepare('SELECT 1 FROM transacoes WHERE banco = ? AND cartao_final = ? LIMIT 1').get(banco, final)) {
    throw new Error('Cartão não encontrado');
  }
  const nome = apelido?.trim();
  if (!nome) db.prepare('DELETE FROM cartoes WHERE banco = ? AND final = ?').run(banco, final);
  else {
    if (nome.length > 30) throw new Error('Apelido muito longo (máx. 30 caracteres)');
    db.prepare(`INSERT INTO cartoes (banco, final, apelido) VALUES (?, ?, ?)
                ON CONFLICT (banco, final) DO UPDATE SET apelido = excluded.apelido`).run(banco, final, nome);
  }
}
