import Papa from 'papaparse';
import { finalizarTransacoes, parseDataBR, parseValorCentavos } from './util.js';

// Exportação de fatura do app Nubank: colunas date, title, amount; gastos positivos e
// pagamentos/créditos negativos. Nome do arquivo: Nubank_YYYY-MM-DD.csv
// O formato do valor mudou ao longo de 2026 ("19.90" -> "19,90"), por isso o decimal é detectado.
export function detectar({ nome, texto }) {
  return /nubank_/i.test(nome) || /^\uFEFF?"?date"?[,;]"?title"?[,;]"?amount"?\s*$/i.test(texto?.split('\n')[0] ?? '');
}

export function importar({ nome, texto }) {
  const { data, errors } = Papa.parse(texto.replace(/^\uFEFF/, '').trim(), {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (errors.length) throw new Error(`CSV Nubank inválido: ${errors[0].message} (linha ${errors[0].row})`);

  // A data no nome do arquivo é o vencimento da fatura.
  const venc = /(\d{4}-\d{2}-\d{2})/.exec(nome)?.[1] ?? null;
  const referencia = venc ? venc.slice(0, 7) : maxData(data).slice(0, 7);

  const brutas = data.map((l) => ({
    cartaoFinal: null, // o CSV do Nubank não informa o cartão
    data: /^\d{2}\/\d{2}\/\d{4}$/.test(l.date.trim()) ? parseDataBR(l.date) : l.date.trim(),
    descricaoOriginal: l.title.trim(),
    valorCentavos: parseValorCentavos(l.amount, { decimal: 'auto' }),
  }));

  return {
    banco: 'nubank',
    formato: 'csv',
    fatura: { referencia, vencimento: venc, totalCentavos: null },
    transacoes: finalizarTransacoes('nubank', referencia, brutas),
  };
}

const maxData = (linhas) => linhas.map((l) => l.date).sort().at(-1);
