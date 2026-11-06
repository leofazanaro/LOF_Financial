// Importação da planilha de contas normais (.xlsx do Google Sheets ou CSV) com colunas
// "Ano, Mes, Dia, item, VALOR, Categoria" — o cabeçalho pode estar em qualquer linha (acima dele
// costuma haver totais como "Falta pagar"). A planilha do ano inteiro pode ser enviada de novo
// quantas vezes quiser: comparamos com as contas já lançadas e só o que mudou é gravado.
import { extname } from 'node:path';
import Papa from 'papaparse';
import { lerXlsx } from './importers/xlsx.js';
import { normalizar, parseValorCentavos } from './importers/util.js';
import { apagarConta, editarConta, emTransacao, lancarConta } from './contas.js';
import { buscarCategoria, criarCategoria } from './categorias.js';

const COLUNAS = ['ano', 'mes', 'dia', 'item', 'valor', 'categoria'];
/** Categorias da planilha que não são contas (os cartões já entram pelas faturas). */
const PULAR = ['cartao'];

const simples = (s) => normalizar(String(s).trim()).toLowerCase();

/** Acha a aba e a linha do cabeçalho; devolve as linhas de dados com o índice de cada coluna. */
function tabela(abas) {
  for (const { linhas } of abas) {
    const i = linhas.findIndex((l) => ['ano', 'mes', 'dia', 'item', 'valor'].every((c) => l.some((x) => simples(x) === c)));
    if (i < 0) continue;
    const cab = linhas[i].map(simples);
    const idx = Object.fromEntries(COLUNAS.map((c) => [c, cab.indexOf(c)]));
    return { idx, primeira: i + 2, linhas: linhas.slice(i + 1) };
  }
  throw new Error('Não achei o cabeçalho "Ano, Mes, Dia, item, VALOR" na planilha');
}

const numero = (s) => Number(String(s).replace(',', '.'));
const pad = (n) => String(Math.trunc(n)).padStart(2, '0');
const descricaoDe = (item) => item.charAt(0).toUpperCase() + item.slice(1);

/**
 * Lê a planilha. Retorna `{ contas: [{ linha, data, descricao, valorCentavos, categoria }],
 * ignoradas: { semValor, cartao }, erros: [{ linha, erro }] }`.
 */
export function lerPlanilhaContas({ nome, buffer }) {
  const xlsx = extname(nome).toLowerCase() === '.xlsx';
  const abas = xlsx ? lerXlsx(buffer)
    : [{ linhas: Papa.parse(buffer.toString('utf8').replace(/^\uFEFF/, '').trimEnd()).data }];
  const { idx, primeira, linhas } = tabela(abas); // linhas vazias mantidas: o número bate com a planilha
  const r = { contas: [], ignoradas: { semValor: 0, cartao: 0 }, erros: [] };

  linhas.forEach((l, i) => {
    const campo = (k) => (idx[k] >= 0 ? String(l[idx[k]] ?? '').trim() : '');
    const linha = primeira + i;
    if (!campo('ano') && !campo('item')) return; // linha vazia
    const categoria = campo('categoria');
    if (PULAR.includes(simples(categoria))) { r.ignoradas.cartao++; return; }
    // .xlsx traz o número cru ("248.1"); o CSV, o texto formatado ("R$ 1.234,56", "R$ -" para zero).
    const valorTxt = campo('valor').replace(/R\$|\s/g, '');
    let valorCentavos = 0;
    if (valorTxt && !/^-+$/.test(valorTxt)) {
      try { valorCentavos = parseValorCentavos(valorTxt, { decimal: xlsx ? '.' : ',' }); } catch (err) {
        r.erros.push({ linha, erro: err.message }); return;
      }
    }
    if (valorCentavos <= 0) { r.ignoradas.semValor++; return; }
    const [ano, mes, dia] = ['ano', 'mes', 'dia'].map((k) => numero(campo(k)));
    const data = `${Math.trunc(ano)}-${pad(mes)}-${pad(dia)}`;
    if (!(ano > 1900) || !(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= 31) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
      r.erros.push({ linha, erro: `Data inválida (${campo('ano')}/${campo('mes')}/${campo('dia')})` }); return;
    }
    if (!campo('item')) { r.erros.push({ linha, erro: 'Item sem nome' }); return; }
    r.contas.push({ linha, data, descricao: descricaoDe(campo('item')), valorCentavos, categoria });
  });
  return r;
}

/**
 * Compara as contas da planilha com as já lançadas nos mesmos meses. Mesmo nome no mesmo mês
 * é a mesma conta: igual se data e valor batem, senão "alterada". O que sobra na planilha é
 * novo; o que sobra no app "sumiu" da planilha (só é apagado se o usuário escolher).
 */
