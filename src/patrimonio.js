// Evolução patrimonial: valores das carteiras por data e os cálculos da planilha do usuário.
//
// Para cada data (comparada com a anotação anterior):
//   total     = soma das carteiras
//   variacao  = total − total anterior            ("saldo" na planilha)
//   aportado  = aporte informado (resgate = negativo)
//   ganho     = variação − aportado               (o que rendeu de fato)
//   dias      = dias desde a anotação anterior
//   ganhoDia  = ganho / dias

import { normalizar } from './importers/util.js';

const COR = /^#[0-9a-f]{6}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function validarData(data) {
  if (!DATA.test(data ?? '') || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) throw new Error('Data inválida (use AAAA-MM-DD)');
  return data;
}

function validarCarteira(db, { nome, cor }, ignorarId = null) {
  const out = {};
  if (nome !== undefined) {
    const n = nome?.trim();
    if (!n) throw new Error('Informe o nome da carteira');
    if (n.length > 40) throw new Error('Nome muito longo (máx. 40 caracteres)');
    const igual = db.prepare('SELECT id, nome FROM carteiras').all()
      .find((c) => c.id !== ignorarId && normalizar(c.nome) === normalizar(n));
    if (igual) throw new Error(`Já existe a carteira "${igual.nome}"`);
    out.nome = n;
  }
  if (cor !== undefined) {
    if (cor && !COR.test(cor)) throw new Error('Cor inválida (use #rrggbb)');
    out.cor = cor ? cor.toLowerCase() : null;
  }
  return out;
}

export function criarCarteira(db, { nome, cor = null }) {
  const v = validarCarteira(db, { nome, cor });
  const ordem = db.prepare('SELECT coalesce(max(ordem), 0) + 1 AS o FROM carteiras').get().o;
  return Number(db.prepare('INSERT INTO carteiras (nome, cor, ordem) VALUES (?, ?, ?)').run(v.nome, v.cor, ordem).lastInsertRowid);
}

