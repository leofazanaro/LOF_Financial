import { extrairLinhas } from './pdf-text.js';
import { finalizarTransacoes, parseDataBR, parseDataExtenso, parseValorCentavos } from './util.js';

const RE_DATA = /^\d{1,2} de [a-zç]{3}\.? \d{4}/i;
const RE_LINHA = /^(\d{1,2} de [a-zç]{3}\.? \d{4})\s+(.+?)\s+(?:-|\S.*?)\s+(\+\s*)?R\$\s*([\d.]+,\d{2})$/i;

export function detectar({ nome, texto }) {
  return /BANCO INTER|bancointer\.com\.br/i.test(texto ?? '') || (texto == null && /inter/i.test(nome));
}

export async function importar({ buffer }) {
  const linhas = await extrairLinhas(buffer);
  const todo = linhas.map((l) => l.texto).join('\n');

  const vencTxt = /Data de Vencimento\s*\n?.*?(\d{2}\/\d{2}\/\d{4})/s.exec(todo)?.[1];
  if (!vencTxt) throw new Error('Fatura Inter: data de vencimento não encontrada');
  const vencimento = parseDataBR(vencTxt);
  const referencia = vencimento.slice(0, 7);
  // "Total da sua fatura" fica em coluna ao lado do limite; a linha "Fatura atual" é inequívoca.
  const totalTxt = /^Fatura atual\s+R\$\s*([\d.]+,\d{2})$/m.exec(todo)?.[1];

  // Só a seção "Despesas da fatura" tem lançamentos; a seção "Próxima fatura" (parcelas
  // futuras) também tem descrições de parcelas, mas sem data, e é ignorada.
  const brutas = [];
  const totaisCartao = new Map();
  let cartao = null;
  for (const { celulas, texto } of linhas) {
    const mCartao = /^CART[ÃA]O \d{4}\*{4}(\d{4})$/i.exec(texto);
    if (mCartao) { cartao = mCartao[1]; continue; }
    const mTotal = /^Total CART[ÃA]O \d{4}\*{4}(\d{4})\s+R\$\s*([\d.]+,\d{2})$/i.exec(texto);
    if (mTotal) { totaisCartao.set(mTotal[1], parseValorCentavos(mTotal[2])); continue; }
    if (!cartao || !RE_DATA.test(texto)) continue;

    // Colunas: Data | Movimentação (pode vir em várias células) | Beneficiário | Valor
    const m = RE_LINHA.exec(texto);
    if (!m) throw new Error(`Fatura Inter: linha não reconhecida: "${texto}"`);
    const dataTxt = m[1];
    const valorTxt = `${m[3] ?? ''}${m[4]}`;
    const descricao = celulas.length >= 4 ? celulas.slice(1, -2).join(' ') : m[2];

    const credito = valorTxt.trim().startsWith('+');
    const centavos = parseValorCentavos(valorTxt.replace('+', ''));
    brutas.push({
      cartaoFinal: cartao,
      data: parseDataExtenso(dataTxt),
      descricaoOriginal: descricao.trim(),
      valorCentavos: credito ? -centavos : centavos,
    });
  }

  // Conferência: soma dos gastos de cada cartão deve bater com o "Total CARTÃO" impresso.
  for (const [final, total] of totaisCartao) {
    const soma = brutas.filter((t) => t.cartaoFinal === final && t.valorCentavos > 0)
      .reduce((s, t) => s + t.valorCentavos, 0);
    if (soma !== total) throw new Error(`Fatura Inter: cartão ${final} soma ${soma} ≠ total ${total} (centavos)`);
  }
  // Resumo do Inter: Fatura atual = Despesas do mês + juros/encargos − valor antecipado
  // (créditos como um estorno no mesmo mês entram em "valor antecipado").
  // Os "Total CARTÃO" somam as despesas do mês, não o valor a pagar.
  const resumo = (rotulo) => {
    const m = new RegExp(`^${rotulo}\\s+R\\$\\s*([\\d.]+,\\d{2})$`, 'm').exec(todo);
    return m ? parseValorCentavos(m[1]) : null;
  };
  const totalCentavos = totalTxt ? parseValorCentavos(totalTxt) : null;
  const despesas = resumo('Despesas do mês');
  const juros = resumo('Valor total de juros e encargos') ?? 0;
  const antecipado = resumo('Valor antecipado') ?? 0;
  const somaCartoes = [...totaisCartao.values()].reduce((s, v) => s + v, 0);
  const referenciaSoma = despesas ?? totalCentavos;
  if (referenciaSoma != null && totaisCartao.size && somaCartoes !== referenciaSoma) {
    throw new Error(`Fatura Inter: soma dos cartões ${somaCartoes} ≠ despesas do mês ${referenciaSoma} (centavos)`);
  }
  if (despesas != null && totalCentavos != null && despesas + juros - antecipado !== totalCentavos) {
    throw new Error(`Fatura Inter: despesas ${despesas} + juros ${juros} − antecipado ${antecipado} ≠ fatura atual ${totalCentavos} (centavos)`);
  }

  return {
    banco: 'inter',
    formato: 'pdf',
    fatura: { referencia, vencimento, totalCentavos },
    transacoes: finalizarTransacoes('inter', referencia, brutas),
  };
}
