import { extrairLinhas } from './pdf-text.js';
import { finalizarTransacoes, parseDataBR, parseValorCentavos } from './util.js';

const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const VALOR = /^-?[\d.]+,\d{2}$/;

export function detectar({ nome, texto }) {
  return /Digio (?:virtual|f[ií]sico) Final \d{4}|app do Digio/i.test(texto ?? '') || (texto == null && /digio/i.test(nome));
}

export async function importar({ buffer }) {
  return lerLinhas(await extrairLinhas(buffer));
}

/** Lê as linhas extraídas do PDF (separado de importar() para testar sem PDF). */
export function lerLinhas(linhas) {
  const todo = linhas.map((l) => l.texto).join('\n');

  // O vencimento vem só como "10 MAR"; o ano sai da emissão (fatura emitida em dez vence em jan).
  const emissao = /Fatura emitida em: (\d{2}\/\d{2}\/\d{4})/.exec(todo)?.[1];
  const venc = /^Vencimento: (\d{1,2}) ([A-Z]{3})$/m.exec(todo);
  if (!emissao || !venc || !MESES[venc[2]]) throw new Error('Fatura Digio: emissão ou vencimento não encontrado');
  const [anoEmissao, mesEmissao] = parseDataBR(emissao).split('-').map(Number);
  const mesVenc = MESES[venc[2]];
  const ano = mesVenc < mesEmissao ? anoEmissao + 1 : anoEmissao;
  const referencia = `${ano}-${String(mesVenc).padStart(2, '0')}`;
  const vencimento = `${referencia}-${venc[1].padStart(2, '0')}`;
  const totalTxt = /Valor da fatura: R\$ (-?[\d.]+,\d{2})/.exec(todo)?.[1];

  // Demonstrativo: um bloco por cartão ("Digio virtual Final 1111 - Fulano"), com colunas
  // Data | Descrição | Parcela (opcional) | Valor. Só as linhas começando com data são lançamentos.
  const brutas = [];
  let cartao = null;
  for (const { celulas, texto } of linhas) {
    const mCartao = /^Digio .+ Final (\d{4})\b/i.exec(texto);
    if (mCartao) { cartao = mCartao[1]; continue; }
    if (/^pág\b/.test(texto)) { cartao = null; continue; }
    if (!cartao || !/^\d{2}\/\d{2}\/\d{4}$/.test(celulas[0] ?? '')) continue;

    const valor = celulas.at(-1);
    if (celulas.length < 3 || !VALOR.test(valor)) throw new Error(`Fatura Digio: linha não reconhecida: "${texto}"`);
    const parcela = celulas.length >= 4 && /^\d{1,2}\/\d{1,2}$/.test(celulas.at(-2)) ? celulas.at(-2) : null;
    const descricao = celulas.slice(1, parcela ? -2 : -1).join(' ');
    brutas.push({
      cartaoFinal: cartao,
      data: parseDataBR(celulas[0]),
      descricaoOriginal: parcela ? `${descricao} ${parcela}` : descricao,
      valorCentavos: parseValorCentavos(valor),
    });
  }

  // Conferência com o resumo: gastos = nacionais + internacionais + tarifas; créditos e estornos à parte.
  const resumo = (rotulo) => {
    const m = new RegExp(`(?:^|\\s)${rotulo} R\\$ (-?[\\d.]+,\\d{2})$`, 'm').exec(todo);
    return m ? parseValorCentavos(m[1]) : 0;
  };
  const gastos = resumo('Transações nacionais') + resumo('Transações internacionais') + resumo('Tarifas e encargos');
  const soma = brutas.filter((t) => t.valorCentavos > 0).reduce((s, t) => s + t.valorCentavos, 0);
  if (soma !== gastos) throw new Error(`Fatura Digio: soma dos lançamentos ${soma} ≠ resumo ${gastos} (centavos)`);

  return {
    banco: 'digio',
    formato: 'pdf',
    fatura: { referencia, vencimento, totalCentavos: totalTxt ? parseValorCentavos(totalTxt) : null },
    transacoes: finalizarTransacoes('digio', referencia, brutas),
  };
}
