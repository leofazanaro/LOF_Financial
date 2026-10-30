// Renda (salário, freela...) lançada à mão. Conta no mês da data de recebimento e é comparada
// com o que saiu no mesmo período: gastos (mês da fatura/vencimento) e aportes (mês da anotação).
import { totalGasto } from './consultas.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const REF = /^\d{4}-\d{2}$/;

function validar({ data, descricao, valorCentavos }, parcial = false) {
  const out = {};
  if (data !== undefined || !parcial) {
    if (!DATA.test(data ?? '') || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) throw new Error('Data inválida');
    out.data = data;
  }
  if (descricao !== undefined || !parcial) {
    const d = descricao?.trim();
    if (!d) throw new Error('Informe a descrição');
    if (d.length > 120) throw new Error('Descrição muito longa (máx. 120 caracteres)');
    out.descricao = d;
  }
  if (valorCentavos !== undefined || !parcial) {
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('O valor deve ser maior que zero');
    out.valorCentavos = valorCentavos;
  }
  return out;
}

/** WHERE por mês (YYYY-MM) sobre uma coluna de data YYYY-MM-DD. */
function periodo(coluna, { de, ate } = {}) {
  const where = ['1'];
  const args = [];
  if (de) { where.push(`substr(${coluna}, 1, 7) >= ?`); args.push(de); }
  if (ate) { where.push(`substr(${coluna}, 1, 7) <= ?`); args.push(ate); }
  return { sql: where.join(' AND '), args };
}

export function listarRendas(db, filtros) {
  const { sql, args } = periodo('data', filtros);
  return db.prepare(`SELECT id, data, descricao, valor_centavos FROM rendas WHERE ${sql}
    ORDER BY data DESC, id DESC`).all(...args);
}

export function lancarRenda(db, { data, descricao, valorCentavos }) {
  const v = validar({ data, descricao, valorCentavos });
  const r = db.prepare('INSERT INTO rendas (data, descricao, valor_centavos) VALUES (?, ?, ?)')
    .run(v.data, v.descricao, v.valorCentavos);
  return { id: Number(r.lastInsertRowid) };
}

export function editarRenda(db, id, campos = {}) {
  const v = validar(campos, true);
  const r = db.prepare(`UPDATE rendas SET data = coalesce(?, data), descricao = coalesce(?, descricao),
      valor_centavos = coalesce(?, valor_centavos) WHERE id = ?`)
    .run(v.data ?? null, v.descricao ?? null, v.valorCentavos ?? null, id);
  if (!r.changes) throw new Error('Lançamento de renda não encontrado');
  return { id };
}

export function apagarRenda(db, id) {
  if (!db.prepare('DELETE FROM rendas WHERE id = ?').run(id).changes) throw new Error('Lançamento de renda não encontrado');
  return { ok: true };
}

const mesAnterior = (ref) => {
  const [a, m] = ref.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
const diasNoMes = (ref) => new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), 0)).getUTCDate();

/** Copia a renda do mês anterior para `referencia` (mesmo dia, limitado ao fim do mês). */
export function repetirMesAnterior(db, referencia) {
  if (!REF.test(referencia ?? '')) throw new Error('Mês inválido');
  if (listarRendas(db, { de: referencia, ate: referencia }).length) throw new Error('Este mês já tem renda lançada');
  const origem = mesAnterior(referencia);
  const linhas = listarRendas(db, { de: origem, ate: origem }).reverse();
  if (!linhas.length) throw new Error('O mês anterior não tem renda lançada');
  const ultimo = diasNoMes(referencia);
  db.exec('BEGIN');
  try {
    for (const l of linhas) {
      const dia = Math.min(Number(l.data.slice(8, 10)), ultimo);
      lancarRenda(db, { data: `${referencia}-${String(dia).padStart(2, '0')}`, descricao: l.descricao, valorCentavos: l.valor_centavos });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { qtd: linhas.length };
}

/**
 * Renda × saídas no período: gastos (como no resumo, sem filtro de banco/cartão) e investido
 * (aportes − resgates). `mesesSemRenda`: meses com fatura no período e nenhuma renda lançada.
 */
export function balanco(db, { de, ate } = {}) {
  const r = periodo('data', { de, ate });
  const renda = db.prepare(`SELECT coalesce(sum(valor_centavos), 0) AS v FROM rendas WHERE ${r.sql}`).get(...r.args).v;
  const investido = db.prepare(`SELECT coalesce(sum(valor_centavos), 0) AS v FROM patrimonio_aportes WHERE ${r.sql}`)
    .get(...r.args).v;
  const gastos = totalGasto(db, { de, ate });
  const comRenda = new Set(db.prepare(`SELECT DISTINCT substr(data, 1, 7) AS ref FROM rendas WHERE ${r.sql}`)
    .all(...r.args).map((x) => x.ref));
  const f = [de && 'referencia >= ?', ate && 'referencia <= ?'].filter(Boolean);
  const mesesSemRenda = db.prepare(`SELECT DISTINCT referencia FROM faturas ${f.length ? `WHERE ${f.join(' AND ')}` : ''}
    ORDER BY referencia`).all(...[de, ate].filter(Boolean)).map((x) => x.referencia).filter((ref) => !comRenda.has(ref));
  return { renda, gastos, investido, sobra: renda - gastos - investido, mesesSemRenda };
}
