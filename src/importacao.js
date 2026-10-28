import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveImport } from './db/index.js';
import { converter } from './importers/index.js';
import { sha256 } from './importers/util.js';

/**
 * Guarda uma cópia do arquivo enviado (permite reprocessar depois de corrigir um leitor e
 * investigar arquivos que falharam). Nome: <início do sha256>-<nome original>.
 */
function guardarArquivo(pasta, nome, buffer, falhou) {
  if (!pasta) return;
  const destino = falhou ? join(pasta, 'falhas') : pasta;
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, `${sha256(buffer).slice(0, 12)}-${nome.replace(/[^\w.-]+/g, '_')}`), buffer);
}

/**
 * Converte e grava um arquivo de fatura. Usado pela linha de comando e pelo upload web.
 * Retorna `{ status: 'importado' | 'repetido', ... }`; erros de conversão são lançados.
 */
export async function importar(db, { nome, buffer, pastaArquivos }) {
  let dados;
  try {
    dados = await converter({ nome, buffer });
  } catch (err) {
    guardarArquivo(pastaArquivos, nome, buffer, true);
    throw err;
  }
  guardarArquivo(pastaArquivos, nome, buffer, false);
  const { banco, fatura, transacoes } = dados.resultado;
  const base = { arquivo: nome, banco, referencia: fatura.referencia, totalImpresso: fatura.totalCentavos };

  const anterior = db.prepare('SELECT id FROM importacoes WHERE arquivo_hash = ?').get(dados.arquivo.hash);
  if (anterior) return { ...base, status: 'repetido', importacaoId: anterior.id };

  const r = saveImport(db, dados);
  const gastos = transacoes.filter((t) => t.valorCentavos > 0).reduce((s, t) => s + t.valorCentavos, 0);
  return { ...base, status: 'importado', ...r, gastosCentavos: gastos };
}