export function editarCarteira(db, id, { nome, cor, ativa }) {
  if (!db.prepare('SELECT 1 FROM carteiras WHERE id = ?').get(id)) throw new Error('Carteira não encontrada');
  const v = validarCarteira(db, { nome, cor }, id);
  if (ativa !== undefined) v.ativa = ativa ? 1 : 0;
  const campos = Object.keys(v);
  if (campos.length) db.prepare(`UPDATE carteiras SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...campos.map((c) => v[c]), id);
}

export function apagarCarteira(db, id) {
  if (!db.prepare('DELETE FROM carteiras WHERE id = ?').run(id).changes) throw new Error('Carteira não encontrada');
}

/**
 * Grava (ou substitui) a anotação de uma data: valor de cada carteira e o aporte do período.
 * `valores` é { carteiraId: centavos }; carteira ausente ou null fica sem valor nessa data.
 */
export function salvarRegistro(db, data, { valores, aporte = 0, estimado = false }) {
  validarData(data);
  const ids = new Set(db.prepare('SELECT id FROM carteiras').all().map((c) => c.id));
  const entradas = Object.entries(valores ?? {}).filter(([, v]) => v != null);
  if (!entradas.length) throw new Error('Informe o valor de pelo menos uma carteira');
  for (const [id, v] of entradas) {
    if (!ids.has(Number(id))) throw new Error(`Carteira ${id} não existe`);
    if (!Number.isInteger(v) || v < 0) throw new Error('Valores devem ser positivos');
  }
  if (!Number.isInteger(aporte)) throw new Error('Aporte inválido');

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM patrimonio_valores WHERE data = ?').run(data);
    const ins = db.prepare('INSERT INTO patrimonio_valores (data, carteira_id, valor_centavos) VALUES (?, ?, ?)');
    for (const [id, v] of entradas) ins.run(data, Number(id), v);
    // Salvar pela tela sempre grava como real: o valor real substitui a estimativa.
    db.prepare(`INSERT INTO patrimonio_aportes (data, valor_centavos, estimado) VALUES (?, ?, ?)
                ON CONFLICT (data) DO UPDATE SET valor_centavos = excluded.valor_centavos, estimado = excluded.estimado`)
      .run(data, aporte, estimado ? 1 : 0);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Apaga todas as anotações estimadas (as reais ficam). */
export function apagarEstimados(db) {
  const datas = db.prepare('SELECT data FROM patrimonio_aportes WHERE estimado = 1').all().map((d) => d.data);
  const del = db.prepare('DELETE FROM patrimonio_valores WHERE data = ?');
  db.exec('BEGIN');
  for (const d of datas) del.run(d);
  db.prepare('DELETE FROM patrimonio_aportes WHERE estimado = 1').run();
  db.exec('COMMIT');
  return { apagadas: datas.length };
}

export function apagarRegistro(db, data) {
  validarData(data);
  const n = db.prepare('DELETE FROM patrimonio_valores WHERE data = ?').run(data).changes;
  db.prepare('DELETE FROM patrimonio_aportes WHERE data = ?').run(data);
  if (!n) throw new Error('Não há anotação nessa data');
}

export function definirObjetivo(db, { nome = null, valorCentavos, dataAlvo = null, aporteDesejadoCentavos = null }) {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('O valor do objetivo deve ser maior que zero');
  if (aporteDesejadoCentavos != null && (!Number.isInteger(aporteDesejadoCentavos) || aporteDesejadoCentavos < 0)) {
    throw new Error('Aporte desejado inválido');
  }
  if (dataAlvo) validarData(dataAlvo);
  const n = nome?.trim() || null;
  if (n && n.length > 60) throw new Error('Nome muito longo (máx. 60 caracteres)');
  db.prepare(`INSERT INTO patrimonio_objetivo (id, nome, valor_centavos, data_alvo, aporte_desejado_centavos)
              VALUES (1, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, valor_centavos = excluded.valor_centavos,
                data_alvo = excluded.data_alvo, aporte_desejado_centavos = excluded.aporte_desejado_centavos`)
    .run(n, valorCentavos, dataAlvo || null, aporteDesejadoCentavos ?? null);
}

export function removerObjetivo(db) {
  db.prepare('DELETE FROM patrimonio_objetivo').run();
}

const somarDias = (data, n) => new Date(Date.parse(`${data}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Taxa média de rendimento por mês (sem aportes) = Σ ganho ÷ Σ (patrimônio anterior × dias) × 30,4375.
 * Usada com juros compostos: o patrimônio maior de hoje rende mais do que o de 2024.
 */
function taxaMensal(linhas) {
  let ganhoSoma = 0, capitalDias = 0;
  for (let i = 1; i < linhas.length; i++) {
    ganhoSoma += linhas[i].ganho ?? 0;
    capitalDias += linhas[i - 1].total * (linhas[i].dias ?? 0);
  }
  return capitalDias > 0 ? (ganhoSoma / capitalDias) * 30.4375 : null;
}

/**
 * Progresso até o objetivo e projeções a partir da última anotação:
 * - ritmo atual: crescimento médio por dia do patrimônio desde a primeira anotação
 *   (inclui aportes, supondo que você continue aportando no mesmo ritmo);
 * - últimos 3 meses: o mesmo, mas a partir da anotação mais recente com 3 meses ou mais;
 * - com aporte desejado: rendimento médio (ganho sem aportes) + o aporte mensal planejado;
 * - necessário: quanto precisa crescer por mês para chegar na data alvo.
 */
function calcularObjetivo(obj, linhas) {
  if (!obj) return null;
  const meta = obj.valor_centavos;
  const primeira = linhas[0];
  const ultima = linhas.at(-1);
  const base = { nome: obj.nome, valor: meta, dataAlvo: obj.data_alvo, aporteDesejado: obj.aporte_desejado_centavos ?? null };
  if (!ultima) return { ...base, atual: 0, progresso: 0, falta: meta };

  const falta = Math.max(0, meta - ultima.total);
  const dias = diasEntre(primeira.data, ultima.data);
  const ritmoDia = dias > 0 ? (ultima.total - primeira.total) / dias : null;
  let dataPrevista = null;
  if (falta === 0) dataPrevista = ultima.data;
  else if (ritmoDia > 0) dataPrevista = somarDias(ultima.data, Math.ceil(falta / ritmoDia));

  // Últimos 3 meses: parte da anotação mais recente feita até 3 meses antes da última.
  const corte = new Date(Date.parse(`${ultima.data}T00:00:00Z`));
  corte.setUTCMonth(corte.getUTCMonth() - 3);
  const base3m = linhas.findLast((l) => l.data <= corte.toISOString().slice(0, 10));
  let ritmo3mDia = null;
  let dataPrevista3m = null;
  if (base3m) {
    ritmo3mDia = (ultima.total - base3m.total) / diasEntre(base3m.data, ultima.data);
    if (falta === 0) dataPrevista3m = ultima.data;
    else if (ritmo3mDia > 0) dataPrevista3m = somarDias(ultima.data, Math.ceil(falta / ritmo3mDia));
  }

  const taxaMes = taxaMensal(linhas);
  const rendimentoMes = taxaMes != null ? Math.round(taxaMes * ultima.total) : null;
  // Aportado no mês da última anotação (para comparar com o desejado).
  const mesAtual = ultima.data.slice(0, 7);
  const aportadoMes = linhas.filter((l) => l.data.slice(0, 7) === mesAtual).reduce((s, l) => s + (l.aportado ?? 0), 0);
  let ritmoPlanejadoMes = null;
  let dataPrevistaPlanejada = null;
  if (obj.aporte_desejado_centavos != null && taxaMes != null) {
    ritmoPlanejadoMes = rendimentoMes + obj.aporte_desejado_centavos;
    if (falta === 0) dataPrevistaPlanejada = ultima.data;
    else {
      // mês a mês: rende a taxa média e recebe o aporte desejado (até 50 anos)
      let v = ultima.total;
      for (let m = 1; m <= 600; m++) {
        const antes = v;
        v = v * (1 + taxaMes) + obj.aporte_desejado_centavos;
        if (v >= meta) {
          const fracao = (meta - antes) / (v - antes);
          dataPrevistaPlanejada = somarDias(ultima.data, Math.ceil((m - 1 + fracao) * 30.4375));
          break;
        }
        if (v <= antes) break; // não cresce
      }
    }
  }

  let necessarioMes = null;
  let diasAteAlvo = null;
  if (obj.data_alvo) {
    diasAteAlvo = diasEntre(ultima.data, obj.data_alvo);
    if (falta > 0 && diasAteAlvo > 0) necessarioMes = Math.round((falta / diasAteAlvo) * 30.4375);
  }
  return {
    ...base,
    atual: ultima.total,
    progresso: ultima.total / meta,
    falta,
    alcancado: falta === 0,
    ritmoMes: ritmoDia != null ? Math.round(ritmoDia * 30.4375) : null,
    dataPrevista,
    diasAteAlvo,
    necessarioMes,
    // no prazo? só faz sentido com data alvo e ritmo conhecido
    noPrazo: obj.data_alvo && dataPrevista ? dataPrevista <= obj.data_alvo : null,
    desde3m: base3m?.data ?? null,
    ritmo3mMes: ritmo3mDia != null ? Math.round(ritmo3mDia * 30.4375) : null,
    dataPrevista3m,
    taxaMes,
    rendimentoMes,
    mesAtual,
    aportadoMes,
    ritmoPlanejadoMes,
    dataPrevistaPlanejada,
    noPrazoPlanejado: obj.data_alvo && dataPrevistaPlanejada ? dataPrevistaPlanejada <= obj.data_alvo : null,
  };
}

/** Carteiras, linhas calculadas (mais antiga primeiro) e o resumo do período. */
export function evolucao(db) {
  const carteiras = db.prepare('SELECT id, nome, cor, ordem, ativa FROM carteiras ORDER BY ordem, id').all();
  const valores = db.prepare('SELECT data, carteira_id, valor_centavos FROM patrimonio_valores ORDER BY data').all();
  const aportesLinhas = db.prepare('SELECT data, valor_centavos, estimado FROM patrimonio_aportes').all();
  const aportes = new Map(aportesLinhas.map((a) => [a.data, a.valor_centavos]));
  const estimados = new Set(aportesLinhas.filter((a) => a.estimado).map((a) => a.data));

  const porData = new Map();
  for (const v of valores) {
    if (!porData.has(v.data)) porData.set(v.data, {});
    porData.get(v.data)[v.carteira_id] = v.valor_centavos;
  }

  const linhas = [];
  let anterior = null;
  for (const [data, vals] of porData) {
    const total = Object.values(vals).reduce((s, v) => s + v, 0);
    const aportado = aportes.get(data) ?? 0;
    const linha = {
      data, valores: vals, total, aportado, estimado: estimados.has(data),
      participacao: Object.fromEntries(Object.entries(vals).map(([id, v]) => [id, total ? v / total : 0])),
      variacao: null, ganho: null, dias: null, ganhoDia: null,
    };
    if (anterior) {
      linha.variacao = total - anterior.total;
      linha.ganho = linha.variacao - aportado;
      linha.dias = diasEntre(anterior.data, data);
      linha.ganhoDia = linha.dias > 0 ? Math.round(linha.ganho / linha.dias) : null;
    }
    linhas.push(linha);
    anterior = linha;
  }

  // Resumo (cartões) só com anotações reais; a projeção do objetivo usa o histórico todo.
  const reais = linhas.filter((l) => !l.estimado);
  const primeira = reais[0];
  const ultima = reais.at(-1);
  const seguintes = reais.slice(1);
  const ganhoTotal = seguintes.reduce((s, l) => s + l.ganho, 0);
  const aportadoTotal = seguintes.reduce((s, l) => s + l.aportado, 0);
  const diasTotal = primeira && ultima ? diasEntre(primeira.data, ultima.data) : 0;
  const objetivo = calcularObjetivo(db.prepare('SELECT * FROM patrimonio_objetivo WHERE id = 1').get(), linhas);
  const taxaMes = taxaMensal(reais);
  return {
    carteiras,
    linhas,
    objetivo,
    resumo: ultima ? {
      atual: ultima.total, data: ultima.data, inicial: primeira.total, desde: primeira.data,
      aportadoTotal, ganhoTotal, diasTotal,
      ganhoDiaMedio: diasTotal ? Math.round(ganhoTotal / diasTotal) : null,
      // rendimento sobre o que estava investido (patrimônio inicial + aportes)
      rendimento: primeira.total + aportadoTotal > 0 ? ganhoTotal / (primeira.total + aportadoTotal) : null,
      taxaMes,
      rendimentoAno: taxaMes != null ? (1 + taxaMes) ** 12 - 1 : null,
      // desde a anotação real anterior
      ultimo: reais.length > 1 ? { variacao: ultima.variacao, ganho: ultima.ganho, aportado: ultima.aportado, dias: ultima.dias } : null,
    } : null,
  };
}
