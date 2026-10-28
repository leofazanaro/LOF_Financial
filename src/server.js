import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DB_PATH, openDb } from './db/index.js';
import { importar } from './importacao.js';
import * as consultas from './consultas.js';
import {
  apagarCategoria, criarCategoria, criarRegra, definirCategoria, editarCategoria, removerRegra, voltarParaAutomatico,
} from './categorias.js';
import { apagarBanco, criarBanco, definirApelidoCartao, editarBanco, listarBancos } from './bancos.js';
import * as patrimonio from './patrimonio.js';
import { apagarConta, editarConta, lancarConta } from './contas.js';
import * as analises from './analises.js';
import { definirApelido, desetiquetar, etiquetar, removerEtiqueta } from './marcacoes.js';
import {
  criarRegraDesconsiderar, definirDesconsiderada, listarDesconsiderados, regrasDesconsiderar,
  removerRegraDesconsiderar, voltarAoAutomatico,
} from './desconsiderar.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);

export function criarApp({
  db = openDb(), senha = process.env.APP_PASSWORD, pastaArquivos = join(dirname(DEFAULT_DB_PATH), 'arquivos'),
} = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // Login opcional (HTTP Basic). Defina APP_PASSWORD ao expor o painel fora da sua máquina.
  if (senha) {
    const esperado = Buffer.from(`${process.env.APP_USER ?? 'admin'}:${senha}`);
    app.addHook('onRequest', async (req, reply) => {
      const [tipo, valor] = (req.headers.authorization ?? '').split(' ');
      const recebido = Buffer.from(tipo === 'Basic' && valor ? Buffer.from(valor, 'base64').toString() : '');
      if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
        reply.header('WWW-Authenticate', 'Basic realm="Painel financeiro"').code(401).send('Autenticação necessária');
      }
    });
  }

  app.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024, files: 20 } });
  app.register(fastifyStatic, { root: join(here, '../public') });
  app.register(fastifyStatic, {
    root: join(here, '../node_modules/echarts/dist'),
    prefix: '/vendor/echarts/',
    decorateReply: false,
  });

  // Erros de regra de negócio (categoria inexistente, regex inválida...) viram 400.
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 400;
    req.log.warn({ err }, 'requisição recusada');
    reply.code(status).send({ erro: err.message });
  });

  const paramIdNum = { params: { type: 'object', properties: { id: { type: 'integer' } } } };
  app.get('/api/filtros', async () => consultas.opcoesDeFiltro(db));
  app.get('/api/resumo', async (req) => consultas.resumo(db, req.query));
  app.get('/api/transacoes', async (req) => consultas.transacoes(db, req.query));

  app.patch('/api/transacoes/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          categoriaId: { type: ['integer', 'null'] },        // null = voltar para automático
          regra: { anyOf: [{ type: 'boolean' }, { type: 'string', minLength: 2 }] },
        },
        required: ['categoriaId'],
      },
    },
  }, async (req) => {
    const { id } = req.params;
    const { categoriaId, regra = false } = req.body;
    if (categoriaId == null) voltarParaAutomatico(db, id);
    else definirCategoria(db, id, categoriaId, { criarRegra: regra });
    return consultas.transacoes(db, {}).find((t) => t.id === id) ?? null;
  });

  // Contas normais lançadas à mão (aluguel, luz...): contam no mês do vencimento.
  const CONTA = {
    type: 'object',
    properties: {
      data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      descricao: { type: 'string', minLength: 1, maxLength: 120 },
      valorCentavos: { type: 'integer', minimum: 1 },
      categoriaId: { type: ['integer', 'null'] },
    },
    additionalProperties: false,
  };
  app.post('/api/contas', { schema: { body: { ...CONTA, required: ['data', 'descricao', 'valorCentavos'] } } },
    async (req) => lancarConta(db, req.body));
  app.put('/api/contas/:id', { schema: { ...paramIdNum, body: CONTA } }, async (req) => editarConta(db, req.params.id, req.body));
  app.delete('/api/contas/:id', { schema: paramIdNum }, async (req) => apagarConta(db, req.params.id));

  // Ações em lote: mesma categoria para várias transações.
  app.post('/api/transacoes/categoria', {
    schema: {
      body: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'integer' }, minItems: 1 }, categoriaId: { type: ['integer', 'null'] } },
        required: ['ids', 'categoriaId'],
      },
    },
  }, async (req) => {
    const { ids, categoriaId } = req.body;
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        if (categoriaId == null) voltarParaAutomatico(db, id);
        else definirCategoria(db, id, categoriaId);
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return { alteradas: ids.length };
  });

  // Etiquetas
  app.get('/api/etiquetas', async () => consultas.etiquetas(db));
  app.post('/api/etiquetas/aplicar', {
    schema: {
      body: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'integer' }, minItems: 1 }, nome: { type: 'string', minLength: 1, maxLength: 40 } },
        required: ['ids', 'nome'],
      },
    },
  }, async (req) => etiquetar(db, req.body.ids, req.body.nome));
  app.delete('/api/transacoes/:id/etiquetas/:etiquetaId', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' }, etiquetaId: { type: 'integer' } } } },
  }, async (req) => { desetiquetar(db, req.params.id, req.params.etiquetaId); return { ok: true }; });
  app.delete('/api/etiquetas/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req) => { removerEtiqueta(db, req.params.id); return { ok: true }; });

  // Apelidos (por estabelecimento)
  app.put('/api/apelidos', {
    schema: {
      body: {
        type: 'object',
        properties: { chave: { type: 'string', minLength: 1 }, apelido: { type: ['string', 'null'], maxLength: 80 } },
        required: ['chave'],
      },
    },
  }, async (req) => { definirApelido(db, req.body.chave, req.body.apelido); return { ok: true }; });

  // Desconsiderados
  const corpoIds = (extra = {}) => ({
    schema: {
      body: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'integer' }, minItems: 1 }, ...extra },
        required: ['ids'],
      },
    },
  });
  app.get('/api/desconsiderados', async (req) => listarDesconsiderados(db, req.query));
  app.post('/api/desconsiderar', corpoIds({ motivo: { type: ['string', 'null'], maxLength: 120 } }),
    async (req) => definirDesconsiderada(db, req.body.ids, true, req.body.motivo));
  app.post('/api/considerar', corpoIds(), async (req) => definirDesconsiderada(db, req.body.ids, false));
  app.post('/api/desconsiderar/automatico', corpoIds(), async (req) => voltarAoAutomatico(db, req.body.ids));
  app.get('/api/regras-desconsiderar', async () => regrasDesconsiderar(db));
  app.post('/api/regras-desconsiderar', {
    schema: {
      body: {
        type: 'object',
        properties: {
          padrao: { type: 'string', minLength: 2 }, banco: { type: ['string', 'null'] }, regex: { type: 'boolean' },
          soCreditos: { type: 'boolean' }, motivo: { type: ['string', 'null'], maxLength: 120 },
        },
        required: ['padrao'],
      },
    },
  }, async (req) => criarRegraDesconsiderar(db, {
    padrao: req.body.padrao, banco: req.body.banco || null, tipoMatch: req.body.regex ? 'regex' : 'contem',
    soCreditos: !!req.body.soCreditos, motivo: req.body.motivo,
  }));
  app.delete('/api/regras-desconsiderar/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req) => removerRegraDesconsiderar(db, req.params.id));

  // Evolução patrimonial
  const DATA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
  app.get('/api/patrimonio', async () => patrimonio.evolucao(db));
  app.put('/api/patrimonio/:data', {
    schema: {
      params: { type: 'object', properties: { data: DATA } },
      body: {
        type: 'object',
        properties: {
          valores: { type: 'object', additionalProperties: { type: ['integer', 'null'] } },
          aporte: { type: 'integer' },
        },
        required: ['valores'],
      },
    },
  }, async (req) => { patrimonio.salvarRegistro(db, req.params.data, req.body); return { ok: true }; });
  app.delete('/api/patrimonio/:data', { schema: { params: { type: 'object', properties: { data: DATA } } } },
    async (req) => { patrimonio.apagarRegistro(db, req.params.data); return { ok: true }; });
  app.put('/api/patrimonio-objetivo', {
    schema: {
      body: {
        type: 'object',
        properties: {
          nome: { type: ['string', 'null'], maxLength: 60 }, valorCentavos: { type: 'integer' },
          aporteDesejadoCentavos: { type: ['integer', 'null'] },
          dataAlvo: { anyOf: [DATA, { type: 'null' }, { type: 'string', maxLength: 0 }] },
        },
        required: ['valorCentavos'],
      },
    },
  }, async (req) => { patrimonio.definirObjetivo(db, req.body); return { ok: true }; });
  app.delete('/api/patrimonio-estimados', async () => patrimonio.apagarEstimados(db));
  app.delete('/api/patrimonio-objetivo', async () => { patrimonio.removerObjetivo(db); return { ok: true }; });
  const CARTEIRA = {
    type: 'object',
    properties: { nome: { type: 'string', minLength: 1 }, cor: { type: ['string', 'null'] }, ativa: { type: 'boolean' } },
  };
  app.post('/api/carteiras', { schema: { body: { ...CARTEIRA, required: ['nome'] } } },
    async (req) => ({ id: patrimonio.criarCarteira(db, req.body) }));
  app.put('/api/carteiras/:id', { schema: { ...paramIdNum, body: CARTEIRA } },
    async (req) => { patrimonio.editarCarteira(db, req.params.id, req.body); return { ok: true }; });
  app.delete('/api/carteiras/:id', { schema: paramIdNum },
    async (req) => { patrimonio.apagarCarteira(db, req.params.id); return { ok: true }; });

  // Análises
  app.get('/api/parcelas', async (req) => analises.parcelasFuturas(db, req.query));
  app.get('/api/assinaturas', async () => analises.assinaturas(db));
  app.post('/api/assinaturas', {
    schema: {
      body: {
        type: 'object',
        properties: {
          banco: { type: 'string' }, chave: { type: 'string' }, nome: { type: 'string', minLength: 1 },
          status: { enum: ['ativa', 'ignorada'] },
        },
        required: ['banco', 'chave', 'nome'],
      },
    },
  }, async (req) => { analises.salvarAssinatura(db, req.body); return { ok: true }; });
  app.delete('/api/assinaturas/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req) => { analises.removerAssinatura(db, req.params.id); return { ok: true }; });
  app.get('/api/orcamento', async (req) => analises.orcamento(db, req.query.referencia || undefined));
  app.put('/api/orcamento/:categoriaId', {
    schema: {
      params: { type: 'object', properties: { categoriaId: { type: 'integer' } } },
      body: { type: 'object', properties: { limiteCentavos: { type: ['integer', 'null'] } }, required: ['limiteCentavos'] },
    },
  }, async (req) => { analises.definirOrcamento(db, req.params.categoriaId, req.body.limiteCentavos); return { ok: true }; });
  app.get('/api/comparacao', async (req) => analises.comparacao(db, {
    referencia: req.query.ate || undefined, banco: req.query.banco, cartao: req.query.cartao,
  }));

  app.get('/api/categorias', async () => consultas.categoriasComUso(db));
  const COR = { type: ['string', 'null'], pattern: '^(#[0-9a-fA-F]{6})?$' };
  const paramId = { params: { type: 'object', properties: { id: { type: 'integer' } } } };
  app.post('/api/categorias', {
    schema: { body: { type: 'object', properties: { nome: { type: 'string', minLength: 1 }, cor: COR }, required: ['nome'] } },
  }, async (req) => ({ id: criarCategoria(db, req.body.nome, req.body.cor) }));
  app.put('/api/categorias/:id', {
    schema: { ...paramId, body: { type: 'object', properties: { nome: { type: 'string', minLength: 1 }, cor: COR } } },
  }, async (req) => editarCategoria(db, req.params.id, req.body));
  app.delete('/api/categorias/:id', {
    schema: { ...paramId, querystring: { type: 'object', properties: { moverPara: { type: 'integer' } } } },
  }, async (req) => apagarCategoria(db, req.params.id, { moverPara: req.query.moverPara ?? null }));

  // Bancos
  const DADOS_BANCO = {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1 }, cor: COR,
      diaFechamento: { type: ['integer', 'null'] }, diaVencimento: { type: ['integer', 'null'] },
      limiteCentavos: { type: ['integer', 'null'] }, observacao: { type: ['string', 'null'], maxLength: 200 },
    },
  };
  const paramBanco = { params: { type: 'object', properties: { codigo: { type: 'string' } } } };
  app.get('/api/bancos', async () => listarBancos(db));
  app.post('/api/bancos', { schema: { body: { ...DADOS_BANCO, required: ['nome'] } } }, async (req) => criarBanco(db, req.body));
  app.put('/api/bancos/:codigo', { schema: { ...paramBanco, body: DADOS_BANCO } },
    async (req) => { editarBanco(db, req.params.codigo, req.body); return { ok: true }; });
  app.delete('/api/bancos/:codigo', { schema: paramBanco },
    async (req) => { apagarBanco(db, req.params.codigo); return { ok: true }; });
  app.put('/api/bancos/:codigo/cartoes/:final', {
    schema: { body: { type: 'object', properties: { apelido: { type: ['string', 'null'] } } } },
  }, async (req) => { definirApelidoCartao(db, req.params.codigo, req.params.final, req.body.apelido); return { ok: true }; });

  app.get('/api/regras', async () => consultas.regras(db));
  app.post('/api/regras', {
    schema: {
      body: {
        type: 'object',
        properties: {
          padrao: { type: 'string', minLength: 2 },
          categoriaId: { type: 'integer' },
          banco: { type: ['string', 'null'] },
          regex: { type: 'boolean' },
        },
        required: ['padrao', 'categoriaId'],
      },
    },
  }, async (req) => criarRegra(db, {
    padrao: req.body.padrao.trim(),
    categoria: req.body.categoriaId,
    banco: req.body.banco || null,
    tipoMatch: req.body.regex ? 'regex' : 'contem',
  }));
  app.delete('/api/regras/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req) => removerRegra(db, req.params.id));

  app.get('/api/importacoes', async () => consultas.importacoes(db));
  app.post('/api/importar', async (req) => {
    const resultados = [];
    for await (const parte of req.files()) {
      const nome = parte.filename;
      try {
        resultados.push(await importar(db, { nome, buffer: await parte.toBuffer(), pastaArquivos }));
      } catch (err) {
        resultados.push({ arquivo: nome, status: 'erro', erro: err.message });
      }
    }
    return resultados;
  });

  app.addHook('onClose', async () => db.close());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = criarApp();
  if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && !process.env.APP_PASSWORD) {
    app.log.warn('Servidor aberto na rede SEM senha: defina APP_PASSWORD no arquivo .env');
  }
  await app.listen({ host: HOST, port: PORT });
}
