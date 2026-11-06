import { finalizarTransacoes, normalizar, parseValorCentavos, sha256 } from './util.js';

// OFX (Open Financial Exchange): formato que a maioria dos bancos exporta (Itaú, Bradesco, BB,
// Santander, Caixa, C6...). Lê só a fatura do cartão (<CCSTMTRS>), tanto o OFX 1.x (SGML, tags sem
// fechamento) quanto o 2.x (XML). No OFX a compra vem negativa e o pagamento positivo: o sinal é
// invertido para o padrão do painel (gasto positivo).
//
// O OFX não informa o vencimento. A fatura conta no mês do vencimento, estimado como o fechamento
// (<DTEND>) + 10 dias. Uma data no nome do arquivo (fatura_2026-11-10.ofx ou fatura_2026-11.ofx) tem
// prioridade sobre a estimativa.
//
// O OFX da conta corrente (<STMTRS>) é lido à parte por importarExtrato(): as saídas viram gastos do
// banco 'pix', um "mês" por data de lançamento.

/** Código de compensação (FID/BANKID) -> código do banco no painel. */
const POR_NUMERO = {
  '001': 'bb', '033': 'santander', '077': 'inter', '104': 'caixa', '208': 'btg', '212': 'original',
  '237': 'bradesco', '260': 'nubank', '290': 'pagbank', '323': 'mercadopago', '336': 'c6', '341': 'itau',
  '380': 'picpay', '422': 'safra', '655': 'neon', '748': 'sicredi', '756': 'sicoob',
};

/** Trecho do <ORG> -> código do banco, para arquivos sem FID. */
const POR_NOME = [
  [/ITAU/, 'itau'], [/BRADESCO/, 'bradesco'], [/BANCO DO BRASIL|^BB\b/, 'bb'], [/SANTANDER/, 'santander'],
  [/CAIXA/, 'caixa'], [/NU ?PAGAMENTOS|NUBANK/, 'nubank'], [/INTER/, 'inter'], [/C6/, 'c6'], [/BTG/, 'btg'],
  [/SICOOB/, 'sicoob'], [/SICREDI/, 'sicredi'], [/MERCADO ?PAGO/, 'mercadopago'], [/PICPAY/, 'picpay'],
];

export function detectar({ texto }) {
  return /<OFX>/i.test(texto ?? '');
}

/** O OFX 1.x declara a codificação no cabeçalho (CHARSET:1252); o 2.x, no <?xml encoding?>. */
export function decodificar(buffer) {
  const inicio = buffer.subarray(0, 500).toString('latin1');
  const latin = /CHARSET:\s*(1252|ISO-?8859-?1)|encoding="(windows-1252|iso-8859-1)"/i.test(inicio)
    && !/CHARSET:\s*UTF-?8|encoding="utf-8"/i.test(inicio);
  return new TextDecoder(latin ? 'windows-1252' : 'utf-8').decode(buffer);
}

/** Valor da primeira <TAG> do trecho, com ou sem tag de fechamento. */
const campo = (trecho, tag) => new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(trecho)?.[1].trim() || null;

