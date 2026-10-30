#!/usr/bin/env node
// Cria um banco de demonstração com dados fictícios (faturas, contas, renda e patrimônio).
// Uso: npm run demo -- <arquivo.db>
// Depois: DB_PATH=<arquivo.db> PORT=3001 npm start
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_DB_PATH, openDb } from '../src/db/index.js';
import { importar } from '../src/importacao.js';
import { lancarConta } from '../src/contas.js';
import { lancarRenda } from '../src/renda.js';
import { buscarCategoria, criarCategoria } from '../src/categorias.js';
import { definirOrcamento } from '../src/analises.js';
import { criarCarteira, definirObjetivo, salvarRegistro } from '../src/patrimonio.js';

const destino = process.argv[2];
if (!destino) { console.error('Uso: npm run demo -- <arquivo.db>'); process.exit(1); }
if (resolve(destino) === resolve(DEFAULT_DB_PATH)) { console.error('Escolha outro arquivo: este é o banco real.'); process.exit(1); }
if (existsSync(destino)) { console.error(`${destino} já existe.`); process.exit(1); }

const db = openDb(destino);
const meses = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
// Gerador determinístico, para as capturas de tela saírem sempre iguais.
let semente = 42;
const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
const variar = (centavos, faixa = 0.25) => Math.round(centavos * (1 - faixa + aleatorio() * faixa * 2));
const mesAntes = (ref) => { const [a, m] = ref.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const reais = (c) => (c / 100).toFixed(2);

// Gastos típicos de um mês; as descrições casam com as regras padrão de categoria.
const FIXOS = [
  ['NETFLIX.COM', 5590], ['SPOTIFY', 2190], ['YOUTUBEPREMIUM', 2690], ['RECARGA CLARO', 5990],
];
const VARIAVEIS = [
  ['SUPERMERCADO BOM PRECO', 32000, 3], ['CARREFOUR', 21000, 2], ['ASSAI ATACADISTA', 26000, 1],
  ['IFOOD *RESTAURANTE', 6500, 4], ['PADARIA CENTRAL', 2800, 3], ['RESTAURANTE SABOR CASEIRO', 9500, 2],
  ['POSTO SHELL', 22000, 2], ['UBER *TRIP', 2600, 3], ['DROGASIL', 8900, 1],
  ['AMAZON MARKETPLACE', 15000, 1], ['STEAM GAMES', 7200, 1], ['LEROY MERLIN', 18000, 1],
];

for (const [i, ref] of meses.entries()) {
  const anterior = mesAntes(ref);
  const linhas = [['date', 'title', 'amount']];
  const dia = (d) => `${anterior}-${String(d).padStart(2, '0')}`;
  for (const [t, v] of FIXOS) linhas.push([dia(5 + Math.floor(aleatorio() * 3)), t, reais(v)]);
  for (const [t, v, n] of VARIAVEIS) {
    for (let k = 0; k < n; k++) linhas.push([dia(1 + Math.floor(aleatorio() * 27)), t, reais(variar(v))]);
  }
  // Compras parceladas que atravessam os meses.
  linhas.push([dia(12), `KABUM NOTEBOOK - Parcela ${i + 1}/10`, '459.90']);
  if (i >= 2) linhas.push([dia(18), `GELADEIRA CASA E CIA - Parcela ${i - 1}/6`, '389.00']);
  linhas.push([dia(26), 'Pagamento recebido', '-3200.00']);
  const csv = linhas.map((l) => l.join(',')).join('\n');
  await importar(db, { nome: `Nubank_${ref}-10.csv`, buffer: Buffer.from(csv), pastaArquivos: null });
}

// Contas da casa (fora do cartão).
const moradia = criarCategoria(db, 'Moradia', '#37474f');
for (const ref of meses) {
  lancarConta(db, { data: `${ref}-05`, descricao: 'Aluguel', valorCentavos: 180000, categoriaId: moradia });
  lancarConta(db, { data: `${ref}-10`, descricao: 'Energia', valorCentavos: variar(21000), categoriaId: moradia });
  lancarConta(db, { data: `${ref}-12`, descricao: 'Internet', valorCentavos: 11990, categoriaId: moradia });
}

// Renda.
for (const ref of meses) {
  lancarRenda(db, { data: `${ref}-05`, descricao: 'Salário', valorCentavos: 920000 });
  if (['2026-07', '2026-09', '2026-10'].includes(ref)) {
    lancarRenda(db, { data: `${ref}-20`, descricao: 'Freela', valorCentavos: variar(150000, 0.4) });
  }
}

// Orçamento.
for (const [nome, limite] of [['Mercado', 150000], ['Alimentação', 60000], ['Veículo/Transporte', 55000], ['Lazer/Jogos', 15000]]) {
  definirOrcamento(db, buscarCategoria(db, nome).id, limite);
}

// Patrimônio: uma anotação por mês, com aporte e rendimento.
const carteiras = [
  [criarCarteira(db, { nome: 'Reserva de emergência', cor: '#2e7d32' }), 2500000, 0.008],
  [criarCarteira(db, { nome: 'Tesouro IPCA+', cor: '#1565c0' }), 4200000, 0.009],
  [criarCarteira(db, { nome: 'Ações', cor: '#ef6c00' }), 1800000, 0.012],
];
const saldo = new Map(carteiras.map(([id, inicial]) => [id, inicial]));
salvarRegistro(db, '2026-04-30', { valores: Object.fromEntries(saldo) });
for (const ref of meses) {
  const aportes = carteiras.map(([id, , taxa], k) => {
    const aporte = [50000, 80000, 40000][k];
    const rende = Math.round(saldo.get(id) * (taxa + (aleatorio() - 0.5) * 0.01));
    saldo.set(id, saldo.get(id) + rende + aporte);
    return aporte;
  });
  const fim = new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5)), 0)).toISOString().slice(0, 10);
  salvarRegistro(db, fim, { valores: Object.fromEntries(saldo), aporte: aportes.reduce((a, b) => a + b, 0) });
}
definirObjetivo(db, { nome: 'Independência financeira', valorCentavos: 50000000, dataAlvo: '2035-12-31', aporteDesejadoCentavos: 200000 });

console.log(`Banco de demonstração criado em ${destino}`);
