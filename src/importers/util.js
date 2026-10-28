import { createHash } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Maiúsculas e sem acento, para comparar "Panificadora" com "PANIFICADORA". */
export const normalizar = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();

// Prefixos de intermediadores de pagamento que mudam entre faturas para o mesmo estabelecimento
// ("EC *HBOMAXASSIN" e "MP *HBOMAXASSIN" são o mesmo HBO Max).
const PREFIXOS_INTERMEDIARIO = /^(?:EC|MP|MLP|PAG|PG|EBN|DM|IZ|SUMUP|PAYPAL|PICPAY|HTM|APM|STR)\s*\*\s*/;

/**
 * Identifica o estabelecimento entre faturas: sem acento, sem prefixo de intermediador e só com
 * letras e números ("Apple.Com/Bill." e "Applecombill" -> "APPLECOMBILL").
 */
export const chaveDe = (descricao) => normalizar(descricao).trim()
  .replace(PREFIXOS_INTERMEDIARIO, '')
  .replace(/[^A-Z0-9]+/g, '');

/**
 * Texto de valor -> centavos (inteiro).
 * decimal ',' = pt-BR ("1.234,56"), '.' = en ("1234.56"), 'auto' = descobre pelo texto:
 * com os dois separadores, o último é o decimal; com um só, ele é decimal se tiver 1–2 dígitos depois.
 */
export function parseValorCentavos(texto, { decimal = ',' } = {}) {
  let s = String(texto).replace(/R\$|\s/g, '');
  if (decimal === 'auto') decimal = detectarDecimal(s);
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!s || !Number.isFinite(n)) throw new Error(`Valor inválido: "${texto}"`);
  return Math.round(n * 100);
}

function detectarDecimal(s) {
  const virgula = s.lastIndexOf(','), ponto = s.lastIndexOf('.');
  if (virgula >= 0 && ponto >= 0) return virgula > ponto ? ',' : '.';
  if (virgula >= 0) return /,\d{1,2}$/.test(s) ? ',' : '.';
  if (ponto >= 0) return /\.\d{1,2}$/.test(s) ? '.' : ',';
  return '.';
}

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

/** "06 de dez. 2025" -> "2025-12-06" */
export function parseDataExtenso(texto) {
  const m = /^(\d{1,2}) de (\w{3})\.? (\d{4})$/i.exec(texto.trim());
  const mes = m && MESES[m[2].toLowerCase()];
  if (!mes) throw new Error(`Data inválida: "${texto}"`);
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "12/01/2026" -> "2026-01-12" */
export function parseDataBR(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) throw new Error(`Data inválida: "${texto}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Separa a informação de parcela da descrição.
 * Nubank: "Loja - Parcela 3/10"   Inter: "LOJA (Parcela 03 de 10)"
 */
export function extrairParcela(descricao) {
  const m = /\s*(?:-\s*Parcela\s+(\d+)\s*\/\s*(\d+)|\(Parcela\s+(\d+)\s+de\s+(\d+)\))\s*$/i.exec(descricao);
  if (!m) return { descricao: descricao.trim(), parcelaAtual: null, parcelaTotal: null };
  return {
    descricao: descricao.slice(0, m.index).trim(),
    parcelaAtual: Number(m[1] ?? m[3]),
    parcelaTotal: Number(m[2] ?? m[4]),
  };
}

export function classificarTipo(descricao, valorCentavos) {
  // "PAGAMENTO ON LINE", "Pagamento recebido", "PGTO PIX", "PAGTO DEBITO AUTOMATICO"...
  if (/pagamento|\bpa?gto\b/i.test(descricao) && valorCentavos < 0) return 'pagamento';
  if (valorCentavos < 0) return 'estorno';
  if (/^(iof|anuidade|tarifa|juros|encargo)/i.test(descricao)) return 'tarifa';
  return 'compra';
}

/**
 * Hash estável da linha. `ocorrencia` diferencia linhas idênticas no mesmo arquivo
 * (ex.: duas compras iguais na mesma padaria no mesmo dia).
 */
export function hashTransacao({ banco, referencia, cartaoFinal, data, descricaoOriginal, valorCentavos, ocorrencia }) {
  return sha256([banco, referencia, cartaoFinal ?? '', data, descricaoOriginal, valorCentavos, ocorrencia].join('|'));
}

/** Completa cada transação com parcela, tipo e hash. */
export function finalizarTransacoes(banco, referencia, brutas) {
  const vistos = new Map();
  return brutas.map((t) => {
    const chave = [t.cartaoFinal, t.data, t.descricaoOriginal, t.valorCentavos].join('|');
    const ocorrencia = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, ocorrencia);
    const { descricao, parcelaAtual, parcelaTotal } = extrairParcela(t.descricaoOriginal);
    return {
      ...t,
      descricao,
      chave: chaveDe(descricao),
      parcelaAtual,
      parcelaTotal,
      tipo: classificarTipo(descricao, t.valorCentavos),
      hash: hashTransacao({ banco, referencia, ...t, ocorrencia }),
    };
  });
}
