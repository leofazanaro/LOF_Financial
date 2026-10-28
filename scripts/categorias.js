#!/usr/bin/env node
// Gerencia categorias pela linha de comando (a interface web usará as mesmas funções).
import { openDb } from '../src/db/index.js';
import {
  criarCategoria, criarRegra, definirCategoria, listarTransacoes, reclassificar, removerRegra, voltarParaAutomatico,
} from '../src/categorias.js';

const AJUDA = `Uso: npm run cat -- <comando>

  pendentes                         transações sem categoria
  transacoes [--banco X] [--categoria Y]
  categorias                        lista categorias com total gasto
  definir <id> <categoria> [--regra [texto]]
                                    escolhe a categoria da transação (manual);
                                    --regra também cria regra para as próximas faturas
  auto <id>                         desfaz a escolha manual (volta para as regras)
  regras                            lista as regras automáticas
  regra <texto> <categoria> [--banco X] [--regex]
                                    cria/atualiza regra e reclassifica
  remover-regra <id>
  nova <nome> [cor]                 cria categoria
  reclassificar                     reaplica todas as regras`;

const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const origem = { regra: 'auto', manual: 'manual' };

function opcoes(args) {
  const pos = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { pos.push(args[i]); continue; }
    const k = args[i].slice(2);
    opts[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  }
  return { pos, opts };
}

function mostrarTransacoes(linhas) {
  console.table(linhas.map((t) => ({
    id: t.id, banco: t.banco, cartao: t.cartao_final ?? '', data: t.data,
    descricao: t.descricao, valor: brl(t.valor_centavos),
    categoria: t.categoria ?? '—', origem: origem[t.categoria_origem] ?? '', regra: t.regra ?? '',
  })));
}

const [cmd, ...resto] = process.argv.slice(2);
const { pos, opts } = opcoes(resto);
const db = openDb();

try {
  switch (cmd) {
    case 'pendentes': {
      const l = listarTransacoes(db, { pendentes: true });
      if (!l.length) console.log('Nenhuma transação sem categoria.');
      else mostrarTransacoes(l);
      break;
    }
    case 'transacoes':
      mostrarTransacoes(listarTransacoes(db, { banco: opts.banco, categoria: opts.categoria }));
      break;
    case 'categorias':
      console.table(db.prepare(`SELECT c.id, c.nome, count(t.id) AS qtd,
          coalesce(sum(t.valor_centavos), 0) AS total FROM categorias c
          LEFT JOIN transacoes t ON t.categoria_id = c.id GROUP BY c.id ORDER BY total DESC`).all()
        .map((c) => ({ ...c, total: brl(c.total) })));
      break;
    case 'definir': {
      const [id, cat] = pos;
      if (!id || !cat) throw new Error('Uso: definir <id> <categoria> [--regra [texto]]');
      const c = definirCategoria(db, Number(id), cat, { criarRegra: opts.regra ?? false });
      console.log(`Transação ${id} → ${c.nome} (manual)${opts.regra ? ' + regra criada' : ''}`);
      break;
    }
    case 'auto':
      voltarParaAutomatico(db, Number(pos[0]));
      mostrarTransacoes(listarTransacoes(db).filter((t) => t.id === Number(pos[0])));
      break;
    case 'regras':
      console.table(db.prepare(`SELECT r.id, r.padrao, r.tipo_match AS tipo, c.nome AS categoria,
          coalesce(r.banco, 'todos') AS banco, r.origem FROM regras r JOIN categorias c ON c.id = r.categoria_id
          ORDER BY c.nome, r.padrao`).all());
      break;
    case 'regra': {
      const [padrao, cat] = pos;
      if (!padrao || !cat) throw new Error('Uso: regra <texto> <categoria> [--banco X] [--regex]');
      const r = criarRegra(db, { padrao, categoria: cat, banco: opts.banco ?? null, tipoMatch: opts.regex ? 'regex' : 'contem' });
      console.log(`Regra salva. ${r.classificadas} classificadas automaticamente, ${r.semCategoria} sem categoria.`);
      break;
    }
    case 'remover-regra': {
      const r = removerRegra(db, Number(pos[0]));
      console.log(`Regra removida. ${r.semCategoria} transações sem categoria.`);
      break;
    }
    case 'nova':
      console.log(`Categoria criada com id ${criarCategoria(db, pos[0], pos[1])}`);
      break;
    case 'reclassificar': {
      const r = reclassificar(db);
      console.log(`${r.classificadas} classificadas automaticamente, ${r.semCategoria} sem categoria.`);
      break;
    }
    default:
      console.log(AJUDA);
  }
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