/** 20261005120000[-3:BRT] -> 2026-10-05 */
function data(texto) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(texto ?? '');
  if (!m) throw new Error(`Data inválida no OFX: "${texto}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function identificarBanco(texto) {
  const numero = (campo(texto, 'FID') ?? campo(texto, 'BANKID'))?.replace(/\D/g, '').padStart(3, '0').slice(-3);
  if (numero && POR_NUMERO[numero]) return POR_NUMERO[numero];
  const org = normalizar(campo(texto, 'ORG') ?? '');
  const porNome = POR_NOME.find(([re]) => re.test(org))?.[1];
  if (porNome) return porNome;
  return org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ofx';
}

function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lançamentos (<STMTTRN>) do trecho, com o valor como veio no OFX (saída negativa). */
function lancamentos(trecho) {
  const blocos = [...trecho.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)].map((m) => m[1]);
  const lista = blocos.map((b) => {
    const descricao = (campo(b, 'MEMO') ?? campo(b, 'NAME') ?? '').replace(/\s+/g, ' ');
    if (!descricao) throw new Error('Lançamento sem descrição no OFX');
    return {
      data: data(campo(b, 'DTPOSTED')),
      descricaoOriginal: descricao,
      valorCentavos: parseValorCentavos(campo(b, 'TRNAMT'), { decimal: 'auto' }),
      fitid: campo(b, 'FITID'),
    };
  });
  if (!lista.length) throw new Error('OFX sem lançamentos');
  return lista;
}

export function importar({ nome, texto }) {
  const cartao = /<CCSTMTRS>([\s\S]*?)(?:<\/CCSTMTRS>|$)/i.exec(texto)?.[1];
  if (!cartao) {
    if (/<STMTRS>/i.test(texto)) {
      throw new Error('Este OFX é de conta corrente. Para contar as saídas como gastos, envie-o em “Pix e saídas da conta”.');
    }
    throw new Error('OFX sem fatura de cartão (<CCSTMTRS>)');
  }

  const brutas = lancamentos(cartao).map((l) => ({
    cartaoFinal: null,
    data: l.data,
    descricaoOriginal: l.descricaoOriginal,
    valorCentavos: -l.valorCentavos,
  }));

  // Número do cartão costuma vir mascarado ("5162********1234"): guarda os 4 últimos dígitos.
  const final = /(\d{4})\D*$/.exec(campo(cartao, 'ACCTID') ?? '')?.[1] ?? null;
  for (const t of brutas) t.cartaoFinal = final;

  const doNome = /(\d{4}-\d{2})(?:-(\d{2}))?/.exec(nome);
  const fechamento = campo(cartao, 'DTEND') ? data(campo(cartao, 'DTEND')) : brutas.map((t) => t.data).sort().at(-1);
  const vencimento = doNome?.[2] ? `${doNome[1]}-${doNome[2]}` : null;
  const referencia = doNome ? doNome[1] : somarDias(fechamento, 10).slice(0, 7);

  const banco = identificarBanco(texto);
  return {
    banco,
    formato: 'ofx',
    fatura: { referencia, vencimento, totalCentavos: null },
    transacoes: finalizarTransacoes(banco, referencia, brutas),
  };
}

export const BANCO_EXTRATO = 'pix';

/**
 * Extrato da conta corrente: só as saídas (Pix, boleto, débito...), como gasto positivo do banco
 * 'pix', agrupadas por mês da data. Com FITID, a identidade da linha não depende do arquivo, então
 * extratos de períodos sobrepostos não duplicam.
 */
export function importarExtrato({ texto }) {
  const conta = /<STMTRS>([\s\S]*?)(?:<\/STMTRS>|$)/i.exec(texto)?.[1];
  if (!conta) {
    if (/<CCSTMTRS>/i.test(texto)) throw new Error('Este OFX é de fatura de cartão. Envie-o na importação de faturas.');
    throw new Error('OFX sem extrato de conta corrente (<STMTRS>)');
  }
  const origem = identificarBanco(texto);
  const acct = campo(conta, 'ACCTID') ?? '';
  const saidas = lancamentos(conta).filter((l) => l.valorCentavos < 0);
  if (!saidas.length) throw new Error('O extrato não tem saídas');

  const porMes = new Map();
  for (const l of saidas) {
    const ref = l.data.slice(0, 7);
    if (!porMes.has(ref)) porMes.set(ref, []);
    porMes.get(ref).push(l);
  }
  const faturas = [...porMes].sort(([a], [b]) => a.localeCompare(b)).map(([referencia, lista]) => {
    const brutas = lista.map((l) => ({ cartaoFinal: null, data: l.data, descricaoOriginal: l.descricaoOriginal, valorCentavos: -l.valorCentavos }));
    const transacoes = finalizarTransacoes(BANCO_EXTRATO, referencia, brutas).map((t, i) => (lista[i].fitid
      ? { ...t, hash: sha256([BANCO_EXTRATO, origem, acct, lista[i].fitid].join('|')) } : t));
    return { fatura: { referencia, vencimento: null, totalCentavos: null }, transacoes };
  });
  return { banco: BANCO_EXTRATO, origem, formato: 'ofx', faturas };
}
