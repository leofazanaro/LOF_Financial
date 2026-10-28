import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as nubankCsv from './nubank-csv.js';
import * as interPdf from './inter-pdf.js';
import { extrairLinhas } from './pdf-text.js';
import { sha256 } from './util.js';

// Para suportar um novo banco: criar um módulo com detectar() e importar() e registrar aqui.
const IMPORTADORES = {
  csv: [nubankCsv],
  pdf: [interPdf],
};

/** Lê o arquivo do disco e converte (usado pela linha de comando). */
export const importarArquivo = (caminho) => converter({ nome: basename(caminho), buffer: readFileSync(caminho) });

/** Escolhe o importador pelo nome/conteúdo e devolve os dados no formato padrão. */
export async function converter({ nome, buffer }) {
  const formato = extname(nome).slice(1).toLowerCase();
  // O texto permite reconhecer o banco mesmo que o arquivo tenha sido renomeado.
  const texto = formato === 'csv' ? buffer.toString('utf8')
    : formato === 'pdf' ? (await extrairLinhas(buffer)).map((l) => l.texto).join('\n')
    : null;

  const importador = (IMPORTADORES[formato] ?? []).find((i) => i.detectar({ nome, texto }));
  if (!importador) throw new Error(`Nenhum importador reconhece "${nome}"`);

  const resultado = await importador.importar({ nome, texto, buffer });
  return { arquivo: { nome, hash: sha256(buffer) }, resultado };
}