export function planejar(db, { contas }) {
  const meses = [...new Set(contas.map((c) => c.data.slice(0, 7)))].sort();
  const lancadas = meses.length ? db.prepare(`SELECT t.id, t.data, t.descricao, t.valor_centavos, c.nome AS categoria
      FROM transacoes t LEFT JOIN categorias c ON c.id = t.categoria_id
      WHERE t.banco = 'contas' AND t.manual = 1 AND substr(t.data, 1, 7) IN (${meses.map(() => '?').join(',')})
      ORDER BY t.data, t.id`).all(...meses) : [];
  const chave = (mes, descricao) => `${mes}|${normalizar(descricao)}`;
  const livres = new Map();
  for (const t of lancadas) {
    const k = chave(t.data.slice(0, 7), t.descricao);
    livres.set(k, [...(livres.get(k) ?? []), t]);
  }

  const plano = { meses, novas: [], alteradas: [], iguais: 0, sumidas: [] };
  const pendentes = [];
  // Primeiro as idênticas, para que contas repetidas no mês (ex.: duas parcelas) casem certo.
  for (const c of contas) {
    const lista = livres.get(chave(c.data.slice(0, 7), c.descricao)) ?? [];
    const i = lista.findIndex((t) => t.data === c.data && t.valor_centavos === c.valorCentavos);
    if (i >= 0) { lista.splice(i, 1); plano.iguais++; } else pendentes.push(c);
  }
  for (const c of pendentes) {
    const t = livres.get(chave(c.data.slice(0, 7), c.descricao))?.shift();
    if (t) {
      plano.alteradas.push({ id: t.id, descricao: t.descricao, de: { data: t.data, valorCentavos: t.valor_centavos },
        para: { data: c.data, valorCentavos: c.valorCentavos }, linha: c.linha });
    } else plano.novas.push({ ...c, categoria: categoriaDaNova(db, c) });
  }
  plano.sumidas = [...livres.values()].flat().map((t) => ({ id: t.id, data: t.data, descricao: t.descricao,
    valorCentavos: t.valor_centavos, categoria: t.categoria }));
  return plano;
}

/**
 * Categoria de uma conta nova: a da última conta com o mesmo nome no app (as categorias podem
 * ter sido reorganizadas lá), senão a da planilha. `nova: true` = será criada.
 */
function categoriaDaNova(db, c) {
  const anterior = db.prepare(`SELECT c.id, c.nome FROM transacoes t JOIN categorias c ON c.id = t.categoria_id
      WHERE t.banco = 'contas' AND t.manual = 1 AND lower(t.descricao) = lower(?) ORDER BY t.data DESC LIMIT 1`).get(c.descricao);
  if (anterior) return { id: anterior.id, nome: anterior.nome };
  if (!c.categoria) return null;
  try { const cat = buscarCategoria(db, c.categoria); return { id: cat.id, nome: cat.nome }; } catch {
    return { id: null, nome: c.categoria, nova: true };
  }
}

/** Grava o plano: lança as novas, corrige as alteradas e apaga as sumidas escolhidas (tudo ou nada). */
export function aplicar(db, plano, { apagar = [] } = {}) {
  const sumidas = new Set(plano.sumidas.map((s) => s.id));
  const ids = apagar.map(Number).filter((id) => sumidas.has(id));
  return emTransacao(db, () => {
    const criadas = new Map();
    for (const c of plano.novas) {
      let categoriaId = c.categoria?.id ?? null;
      if (c.categoria?.nova) {
        const k = normalizar(c.categoria.nome);
        if (!criadas.has(k)) criadas.set(k, criarCategoria(db, c.categoria.nome));
        categoriaId = criadas.get(k);
      }
      lancarConta(db, { data: c.data, descricao: c.descricao, valorCentavos: c.valorCentavos, categoriaId });
    }
    for (const a of plano.alteradas) editarConta(db, a.id, a.para);
    for (const id of ids) apagarConta(db, id);
    return { lancadas: plano.novas.length, alteradas: plano.alteradas.length, apagadas: ids.length, categoriasCriadas: criadas.size };
  });
}

/** Lê, compara e (com `gravar`) grava. Usado pela tela de importação e pela linha de comando. */
export function importarPlanilhaContas(db, { nome, buffer, gravar = false, apagar = [] }) {
  const lida = lerPlanilhaContas({ nome, buffer });
  const plano = planejar(db, lida);
  const resultado = { ignoradas: lida.ignoradas, erros: lida.erros, ...plano };
  if (!gravar) return resultado;
  if (lida.erros.length) throw new Error(`A planilha tem ${lida.erros.length} linha(s) com erro; corrija antes de gravar`);
  return { ...resultado, gravado: aplicar(db, plano, { apagar }) };
}
