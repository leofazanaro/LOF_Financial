import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Extrai as linhas de texto do PDF, reconstruídas pela posição vertical dos fragmentos.
 * Cada linha vem como lista de células (fragmentos ordenados da esquerda para a direita),
 * o que preserva as colunas de tabelas de fatura.
 */
export async function extrairLinhas(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const porY = new Map();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      // agrupa fragmentos com diferença de até 2pt na mesma linha
      const chave = [...porY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!porY.has(chave)) porY.set(chave, []);
      porY.get(chave).push({ x: it.transform[4], w: it.width, str: it.str });
    }
    const ys = [...porY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      // Fragmentos colados (ex.: "P" + "AGAMENTO", quebrados por kerning) viram uma célula só.
      const celulas = [];
      let fim = -Infinity;
      for (const f of porY.get(y).sort((a, b) => a.x - b.x)) {
        if (celulas.length && f.x - fim < 1) celulas[celulas.length - 1] += f.str;
        else celulas.push(f.str);
        fim = f.x + f.w;
      }
      const limpas = celulas.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
      linhas.push({ pagina: p, celulas: limpas, texto: limpas.join(' ') });
    }
  }
  await doc.destroy();
  return linhas;
}
