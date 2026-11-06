// Leitor mínimo de planilhas .xlsx (Excel / Google Sheets → "Fazer download → .xlsx"), sem
// dependências: o arquivo é um zip de XMLs; lemos só os valores das células (fórmulas vêm com o
// último resultado calculado). Não interpreta formatos: números chegam como "248.1".
import { inflateRawSync } from 'node:zlib';

/** Arquivos do zip: { 'xl/workbook.xml': Buffer, ... } */
function abrirZip(buf) {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('Arquivo .xlsx inválido');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo .xlsx inválido');
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nome = buf.toString('utf8', p + 46, p + 46 + buf.readUInt16LE(p + 28));
    const local = buf.readUInt32LE(p + 42);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(inicio, inicio + tamanho);
    arquivos[nome] = metodo === 8 ? inflateRawSync(dados) : dados;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return arquivos;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (xml) => xml.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTIDADES[e] ?? m));
/** Junta os <t> de um trecho (texto com formatação vem quebrado em vários <r><t>). */
const textos = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');
const atributo = (attrs, nome) => attrs.match(new RegExp(`(?:^|\\s)${nome}="([^"]*)"`))?.[1];

/** "AB12" -> 27 (índice da coluna, base 0) */
function coluna(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Abas da planilha: [{ nome, linhas: [['Ano', 'Mes', ...], ...] }] (células vazias = ''). */
export function lerXlsx(buffer) {
  const zip = abrirZip(buffer);
  const xml = (nome) => zip[nome]?.toString('utf8') ?? '';
  const compartilhados = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  const destinos = Object.fromEntries([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s([^>]*)\/?>/g)]
    .map((m) => [atributo(m[1], 'Id'), atributo(m[1], 'Target')]));

  return [...xml('xl/workbook.xml').matchAll(/<sheet\s([^>]*)\/?>/g)].map((m) => {
    const alvo = destinos[atributo(m[1], 'r:id')].replace(/^\//, '');
    const linhas = [];
    for (const [, corpo = ''] of xml(alvo.startsWith('xl/') ? alvo : `xl/${alvo}`).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const linha = [];
      for (const [, attrs, conteudo = ''] of corpo.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = conteudo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const tipo = atributo(attrs, 't');
        linha[coluna(atributo(attrs, 'r'))] = tipo === 's' ? compartilhados[Number(v)] ?? ''
          : tipo === 'inlineStr' ? textos(conteudo) : texto(v ?? '');
      }
      linhas.push(Array.from(linha, (c) => c ?? ''));
    }
    return { nome: texto(atributo(m[1], 'name')), linhas };
  });
}
