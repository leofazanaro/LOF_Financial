// Interface do painel: roteamento por hash (#/rota?filtros), sem etapa de build.

const $app = document.getElementById('app');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mes = (ref) => `${MESES[Number(ref.slice(5, 7)) - 1]}/${ref.slice(0, 4)}`;
const dataBR = (iso) => iso.split('-').reverse().join('/');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

/** "1.234,56" | "1.300" | "900" | "R$ 50,5" -> centavos; vazio -> null */
function lerValor(txt) {
  const s = String(txt).replace(/R\$|\s/g, '');
  if (!s) return null;
  // "1.300" é mil e trezentos (ponto de milhar), não 1,3.
  const milhar = /^\d{1,3}(\.\d{3})+$/.test(s);
  const n = Number(s.includes(',') || milhar ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Valor inválido');
  return Math.round(n * 100);
}

/**
 * Campos de dinheiro (input[data-moeda]) se formatam enquanto se digita, como nos apps de banco:
 * só os dígitos contam e as duas últimas casas são os centavos ("1" → 0,01; "123456" → 1.234,56).
 * Com data-moeda="sinal" o valor pode ser negativo: cada "-" digitado inverte o sinal, "+" tira.
 * Captura: formata antes dos outros ouvintes de "input" (ex.: total ao vivo do patrimônio).
 */
function mascararMoeda(inp) {
  const v = inp.value;
  const negativo = inp.dataset.moeda === 'sinal' && !v.includes('+') && (v.match(/-|−/g)?.length ?? 0) % 2 === 1;
  const digitos = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  inp.value = (negativo ? '-' : '') + (digitos ? (Number(digitos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  inp.setSelectionRange(inp.value.length, inp.value.length);
}
document.addEventListener('input', (e) => { if (e.target.matches?.('input[data-moeda]')) mascararMoeda(e.target); }, true);

// Cada render tem um número; uma leitura (GET) iniciada por um render antigo é descartada,
// para que uma tela lenta não seja desenhada por cima da tela que o usuário abriu depois.
let renderSeq = 0;
class Obsoleto extends Error {}

async function api(url, opts = {}) {
  const seq = renderSeq;
  const leitura = !opts.method || opts.method === 'GET';
  const json = opts.body && !(opts.body instanceof FormData);
  const r = await fetch(url, {
    ...opts,
    headers: json ? { 'content-type': 'application/json' } : undefined,
    body: json ? JSON.stringify(opts.body) : opts.body,
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dados?.erro ?? `${r.status} ${r.statusText}`);
  if (leitura && seq !== renderSeq) throw new Obsoleto();
  return dados;
}

let avisoTimer;
function aviso(msg, erro = false) {
  const el = document.getElementById('aviso');
  el.textContent = msg;
  el.className = erro ? 'erro' : '';
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, erro ? 6000 : 3000);
}

/**
 * Diálogo do app no lugar de prompt()/confirm() nativos (mesmo visual do painel, botões grandes no celular).
 * Com `campo`, resolve com o texto digitado ou null se cancelar; sem, com true/false.
 * Enter confirma, Esc cancela; em ação de `perigo` o foco começa no Cancelar.
 */
function dialogo({ titulo, texto = '', campo = null, botao = 'OK', perigo = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo';
  dlg.innerHTML = `<form method="dialog">
    <h2>${esc(titulo)}</h2>
    ${texto ? `<p>${esc(texto)}</p>` : ''}
    ${campo ? `<label>${esc(campo.rotulo ?? '')}
      <input name="valor" value="${esc(campo.valor ?? '')}" placeholder="${esc(campo.dica ?? '')}" maxlength="${campo.max ?? 120}"
        ${campo.sugestoes?.length ? 'list="dlg-sugestoes"' : ''} autocomplete="off"></label>
      ${campo.sugestoes?.length ? `<datalist id="dlg-sugestoes">${campo.sugestoes.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}` : ''}
    <div class="barra-acoes"><button type="button" data-cancelar>Cancelar</button>
      <button class="primario ${perigo ? 'perigo-btn' : ''}" value="ok">${esc(botao)}</button></div>
  </form>`;
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.querySelector('[data-cancelar]').addEventListener('click', () => dlg.close(''));
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      resolve(campo ? (ok ? dlg.querySelector('input').value : null) : ok);
      dlg.remove();
    });
    dlg.showModal();
    const inp = dlg.querySelector('input');
    if (inp) inp.select();
    else dlg.querySelector(perigo ? '[data-cancelar]' : '.primario').focus();
  });
}
const confirmar = (titulo, texto, opts = {}) => dialogo({ titulo, texto, botao: 'Apagar', perigo: true, ...opts });
const perguntar = (titulo, campo, opts = {}) => dialogo({ titulo, campo, botao: 'Salvar', ...opts });

/** Executa uma ação, mostra o aviso e redesenha a tela. */
async function acao(fn, msg) {
  try {
    const r = await fn();
    aviso(typeof msg === 'function' ? msg(r) : msg);
    await carregarOpcoes().catch(() => {});
    render();
    return true;
  } catch (err) {
    if (!(err instanceof Obsoleto)) aviso(err.message, true);
    return false;
  }
}

// ---------- rotas e filtros ----------

function rotaAtual() {
  const [caminho, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [rota, param] = caminho.split('/');
  return { rota: rota ?? '', param, filtros: Object.fromEntries(new URLSearchParams(query)) };
}

function irPara(rota, filtros = {}) {
  const q = qs(filtros);
  location.hash = `#/${rota}${q ? `?${q}` : ''}`;
}

let opcoes = null;
const carregarOpcoes = async () => (opcoes = await api('/api/filtros'));

// Nome e cor de exibição vêm do cadastro de bancos (tela Configurar › Bancos).
const infoBanco = (b) => opcoes?.bancosInfo.find((x) => x.codigo === b);
const nomeBanco = (b) => infoBanco(b)?.nome ?? b;
/** Cor escolhida no cadastro; sem cor, a série categórica fixa pela ordem do código. */
function corBanco(b) {
  const i = opcoes.bancosInfo.findIndex((x) => x.codigo === b);
  return opcoes.bancosInfo[i]?.cor || css(`--series-${((i < 0 ? 0 : i) % 8) + 1}`);
}
const nomeCartao = (banco, final) => {
  const apelido = opcoes?.cartoes.find((c) => c.banco === banco && c.cartao_final === final)?.apelido;
  return `•${final}${apelido ? ` ${apelido}` : ''}`;
};
const bolinha = (cor) => `<span class="bolinha" style="background:${esc(cor || 'var(--text-3)')}" aria-hidden="true"></span>`;

/** Barra de filtros: período (mês da fatura), banco, cartão e, opcionalmente, grupo/categoria, categoria, etiqueta e busca. */
function barraFiltros(filtros, { periodo = true, bancos = true, alvo = false, categoria = false, etiqueta = false, busca = false } = {}) {
  const sel = (nome, rotulo, itens, todos = 'Todos') => `
    <label>${rotulo}
      <select name="${nome}">
        <option value="">${todos}</option>
        ${itens.map(([v, t]) => `<option value="${esc(v)}" ${String(filtros[nome] ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
    </label>`;
  const refs = opcoes.referencias.map((r) => [r, mes(r)]);
  // Grupo ou categoria num seletor só: "g<id>" filtra o grupo, "c<id>" a categoria.
  const opcao = (v, t) => `<option value="${v}" ${filtros.alvo === v ? 'selected' : ''}>${esc(t)}</option>`;
  const selAlvo = `<label>Grupo ou categoria
      <select name="alvo">
        <option value="">Todos os gastos</option>
        ${opcoes.grupos.length ? `<optgroup label="Grupos">${opcoes.grupos.map((g) => opcao(`g${g.id}`, g.nome)).join('')}</optgroup>` : ''}
        <optgroup label="Categorias">${opcoes.categorias.map((c) => opcao(`c${c.id}`, c.nome)).join('')}${opcao('csem', 'Sem categoria')}</optgroup>
      </select>
    </label>`;
  // No celular o formulário fica recolhido atrás de um botão que conta os filtros em uso
  // (o mês escolhido nos atalhos não conta: ele já aparece marcado).
  const emUso = Object.entries(filtros).filter(([k, v]) => v && !(periodo && ['de', 'ate'].includes(k) && filtros.de === filtros.ate)).length;
  return `${periodo ? seletorMes(filtros) : ''}
  <button type="button" class="botao-filtros" data-abrir-filtros aria-expanded="${filtrosAbertos}">
    Filtros${emUso ? ` (${emUso})` : ''} <span aria-hidden="true">${filtrosAbertos ? '▴' : '▾'}</span></button>
  <form class="filtros ${filtrosAbertos ? 'abertos' : ''}" data-filtros>
    ${alvo ? selAlvo : ''}
    ${periodo ? sel('de', 'De (fatura)', refs, 'Início') + sel('ate', 'Até (fatura)', refs, 'Fim') : ''}
    ${bancos ? sel('banco', 'Banco', opcoes.bancos.map((b) => [b, nomeBanco(b)])) : ''}
    ${bancos ? sel('cartao', 'Cartão', opcoes.cartoes.map((c) => [c.cartao_final, `${nomeBanco(c.banco)} ${nomeCartao(c.banco, c.cartao_final)}`])) : ''}
    ${categoria ? sel('categoria', 'Categoria', [['sem', 'Sem categoria'], ...opcoes.categorias.map((c) => [c.id, c.nome])], 'Todas') : ''}
    ${etiqueta && opcoes.etiquetas.length ? sel('etiqueta', 'Etiqueta', opcoes.etiquetas.map((e) => [e.id, e.nome]), 'Todas') : ''}
    ${busca ? `<label>Busca<input type="search" name="q" value="${esc(filtros.q ?? '')}" placeholder="descrição ou apelido"></label>` : ''}
    ${Object.keys(filtros).length ? '<button type="button" class="link" data-limpar>Limpar filtros</button>' : ''}
  </form>`;
}

/**
 * Atalho de mês: um clique filtra só aquele mês da fatura (de = até = mês).
 * "Todos" limpa o período. Os meses vêm do mais recente para o mais antigo, então a seta da
 * esquerda vai para o mês seguinte e a da direita para o anterior (andando junto com a lista).
 */
function seletorMes(filtros) {
  const refs = opcoes.referencias;
  if (!refs.length) return '';
  const atual = filtros.de && filtros.de === filtros.ate ? filtros.de : null;
  const semPeriodo = !filtros.de && !filtros.ate;
  const i = refs.indexOf(atual);
  const anterior = atual ? refs[i - 1] : refs.at(-1);
  const proximo = atual ? refs[i + 1] : null;
  let ano = null;
  const chips = [...refs].reverse().map((r) => {
    const sep = r.slice(0, 4) !== ano ? `<span class="meses-ano">${(ano = r.slice(0, 4))}</span>` : '';
    return `${sep}<button type="button" class="chip-mes ${r === atual ? 'ativo' : ''}" data-mes="${r}"
      aria-pressed="${r === atual}" title="${mes(r)}">${MESES[Number(r.slice(5, 7)) - 1]}</button>`;
  }).join('');
  return `<div class="meses" data-meses role="group" aria-label="Filtrar por mês da fatura">
    <button type="button" class="chip-mes seta" data-mes="${proximo ?? ''}" ${proximo ? '' : 'disabled'} aria-label="Próximo mês">‹</button>
    <div class="meses-lista">
      <button type="button" class="chip-mes ${semPeriodo ? 'ativo' : ''}" data-mes="todos" aria-pressed="${semPeriodo}">Todos</button>
      ${chips}
    </div>
    <button type="button" class="chip-mes seta" data-mes="${anterior ?? ''}" ${anterior ? '' : 'disabled'} aria-label="Mês anterior">›</button>
  </div>`;
}

let filtrosAbertos = false;

function ligarFiltros(rota) {
  const form = $app.querySelector('[data-filtros]');
  if (!form) return;
  $app.querySelector('[data-abrir-filtros]')?.addEventListener('click', (e) => {
    filtrosAbertos = !filtrosAbertos;
    form.classList.toggle('abertos', filtrosAbertos);
    e.currentTarget.setAttribute('aria-expanded', filtrosAbertos);
    e.currentTarget.querySelector('span').textContent = filtrosAbertos ? '▴' : '▾';
  });
  const meses = $app.querySelector('[data-meses]');
  meses?.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    const ref = b.dataset.mes;
    if (!ref) return;
    const atuais = Object.fromEntries(new FormData(form));
    irPara(rota, ref === 'todos' ? { ...atuais, de: '', ate: '' } : { ...atuais, de: ref, ate: ref });
  }));
  meses?.querySelector('.ativo:not([data-mes="todos"])')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const aplicar = () => irPara(rota, Object.fromEntries(new FormData(form)));
  form.addEventListener('change', aplicar);
  form.addEventListener('submit', (e) => { e.preventDefault(); aplicar(); });
  form.querySelector('[data-limpar]')?.addEventListener('click', () => irPara(rota));
}

// ---------- gráficos ----------

let graficos = [];
function novoGrafico(el) {
  const g = echarts.init(el, null, { renderer: 'svg' });
  graficos.push(g);
  return g;
}
function descartarGraficos() { graficos.forEach((g) => g.dispose()); graficos = []; }
addEventListener('resize', () => graficos.forEach((g) => g.resize()));
// Celular: os gráficos mudam de layout (não só de tamanho), então redesenha ao cruzar o limite.
const telaEstreita = matchMedia('(max-width: 600px)');
telaEstreita.addEventListener('change', () => render());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

const eixoBase = () => ({
  axisLine: { lineStyle: { color: css('--border') } },
  axisTick: { show: false },
  axisLabel: { color: css('--text-2') },
  splitLine: { lineStyle: { color: css('--grid') } },
});
// Legenda numa linha só, rolável no celular: quebrada em várias linhas ela invade a área do gráfico.
const legendaBase = () => ({
  top: 0, left: 0, textStyle: { color: css('--text-2') },
  ...(telaEstreita.matches ? { type: 'scroll', right: 0, pageIconColor: css('--text-2'), pageTextStyle: { color: css('--text-3') } } : {}),
});
const tooltipBase = () => ({
  backgroundColor: css('--surface'), borderColor: css('--border'), textStyle: { color: css('--text') },
  // Fica dentro do gráfico (senão corta na borda da tela) e quebra linha se não couber.
  confine: true, extraCssText: 'max-width: 100%; white-space: normal;',
});

/**
 * Layout das barras horizontais. Na tela estreita o nome vai acima da barra (em vez de numa coluna à
 * esquerda), a barra ocupa a largura toda e o valor ao lado perde os centavos.
 */
function layoutBarras(el, nomes, rotulo) {
  const estreito = telaEstreita.matches;
  el.style.height = estreito ? `${nomes.length * 46 + 24}px` : `${Math.max(220, nomes.length * 34 + 40)}px`;
  const yAxis = { type: 'category', data: nomes, ...eixoBase() };
  if (!estreito) {
    return {
      barMaxWidth: 22, label: { show: true, position: 'right', color: css('--text-2'), formatter: (p) => rotulo(p.dataIndex, false) },
      opcoes: { grid: { left: 8, right: 140, top: 8, bottom: 8, containLabel: true }, yAxis },
    };
  }
  yAxis.axisLine = { show: false };
  yAxis.axisLabel = { inside: true, margin: 0, align: 'left', verticalAlign: 'bottom', padding: [0, 0, 9, 0], color: css('--text'), fontSize: 13 };
  return {
    barMaxWidth: 12, label: { show: true, position: 'right', color: css('--text-2'), fontSize: 12, formatter: (p) => rotulo(p.dataIndex, true) },
    opcoes: { grid: { left: 0, right: 96, top: 22, bottom: 2 }, yAxis },
  };
}
const brlCurto = (c) => brl(Math.round(c / 100) * 100).replace(/,00$/, '');

/** Barras horizontais, uma cor só: o comprimento já mostra a grandeza. */
function graficoCategorias(el, porCategoria, aoClicar) {
  const dados = [...porCategoria].reverse();
  const total = dados.reduce((s, d) => s + d.total, 0);
  const parte = (v) => (total ? `${((v / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '');
  const lay = layoutBarras(el, dados.map((d) => d.nome),
    (i, curto) => `${curto ? brlCurto(dados[i].total) : brl(dados[i].total)} · ${parte(dados[i].total)}`);
  const g = novoGrafico(el);
  g.setOption({
    ...lay.opcoes,
    tooltip: { ...tooltipBase(), trigger: 'item', formatter: (p) => `${esc(p.name)}<br><b>${brl(p.value)}</b> · ${parte(p.value)} do total · ${dados[p.dataIndex].qtd} lançamentos` },
    xAxis: { type: 'value', ...eixoBase(), axisLabel: { show: false }, splitLine: { show: false } },
    series: [{
      type: 'bar', barMaxWidth: lay.barMaxWidth, cursor: 'pointer',
      data: dados.map((d) => ({
        value: d.total,
        itemStyle: { color: d.id == null ? css('--series-4') : css('--series-1'), borderRadius: [0, 4, 4, 0] },
      })),
      label: lay.label,
    }],
  });
  g.on('click', (p) => aoClicar(dados[p.dataIndex]));
}

/**
 * Uma barra por grupo, empilhada pelas categorias que o compõem (cada pedaço na cor da categoria).
 * Categoria sem grupo vira uma barra sozinha.
 */
function graficoGrupos(el, porCategoria, aoClicar) {
  const mapa = new Map();
  for (const c of porCategoria) {
    const chave = c.grupoId != null ? `g:${c.grupoId}` : `c:${c.id ?? 'sem'}`;
    if (!mapa.has(chave)) mapa.set(chave, { nome: c.grupo ?? c.nome, total: 0, itens: [] });
    const g = mapa.get(chave);
    g.total += c.total;
    g.itens.push(c);
  }
  const grupos = [...mapa.values()].sort((a, b) => a.total - b.total); // menor embaixo no eixo invertido
  grupos.forEach((g) => g.itens.sort((a, b) => b.total - a.total));
  const total = grupos.reduce((s, g) => s + g.total, 0);
  const pctDe = (v, de) => (de ? `${((v / de) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '');
  const cor = (c) => (c.id == null ? css('--series-4') : c.cor || css('--series-1'));

  // Série i = i-ésimo pedaço de cada barra (maior primeiro), assim o empilhamento segue a ordem de tamanho.
  const lay = layoutBarras(el, grupos.map((x) => x.nome),
    (i, curto) => `${curto ? brlCurto(grupos[i].total) : brl(grupos[i].total)} · ${pctDe(grupos[i].total, total)}`);
  const camadas = Math.max(0, ...grupos.map((g) => g.itens.length));
  const series = Array.from({ length: camadas }, (_, i) => ({
    type: 'bar', stack: 'grupo', barMaxWidth: lay.barMaxWidth, cursor: 'pointer',
    data: grupos.map((g) => {
      const c = g.itens[i];
      if (!c) return null;
      const ultimo = i === g.itens.length - 1;
      return {
        value: c.total, categoria: c, grupo: g,
        itemStyle: { color: cor(c), borderColor: css('--surface'), borderWidth: g.itens.length > 1 ? 1 : 0,
          borderRadius: ultimo ? [0, 4, 4, 0] : 0 },
      };
    }),
  }));
  // Pedaço vazio no fim da pilha só para o rótulo com o total do grupo.
  series.push({
    type: 'bar', stack: 'grupo', silent: true, itemStyle: { color: 'transparent' }, tooltip: { show: false },
    data: grupos.map(() => 0),
    label: lay.label,
  });

  const g = novoGrafico(el);
  g.setOption({
    ...lay.opcoes,
    tooltip: {
      ...tooltipBase(), trigger: 'item',
      formatter: (p) => {
        const { categoria: c, grupo } = p.data;
        const dentro = grupo.itens.length > 1 ? ` · ${pctDe(c.total, grupo.total)} de ${esc(grupo.nome)}` : '';
        return `${p.marker}${esc(c.nome)}<br><b>${brl(c.total)}</b>${dentro} · ${pctDe(c.total, total)} do total · ${c.qtd} lançamentos`;
      },
    },
    xAxis: { type: 'value', ...eixoBase(), axisLabel: { show: false }, splitLine: { show: false } },
    series,
  });
  g.on('click', (p) => p.data?.categoria && aoClicar(p.data.categoria));
}

/** Barras empilhadas por banco, um mês por coluna. A cor do banco é fixa (ordem alfabética). */
function graficoMeses(el, porMesBanco) {
  const refs = [...new Set(porMesBanco.map((r) => r.referencia))].sort();
  const bancos = opcoes.bancos.filter((b) => porMesBanco.some((r) => r.banco === b));
  const g = novoGrafico(el);
  g.setOption({
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { ...legendaBase(), icon: 'roundRect', show: bancos.length > 1 },
    tooltip: {
      ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const total = ps.reduce((s, p) => s + (p.value ?? 0), 0);
        return `<b>${esc(ps[0].name)}</b><br>${ps.filter((p) => p.value).map((p) => `${p.marker}${esc(p.seriesName)}: ${brl(p.value)}`).join('<br>')}<br>Total: <b>${brl(total)}</b>`;
      },
    },
    xAxis: { type: 'category', data: refs.map(mes), ...eixoBase() },
    yAxis: { type: 'value', ...eixoBase(), axisLabel: { color: css('--text-2'), formatter: (v) => brl(v).replace(/,00$/, '') } },
    series: bancos.map((b, i) => ({
      name: nomeBanco(b), type: 'bar', stack: 'total', barMaxWidth: 48,
      itemStyle: {
        color: corBanco(b),
        borderColor: css('--surface'), borderWidth: 1,
        borderRadius: i === bancos.length - 1 ? [4, 4, 0, 0] : 0,
      },
      data: refs.map((ref) => porMesBanco.find((r) => r.referencia === ref && r.banco === b)?.total ?? null),
    })),
  });
}

// ---------- componentes ----------

const STATUS = {
  ok: { icone: '✓', rotulo: 'dentro do limite', classe: 'st-ok' },
  atencao: { icone: '!', rotulo: 'acima de 80%', classe: 'st-atencao' },
  estourado: { icone: '✕', rotulo: 'limite estourado', classe: 'st-estourado' },
};
const seloStatus = (s) => STATUS[s] ? `<span class="status ${STATUS[s].classe}"><b aria-hidden="true">${STATUS[s].icone}</b> ${STATUS[s].rotulo}</span>` : '';

function barraProgresso(item) {
  const largura = Math.min(item.pct ?? 0, 1) * 100;
  return `<div class="progresso" role="img" aria-label="${pct(item.pct)} do limite">
    <div class="progresso-fill ${STATUS[item.status]?.classe ?? ''}" style="width:${largura}%"></div></div>`;
}

function variacao(item) {
  if (item.pct == null) return item.media == null ? '<span class="muted">sem histórico</span>' : '<span class="muted">novo</span>';
  const sobe = item.diferenca > 0;
  return `<span class="${sobe ? 'var-sobe' : 'var-desce'}">${sobe ? '▲' : '▼'} ${pct(Math.abs(item.pct))}</span>
    <span class="muted">(${sobe ? '+' : '−'}${brl(Math.abs(item.diferenca))})</span>`;
}

function tabelaSimples(linhas) {
  if (!linhas.length) return '<p class="muted">Nada no período.</p>';
  return `<div class="tabela-wrap"><table class="cartoes">
    <thead><tr><th>Data</th><th>Banco</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
    <tbody>${linhas.map((t) => `<tr>
      <td class="c-meio">${dataBR(t.data)}</td><td class="c-meio">${nomeBanco(t.banco)}</td>
      <td class="c-titulo">${esc(t.descricao)}${t.parcela_total ? ` <span class="muted">${t.parcela_atual}/${t.parcela_total}</span>` : ''}</td>
      <td class="c-meio">${t.categoria ? esc(t.categoria) : '<span class="selo sem">sem categoria</span>'}</td>
      <td class="num c-valor">${brl(t.valor_centavos)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- visão geral ----------

async function telaVisaoGeral({ filtros }) {
  const [r, parcelas, orc, comp, bal] = await Promise.all([
    api(`/api/resumo?${qs(filtros)}`),
    api(`/api/parcelas?${qs({ banco: filtros.banco, cartao: filtros.cartao })}`),
    api(`/api/orcamento?${qs({ referencia: filtros.ate })}`),
    api(`/api/comparacao?${qs(filtros)}`),
    api(`/api/balanco?${qs({ de: filtros.de, ate: filtros.ate })}`),
  ]);
  if (!r.qtd && !Object.keys(filtros).length) {
    $app.innerHTML = `<h1>Visão geral</h1><p class="sub">Nenhuma fatura importada ainda. <a href="#/importar">Importe uma fatura (CSV, PDF ou OFX)</a>.</p>`;
    return;
  }
  const alertasOrc = orc.itens.filter((i) => i.status === 'atencao' || i.status === 'estourado');
  const temLimite = orc.itens.some((i) => i.limite);
  $app.innerHTML = `
    <h1>Visão geral</h1>
    <p class="sub">Gastos de cartão por mês da fatura e <a href="#/transacoes">contas lançadas</a> pelo mês do vencimento.
      ${r.desconsiderados.qtd ? `<a href="#/desconsiderados?${qs({ de: filtros.de, ate: filtros.ate, banco: filtros.banco })}">${r.desconsiderados.qtd} lançamentos desconsiderados</a> (pagamentos de fatura e itens marcados) não entram nos totais.` : ''}</p>
    ${barraFiltros(filtros)}
    <div class="cards">
      <div class="card"><div class="rot">Gasto no período</div><div class="val">${brl(r.total)}</div>
        <span class="muted">${r.qtd} lançamentos</span></div>
      <div class="card"><div class="rot">Em parcelas no período</div><div class="val">${brl(r.totalParcelado)}</div></div>
      <a class="card link-card" href="#/parcelas"><div class="rot">Já comprometido${parcelas.proximoMes ? ` em ${mes(parcelas.proximoMes.referencia)}` : ''}</div>
        <div class="val">${brl(parcelas.proximoMes?.total ?? 0)}</div>
        <span class="muted">${brl(parcelas.totalRestante)} em parcelas futuras</span></a>
      <div class="card ${r.pendentes ? 'alerta' : ''}"><div class="rot">Sem categoria</div>
        <div class="val">${r.pendentes}</div>
        ${r.pendentes ? `<a href="#/transacoes?${qs({ ...filtros, categoria: 'sem' })}">${brl(r.totalPendentes)} · classificar</a>` : '<span class="muted">tudo classificado</span>'}
      </div>
    </div>
    ${cardBalanco(bal, filtros)}
    <div class="grade">
      <section class="painel"><div class="titulo-acoes"><h2>Gasto por ${visaoCategorias() === 'grupo' ? 'grupo' : 'categoria'}</h2>
          <div class="seg" role="group" aria-label="Agrupar gasto">
            <button data-visao="grupo" aria-pressed="${visaoCategorias() === 'grupo'}">Grupo</button>
            <button data-visao="categoria" aria-pressed="${visaoCategorias() === 'categoria'}">Categoria</button></div></div>
        <div class="grafico" id="g-cat"></div>
        <p class="muted">Clique numa barra para ver a categoria.${opcoes.grupos.length ? '' : ' <a href="#/categorias">Agrupe categorias</a> para somá-las numa barra só.'}</p></section>
      <section class="painel"><h2>Gasto por mês</h2><div class="grafico" id="g-mes"></div></section>
    </div>
    <div class="grade">
      <section class="painel"><h2>Orçamento · ${orc.referencia ? mes(orc.referencia) : '—'}</h2>
        ${!temLimite ? '<p class="muted">Nenhum limite definido. <a href="#/orcamento">Definir limites por categoria</a>.</p>'
          : alertasOrc.length ? `<ul class="lista">${alertasOrc.map((i) => `<li>
              <div class="lista-linha"><b>${esc(i.nome)}</b>${seloStatus(i.status)}</div>
              ${barraProgresso(i)}
              <span class="muted">${brl(i.gasto)} de ${brl(i.limite)} (${pct(i.pct)})</span></li>`).join('')}</ul>
              <a href="#/orcamento">Ver orçamento completo</a>`
          : `<p>${seloStatus('ok')} Todas as categorias com limite estão abaixo de 80%.</p><a href="#/orcamento">Ver orçamento</a>`}
      </section>
      <section class="painel"><h2>Comparação com a média · ${comp.referencia ? mes(comp.referencia) : '—'}</h2>
        ${comp.mesesBase.length
          ? `<p class="muted">Média de ${comp.mesesBase.map(mes).join(', ')}.</p>
            <div class="tabela-wrap"><table class="cartoes"><thead><tr><th>Categoria</th><th class="num">Este mês</th><th class="num">Média</th><th>Variação</th></tr></thead>
            <tbody>${comp.itens.slice(0, 8).map((i) => `<tr><td class="c-titulo">${esc(i.nome)}</td><td class="num c-valor">${brl(i.atual)}</td>
              <td class="num c-meio" data-rot="média">${i.media == null ? '—' : brl(i.media)}</td><td class="c-meio">${variacao(i)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Importe faturas de meses anteriores para comparar com a média dos últimos 3 meses.</p>'}
      </section>
    </div>
    <section class="painel"><h2>Maiores lançamentos</h2>${tabelaSimples(r.maiores)}</section>`;
  ligarFiltros('');
  const elCat = document.getElementById('g-cat');
  const desenharCategorias = () => (visaoCategorias() === 'grupo' ? graficoGrupos : graficoCategorias)(elCat, r.porCategoria,
    (d) => irPara(`categoria/${d.id ?? 'sem'}`, filtros));
  desenharCategorias();
  $app.querySelectorAll('[data-visao]').forEach((b) => b.addEventListener('click', () => {
    visaoCategorias(b.dataset.visao);
    $app.querySelectorAll('[data-visao]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    elCat.closest('.painel').querySelector('h2').textContent = `Gasto por ${b.dataset.visao}`;
    const antigo = echarts.getInstanceByDom(elCat);
    graficos = graficos.filter((x) => x !== antigo);
    antigo?.dispose();
    desenharCategorias();
  }));
  graficoMeses(document.getElementById('g-mes'), r.porMesBanco);
}

/**
 * Renda × saídas: a barra inteira é a renda; gastos e investido a preenchem e o resto é a sobra.
 * Se as saídas passam da renda, os dois pedaços encolhem na mesma proporção e a ponta fica vermelha.
 */
function cardBalanco(b, filtros) {
  const link = `#/renda?${qs({ de: filtros.de, ate: filtros.ate })}`;
  const semRenda = b.mesesSemRenda.length
    ? `<p class="muted nota-renda">Sem renda lançada em ${b.mesesSemRenda.map(mes).join(', ')}.</p>` : '';
  if (!b.renda) {
    return `<div class="card balanco"><div class="balanco-topo"><div class="rot">Renda × gastos e investimentos</div></div>
      <p>Nenhuma renda lançada no período. <a href="${link}">Lançar renda</a></p>
      <span class="muted">Gastos ${brl(b.gastos)} · ${b.investido < 0 ? `resgate de ${brl(-b.investido)}` : `investido ${brl(b.investido)}`}</span></div>`;
  }
  const investido = Math.max(b.investido, 0);
  const saidas = b.gastos + investido;
  const escala = Math.max(b.renda, saidas);
  const larg = (v) => `${((v / escala) * 100).toFixed(2)}%`;
  const parte = (v) => pct(v / b.renda);
  const estourou = saidas > b.renda;
  return `<div class="card balanco">
    <div class="balanco-topo"><div class="rot">Renda × gastos e investimentos</div><a href="${link}">lançar renda</a></div>
    <div class="val">${brl(b.renda)} <span class="muted">de renda</span></div>
    <div class="barra-renda ${estourou ? 'estourou' : ''}" role="img"
      aria-label="Gastos ${parte(b.gastos)}, investido ${parte(investido)} da renda${estourou ? ', acima da renda' : ''}">
      <span class="seg-gasto" style="width:${larg(b.gastos)}"></span>
      ${investido ? `<span class="seg-investido" style="width:${larg(investido)}"></span>` : ''}
      ${estourou ? `<span class="excesso" style="left:${larg(b.renda)}"></span>` : ''}
    </div>
    <ul class="legenda-renda">
      <li><span class="quadro seg-gasto" aria-hidden="true"></span>Gastos <b>${brl(b.gastos)}</b> · ${parte(b.gastos)}</li>
      <li>${b.investido < 0 ? `<span class="quadro" aria-hidden="true"></span>Resgate de <b>${brl(-b.investido)}</b>`
        : `<span class="quadro seg-investido" aria-hidden="true"></span>Investido <b>${brl(investido)}</b> · ${parte(investido)}`}</li>
      <li>${estourou ? `<span class="quadro excesso" aria-hidden="true"></span><b>${brl(saidas - b.renda)}</b> acima da renda`
        : `<span class="quadro seg-sobra" aria-hidden="true"></span>Sobra <b>${brl(b.renda - saidas)}</b> · ${parte(b.renda - saidas)}`}</li>
    </ul>
    ${linhaRendimento(b)}
    ${semRenda}
  </div>`;
}

/** Só informativo: quanto os investimentos renderam no período, comparado com a renda (não entra na sobra). */
function linhaRendimento(b) {
  if (b.rendimento == null) return '';
  const largura = Math.min(Math.max(b.rendimento, 0) / b.renda, 1) * 100;
  return `<div class="rendimento-renda">
    <div class="barra-renda fina" role="img" aria-label="Rendimento de ${pct(b.rendimento / b.renda)} da renda">
      <span class="seg-rendimento" style="width:${largura.toFixed(2)}%"></span></div>
    <span class="legenda-renda"><span><span class="quadro seg-rendimento" aria-hidden="true"></span>Rendimento dos investimentos
      <b>${brl(b.rendimento)}</b> · ${pct(b.rendimento / b.renda)} da renda <span class="muted">(não entra na conta acima)</span></span></span>
  </div>`;
}

/** Visão do gráfico de gasto no painel ('grupo' ou 'categoria'); lembrada só neste navegador. */
function visaoCategorias(nova) {
  if (nova) { try { localStorage.setItem('visaoCategorias', nova); } catch { /* sem armazenamento */ } return nova; }
  try { return localStorage.getItem('visaoCategorias') === 'categoria' ? 'categoria' : 'grupo'; } catch { return 'grupo'; }
}

// ---------- categoria ----------

async function telaCategoria({ param, filtros }) {
  const f = { ...filtros, categoria: param };
  const [r, lista] = await Promise.all([api(`/api/resumo?${qs(f)}`), api(`/api/transacoes?${qs(f)}`)]);
  const nome = param === 'sem' ? 'Sem categoria' : opcoes.categorias.find((c) => String(c.id) === param)?.nome ?? 'Categoria';
  $app.innerHTML = `
    <p><a href="#/?${qs(filtros)}">← Visão geral</a></p>
    <h1>${esc(nome)}</h1>
    <p class="sub">${r.qtd} lançamentos · ${brl(r.total)} no período</p>
    ${barraFiltros(filtros)}
    <section class="painel bloco"><h2>Gasto por mês</h2><div class="grafico" id="g-mes"></div></section>
    <section class="painel"><h2>Lançamentos</h2>${editorTransacoes(lista)}</section>`;
  ligarFiltros(`categoria/${param}`);
  if (r.qtd) graficoMeses(document.getElementById('g-mes'), r.porMesBanco);
  ligarEditor();
}

// ---------- médias ----------

/** Dias corridos entre o 1º dia do mês "de" e o último dia do mês "ate" (meses da fatura, "AAAA-MM"). */
function diasEntre(de, ate) {
  const inicio = Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, 1);
  const fim = Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)), 1);
  return Math.round((fim - inicio) / 864e5);
}

async function telaMedias({ filtros }) {
  const { alvo, ...resto } = filtros;
  const f = { ...resto };
  if (alvo?.startsWith('g')) f.grupo = alvo.slice(1);
  else if (alvo?.startsWith('c')) f.categoria = alvo.slice(1);
  const r = await api(`/api/resumo?${qs(f)}`);
  // Sem período escolhido, vale do primeiro ao último mês de fatura importado.
  const de = filtros.de || opcoes.referencias[0];
  const ate = filtros.ate || opcoes.referencias.at(-1);
  const valido = de && ate && de <= ate;
  const dias = valido ? diasEntre(de, ate) : 0;
  const meses = valido ? (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7)) + 1 : 0;
  const num = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const media = (divisor) => (divisor > 0 ? brl(Math.round(r.total / divisor)) : '—');
  const nome = !alvo ? 'Todos os gastos'
    : alvo === 'csem' ? 'Sem categoria'
    : alvo.startsWith('g') ? opcoes.grupos.find((g) => `g${g.id}` === alvo)?.nome
    : opcoes.categorias.find((c) => `c${c.id}` === alvo)?.nome;
  const periodo = !valido ? '' : de === ate ? mes(de) : `${mes(de)} a ${mes(ate)}`;
  $app.innerHTML = `
    <h1>Médias de gasto</h1>
    <p class="sub">Quanto se gasta, em média, num grupo ou numa categoria. O período é pelo mês da fatura e conta
      os dias corridos dos meses escolhidos.</p>
    ${barraFiltros(filtros, { alvo: true })}
    ${valido ? `<p class="sub"><b>${esc(nome ?? '—')}</b> · ${periodo} · ${brl(r.total)} em ${r.qtd} lançamentos</p>
    <div class="cards">
      <div class="card"><div class="rot">Média por dia</div><div class="val">${media(dias)}</div>
        <div class="muted">${num(dias)} dias</div></div>
      <div class="card"><div class="rot">Média por semana</div><div class="val">${media(dias / 7)}</div>
        <div class="muted">${num(dias / 7)} semanas</div></div>
      <div class="card"><div class="rot">Média por mês</div><div class="val">${media(meses)}</div>
        <div class="muted">${meses} ${meses === 1 ? 'mês' : 'meses'}</div></div>
      <div class="card"><div class="rot">Média por ano</div><div class="val">${media(meses / 12)}</div>
        <div class="muted">${meses < 12 ? 'projeção pelo ritmo do período' : `${num(meses / 12)} anos`}</div></div>
    </div>
    ${r.qtd ? `<section class="painel bloco"><h2>Gasto por mês</h2><div class="grafico" id="g-mes"></div></section>
      ${!alvo?.startsWith('c') ? `<section class="painel"><h2>Por categoria</h2><div id="g-cat"></div></section>` : ''}`
      : '<p class="muted">Nenhum gasto no período.</p>'}`
    : `<p class="muted">${opcoes.referencias.length ? 'O início do período precisa ser antes do fim.' : 'Nenhuma fatura importada ainda.'}</p>`}`;
  ligarFiltros('medias');
  if (!valido || !r.qtd) return;
  graficoMeses(document.getElementById('g-mes'), r.porMesBanco);
  const gCat = document.getElementById('g-cat');
  if (gCat) graficoCategorias(gCat, r.porCategoria, (c) => irPara('medias', { ...filtros, alvo: `c${c.id ?? 'sem'}` }));
}

// ---------- renda ----------

let rendaEditando = null; // null = formulário fechado; 'nova' ou o id em edição

async function telaRenda({ filtros }) {
  const lista = await api(`/api/renda?${qs({ de: filtros.de, ate: filtros.ate })}`);
  const editando = rendaEditando === 'nova' ? {} : lista.find((l) => l.id === rendaEditando);
  if (rendaEditando !== 'nova' && !editando) rendaEditando = null;
  const total = lista.reduce((s, l) => s + l.valor_centavos, 0);
  // Mês que o botão "repetir" preenche: o mês filtrado ou, sem filtro de um mês só, o mês atual.
  const alvo = filtros.de && filtros.de === filtros.ate ? filtros.de : new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const alvoVazio = !lista.some((l) => l.data.startsWith(alvo)) && (filtros.de === filtros.ate || !filtros.de);
  const porMes = Map.groupBy(lista, (l) => l.data.slice(0, 7));
  $app.innerHTML = `
    <h1>Renda</h1>
    <p class="sub">Salário, freelas e outras entradas. Contam no mês do recebimento e aparecem na visão geral
      comparadas com os gastos e os aportes do mesmo período.${lista.length ? ` ${lista.length} lançamentos · ${brl(total)}.` : ''}</p>
    ${barraFiltros(filtros, { bancos: false })}
    <section class="painel bloco">
      ${rendaEditando ? formRenda(editando) : `<div class="lista-linha"><button class="link" id="nova-renda">+ Nova renda</button>
        ${alvoVazio ? `<button class="link" id="repetir-renda">repetir a renda de ${mes(mesAntes(alvo))} em ${mes(alvo)}</button>` : ''}</div>`}
    </section>
    <section class="painel">${lista.length ? `<div class="tabela-wrap"><table class="cartoes">
      <thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${[...porMes].map(([ref, ls]) => `
        <tr class="mes-renda"><th colspan="2" class="c-titulo">${mes(ref)}</th><th class="num c-valor">${brl(ls.reduce((s, l) => s + l.valor_centavos, 0))}</th><th class="c-oculta"></th></tr>
        ${ls.map((l) => `<tr data-id="${l.id}"><td class="c-meio">${dataBR(l.data)}</td><td class="c-titulo">${esc(l.descricao)}</td>
          <td class="num c-valor">${brl(l.valor_centavos)}</td>
          <td class="acoes c-acao"><button class="link" data-editar>editar</button> · <button class="link perigo" data-apagar>apagar</button></td></tr>`).join('')}`).join('')}
      </tbody></table></div>` : '<p class="muted">Nenhuma renda lançada no período.</p>'}</section>`;
  ligarFiltros('renda');
  document.getElementById('nova-renda')?.addEventListener('click', () => { rendaEditando = 'nova'; render(); });
  document.getElementById('cancelar-renda')?.addEventListener('click', () => { rendaEditando = null; render(); });
  document.getElementById('repetir-renda')?.addEventListener('click', () => acao(
    () => api('/api/renda/repetir', { method: 'POST', body: { referencia: alvo } }),
    (r) => `${r.qtd} lançamento${r.qtd > 1 ? 's' : ''} copiado${r.qtd > 1 ? 's' : ''} para ${mes(alvo)}`));
  $app.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
    rendaEditando = Number(b.closest('tr').dataset.id);
    render();
  }));
  $app.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async () => {
    const l = lista.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (await confirmar('Apagar renda?', `“${l.descricao}” de ${brl(l.valor_centavos)}, recebida em ${dataBR(l.data)}.`)) {
      acao(() => api(`/api/renda/${l.id}`, { method: 'DELETE' }), 'Renda apagada');
    }
  }));
  document.getElementById('form-renda')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    let valorCentavos;
    try { valorCentavos = lerValor(d.valor); if (!(valorCentavos > 0)) throw new Error(); } catch { return aviso('Valor inválido', true); }
    const body = { descricao: d.descricao, valorCentavos, data: d.data };
    const id = editando?.id;
    acao(() => api(id ? `/api/renda/${id}` : '/api/renda', { method: id ? 'PUT' : 'POST', body }),
      id ? 'Renda salva' : 'Renda lançada').then((ok) => { if (ok) { rendaEditando = null; render(); } });
  });
}

function formRenda(l) {
  const hoje = new Date().toLocaleDateString('sv-SE');
  return `<h2>${l.id ? 'Editar renda' : 'Nova renda'}</h2>
    <form id="form-renda" class="campos">
      <label class="largo">Descrição<input name="descricao" required maxlength="120" value="${esc(l.descricao ?? '')}" placeholder="ex.: Salário, Freela"></label>
      <label>Valor (R$)<input name="valor" required data-moeda inputmode="numeric" value="${reaisCampo(l.valor_centavos)}" placeholder="ex.: 5.000,00"></label>
      <label>Recebido em<input type="date" name="data" required value="${l.data ?? hoje}"></label>
      <div class="barra-acoes largo"><button class="primario">${l.id ? 'Salvar' : 'Lançar renda'}</button>
        <button type="button" class="link" id="cancelar-renda">cancelar</button></div>
    </form>`;
}

const mesAntes = (ref) => {
  const [a, m] = ref.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

// ---------- transações ----------

let contaEditando = null; // null = formulário fechado; 'nova' ou o id da conta em edição

async function telaTransacoes({ filtros }) {
  const lista = await api(`/api/transacoes?${qs(filtros)}`);
  const total = lista.reduce((s, t) => s + t.valor_centavos, 0);
  const editando = contaEditando === 'nova' ? {} : lista.find((t) => t.id === contaEditando && t.manual);
  if (contaEditando !== 'nova' && !editando) contaEditando = null;
  $app.innerHTML = `
    <h1>Transações</h1>
    <p class="sub">${lista.length} lançamentos · ${brl(total)}. Troque a categoria, dê apelidos e etiquete direto na tabela.</p>
    ${barraFiltros(filtros, { categoria: true, etiqueta: true, busca: true })}
    <section class="painel bloco" id="contas">
      ${contaEditando ? formConta(editando) : `<div class="lista-linha"><button class="link" id="nova-conta">+ Nova conta</button>
        <span class="muted">Aluguel, luz, internet… pagos fora do cartão. Contam no mês do vencimento.</span></div>`}
    </section>
    <section class="painel">${editorTransacoes(lista)}</section>`;
  ligarFiltros('transacoes');
  ligarConta(editando);
  ligarEditor();
}

/** Formulário de conta normal (nova ou edição). Sem categoria, as regras automáticas decidem. */
function formConta(t) {
  const hoje = new Date().toLocaleDateString('sv-SE');
  return `<h2>${t.id ? 'Editar conta' : 'Nova conta'}</h2>
    <form id="form-conta" class="campos">
      <label class="largo">Descrição<input name="descricao" required maxlength="120" value="${esc(t.descricao ?? '')}" placeholder="ex.: Aluguel, Conta de luz"></label>
      <label>Valor (R$)<input name="valor" required data-moeda inputmode="numeric" value="${reaisCampo(t.valor_centavos)}" placeholder="ex.: 1.500,00"></label>
      <label>Vencimento<input type="date" name="data" required value="${t.data ?? hoje}"></label>
      <label>Categoria<select name="categoria"><option value="">automática (pelas regras)</option>
        ${opcoes.categorias.map((c) => `<option value="${c.id}" ${t.categoria_origem === 'manual' && c.id === t.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <div class="barra-acoes largo"><button class="primario">${t.id ? 'Salvar' : 'Lançar conta'}</button>
        <button type="button" class="link" id="cancelar-conta">cancelar</button></div>
    </form>`;
}

function ligarConta(editando) {
  document.getElementById('nova-conta')?.addEventListener('click', () => { contaEditando = 'nova'; render(); });
  document.getElementById('cancelar-conta')?.addEventListener('click', () => { contaEditando = null; render(); });
  document.getElementById('form-conta')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    let valorCentavos;
    try { valorCentavos = lerValor(d.valor); if (!(valorCentavos > 0)) throw new Error(); } catch { return aviso('Valor inválido', true); }
    const body = { descricao: d.descricao, valorCentavos, data: d.data, categoriaId: d.categoria ? Number(d.categoria) : null };
    const id = editando?.id;
    acao(() => api(id ? `/api/contas/${id}` : '/api/contas', { method: id ? 'PUT' : 'POST', body }),
      id ? 'Conta salva' : 'Conta lançada').then((ok) => { if (ok) { contaEditando = null; render(); } });
  });
}

/**
 * Tabela editável: categoria por linha (escolha manual nunca é sobrescrita pelas regras),
 * apelido do estabelecimento, etiquetas e ações em lote nas linhas marcadas.
 */
function editorTransacoes(lista) {
  if (!lista.length) return '<p class="muted">Nenhum lançamento encontrado.</p>';
  const opts = (atual) => `<option value="">— sem categoria —</option>` +
    opcoes.categorias.map((c) => `<option value="${c.id}" ${c.id === atual ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  return `
    <div class="barra-acoes">
      <label><input type="checkbox" id="criar-regra"> Ao trocar a categoria, criar regra para lançamentos parecidos</label>
    </div>
    <div class="lote" id="lote" hidden>
      <b id="lote-qtd"></b>
      <select id="lote-categoria" aria-label="Categoria para as selecionadas"><option value="">categoria…</option>
        <option value="auto">↺ voltar ao automático</option>
        ${opcoes.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
      <button id="lote-aplicar-cat">Aplicar</button>
      <input id="lote-etiqueta" list="lista-etiquetas" placeholder="etiqueta, ex.: viagem" maxlength="40">
      <button id="lote-aplicar-etq">Etiquetar</button>
      <button id="lote-desconsiderar" title="Tirar dos relatórios e totais">⊘ Desconsiderar</button>
      <button class="link" id="lote-limpar">limpar</button>
    </div>
    <datalist id="lista-etiquetas">${opcoes.etiquetas.map((e) => `<option value="${esc(e.nome)}">`).join('')}</datalist>
    <div class="tabela-wrap"><table class="tabela-transacoes">
      <thead><tr><th><input type="checkbox" id="sel-todas" aria-label="Selecionar todas"></th>
        <th>Data</th><th>Banco</th><th>Descrição</th><th class="num">Valor</th><th>Categoria</th><th>Origem</th></tr></thead>
      <tbody>${lista.map((t) => `<tr data-id="${t.id}" data-chave="${esc(t.chave)}" data-nome="${esc(t.apelido ?? t.descricao)}" class="${t.categoria_id ? '' : 'pendente'}">
        <td class="t-sel"><input type="checkbox" data-sel aria-label="Selecionar"></td>
        <td class="t-data">${dataBR(t.data)}<div class="muted">${t.manual ? 'vencimento' : t.banco === 'pix' ? 'saída da conta' : `fatura ${mes(t.referencia)}`}</div></td>
        <td class="t-banco">${nomeBanco(t.banco)}${t.cartao_final ? `<div class="muted">${esc(nomeCartao(t.banco, t.cartao_final))}</div>` : ''}</td>
        <td class="desc t-desc">
          <b>${esc(t.apelido ?? t.descricao)}</b>${t.parcela_total ? ` <span class="muted">parcela ${t.parcela_atual}/${t.parcela_total}</span>` : ''}
          ${t.categoria_id ? '' : linkBusca(t.descricao)}
          ${t.apelido || t.descricao !== t.descricao_original ? `<div class="muted" title="Texto exatamente como veio do banco">${t.apelido ? `${esc(t.descricao)} · ` : ''}original: ${esc(t.descricao_original)}</div>` : ''}
          <div class="chips">${t.etiquetas.map((e) => `<span class="chip">${esc(e.nome)}<button data-tirar="${e.id}" aria-label="Remover etiqueta ${esc(e.nome)}">×</button></span>`).join('')}
            <button class="link" data-etiquetar>+ etiqueta</button>
            <button class="link" data-apelido title="Dar um apelido a este estabelecimento (vale para todas as faturas)">✎ apelido</button></div>
        </td>
        <td class="num t-valor">${brl(t.valor_centavos)}</td>
        <td class="t-cat"><select aria-label="Categoria" data-categoria>${opts(t.categoria_id)}</select></td>
        <td class="t-origem">${seloOrigem(t)}
          <div><button class="link perigo" data-desconsiderar title="Tirar este lançamento dos relatórios e totais">⊘ desconsiderar</button></div>
          ${t.manual ? `<div><button class="link" data-editar-conta>✎ editar</button>
            <button class="link perigo" data-apagar-conta>apagar</button></div>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

/**
 * Link para pesquisar o estabelecimento no Google (nova guia), para ajudar a identificar
 * lançamentos sem categoria. Tira o prefixo do intermediador ("EBN *", "MP *") e o código de loja.
 */
function linkBusca(descricao) {
  const termo = descricao.replace(/^[A-Za-z]{2,6}\s*\*\s*/, '').replace(/\s+\d+$/, '').trim() || descricao;
  return `<a class="busca-web" href="https://www.google.com/search?q=${encodeURIComponent(termo)}" target="_blank"
    rel="noopener noreferrer" title="Pesquisar “${esc(termo)}” no Google (abre em nova guia)">🔍 pesquisar</a>`;
}

function seloOrigem(t) {
  if (t.categoria_origem === 'manual') {
    return `<span class="selo manual">manual</span> <button class="link" data-auto title="Voltar a usar as regras automáticas">↺ automático</button>`;
  }
  if (t.categoria_origem === 'regra') return `<span class="selo" title="Regra: contém “${esc(t.regra)}”">auto · ${esc(t.regra)}</span>`;
  return '<span class="selo sem">sem categoria</span>';
}

function ligarEditor() {
  $app.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('[data-categoria]').addEventListener('change', (e) => {
      const valor = e.target.value;
      const regra = document.getElementById('criar-regra')?.checked && valor !== '';
      // Escolher "sem categoria" é tratado como voltar para o automático.
      acao(() => api(`/api/transacoes/${id}`, { method: 'PATCH', body: { categoriaId: valor ? Number(valor) : null, regra } }),
        regra ? 'Categoria salva e regra criada' : 'Categoria salva');
    });
    tr.querySelector('[data-auto]')?.addEventListener('click', () =>
      acao(() => api(`/api/transacoes/${id}`, { method: 'PATCH', body: { categoriaId: null } }), 'Voltou para a categoria automática'));
    tr.querySelector('[data-apelido]').addEventListener('click', async () => {
      const novo = await perguntar('Apelido do estabelecimento', { rotulo: 'Apelido', valor: tr.dataset.nome, max: 80 },
        { texto: 'Vale para todas as faturas. Deixe vazio para remover.' });
      if (novo === null) return;
      acao(() => api('/api/apelidos', { method: 'PUT', body: { chave: tr.dataset.chave, apelido: novo } }),
        novo.trim() ? 'Apelido salvo' : 'Apelido removido');
    });
    tr.querySelector('[data-etiquetar]').addEventListener('click', async () => {
      const nome = await perguntar('Adicionar etiqueta', { rotulo: 'Etiqueta', dica: 'ex.: viagem', max: 40,
        sugestoes: opcoes.etiquetas.map((e) => e.nome) }, { botao: 'Etiquetar' });
      if (!nome?.trim()) return;
      acao(() => api('/api/etiquetas/aplicar', { method: 'POST', body: { ids: [id], nome } }), 'Etiqueta adicionada');
    });
    tr.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () =>
      acao(() => api(`/api/transacoes/${id}/etiquetas/${b.dataset.tirar}`, { method: 'DELETE' }), 'Etiqueta removida')));
    tr.querySelector('[data-desconsiderar]').addEventListener('click', () => desconsiderar([id]));
    tr.querySelector('[data-editar-conta]')?.addEventListener('click', () => {
      contaEditando = id;
      render().then(() => document.getElementById('contas')?.scrollIntoView({ block: 'start' }));
    });
    tr.querySelector('[data-apagar-conta]')?.addEventListener('click', async () => {
      if (await confirmar('Apagar conta?', `“${tr.dataset.nome}” sai do painel.`)) acao(() => api(`/api/contas/${id}`, { method: 'DELETE' }), 'Conta apagada');
    });
  });

  // Seleção e ações em lote
  const lote = document.getElementById('lote');
  if (!lote) return;
  const caixas = [...$app.querySelectorAll('[data-sel]')];
  const selecionadas = () => caixas.filter((c) => c.checked).map((c) => Number(c.closest('tr').dataset.id));
  const atualizar = () => {
    const n = selecionadas().length;
    lote.hidden = n === 0;
    document.getElementById('lote-qtd').textContent = `${n} selecionada${n > 1 ? 's' : ''}`;
  };
  caixas.forEach((c) => c.addEventListener('change', atualizar));
  document.getElementById('sel-todas').addEventListener('change', (e) => { caixas.forEach((c) => { c.checked = e.target.checked; }); atualizar(); });
  document.getElementById('lote-limpar').addEventListener('click', () => { caixas.forEach((c) => { c.checked = false; }); document.getElementById('sel-todas').checked = false; atualizar(); });
  document.getElementById('lote-aplicar-cat').addEventListener('click', () => {
    const v = document.getElementById('lote-categoria').value;
    if (!v) return aviso('Escolha a categoria', true);
    const ids = selecionadas();
    acao(() => api('/api/transacoes/categoria', { method: 'POST', body: { ids, categoriaId: v === 'auto' ? null : Number(v) } }),
      `Categoria aplicada em ${ids.length} lançamentos`);
  });
  document.getElementById('lote-desconsiderar').addEventListener('click', () => desconsiderar(selecionadas()));
  document.getElementById('lote-aplicar-etq').addEventListener('click', () => {
    const nome = document.getElementById('lote-etiqueta').value;
    if (!nome.trim()) return aviso('Digite a etiqueta', true);
    acao(() => api('/api/etiquetas/aplicar', { method: 'POST', body: { ids: selecionadas(), nome } }),
      (r) => `Etiqueta aplicada em ${r.adicionadas} lançamentos`);
  });
}

/** Pede o motivo (opcional) e desconsidera os lançamentos. */
async function desconsiderar(ids) {
  const plural = ids.length > 1 ? 's' : '';
  const motivo = await perguntar(`Desconsiderar ${ids.length} lançamento${plural}?`, { rotulo: 'Motivo (opcional)', dica: 'ex.: reembolsado' },
    { texto: `Sai${ids.length > 1 ? 'em' : ''} de relatórios, totais e análises e fica${ids.length > 1 ? 'm' : ''} na tela “Desconsiderados”.`, botao: 'Desconsiderar' });
  if (motivo === null) return;
  acao(() => api('/api/desconsiderar', { method: 'POST', body: { ids, motivo } }),
    `${ids.length} lançamento${ids.length > 1 ? 's' : ''} desconsiderado${ids.length > 1 ? 's' : ''}`);
}

// ---------- desconsiderados ----------

async function telaDesconsiderados({ filtros }) {
  const [lista, regras] = await Promise.all([
    api(`/api/desconsiderados?${qs(filtros)}`), api('/api/regras-desconsiderar'),
  ]);
  const pagamentos = lista.filter((t) => t.tipo === 'pagamento');
  const outros = lista.filter((t) => t.tipo !== 'pagamento');
  const soma = (l) => l.reduce((s, t) => s + t.valor_centavos, 0);
  const origemSel = `<label>Decisão<select name="origem">
      <option value="">Todas</option>
      <option value="auto" ${filtros.origem === 'auto' ? 'selected' : ''}>Automática</option>
      <option value="manual" ${filtros.origem === 'manual' ? 'selected' : ''}>Manual</option></select></label>`;
  $app.innerHTML = `
    <h1>Desconsiderados</h1>
    <p class="sub">Lançamentos que não entram em relatórios, totais, orçamento, parcelas nem assinaturas.
      Pagamentos de fatura (inclusive por Pix) entram aqui automaticamente.</p>
    ${barraFiltros(filtros).replace('</form>', `${origemSel}</form>`)}
    <div class="cards">
      <div class="card"><div class="rot">Desconsiderados</div><div class="val">${lista.length}</div>
        <span class="muted">${brl(soma(lista))}</span></div>
      <div class="card"><div class="rot">Pagamentos de fatura</div><div class="val">${pagamentos.length}</div>
        <span class="muted">${brl(soma(pagamentos))}</span></div>
      <div class="card"><div class="rot">Outros itens</div><div class="val">${outros.length}</div>
        <span class="muted">${brl(soma(outros))}</span></div>
    </div>
    <section class="painel bloco">
      <div class="lote" id="lote-d" hidden><b id="lote-d-qtd"></b>
        <button id="lote-d-considerar">Voltar a considerar</button>
        <button class="link" id="lote-d-limpar">limpar seleção</button></div>
      ${lista.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th><input type="checkbox" id="sel-todas-d" aria-label="Selecionar todos"></th>
          <th>Data</th><th>Banco</th><th>Descrição</th><th class="num">Valor</th><th>Motivo</th><th>Decisão</th><th></th></tr></thead>
        <tbody>${lista.map((t) => `<tr data-id="${t.id}">
          <td class="c-sel"><input type="checkbox" data-sel-d aria-label="Selecionar"></td>
          <td class="c-meio">${dataBR(t.data)}<div class="muted">${t.manual ? 'vencimento' : t.banco === 'pix' ? 'saída da conta' : `fatura ${mes(t.referencia)}`}</div></td>
          <td class="c-meio">${nomeBanco(t.banco)}${t.cartao_final ? `<div class="muted">${esc(nomeCartao(t.banco, t.cartao_final))}</div>` : ''}</td>
          <td class="c-titulo"><b>${esc(t.apelido ?? t.descricao)}</b>${t.parcela_total ? ` <span class="muted">parcela ${t.parcela_atual}/${t.parcela_total}</span>` : ''}
            <div class="muted">original: ${esc(t.descricao_original)}${t.categoria ? ` · ${esc(t.categoria)}` : ''}</div></td>
          <td class="num c-valor">${brl(t.valor_centavos)}</td>
          <td class="${t.motivo ? '' : 'c-oculta'}" data-rot="Motivo:">${t.motivo ? esc(t.motivo) : '<span class="muted">—</span>'}</td>
          <td class="c-meio">${t.origem === 'manual' ? '<span class="selo manual">manual</span>' : '<span class="selo">automática</span>'}</td>
          <td class="acoes c-fim">${t.origem === 'manual'
            ? '<button class="link" data-auto-d title="Desfazer sua decisão; o item volta a seguir o automático">↺ automático</button> '
            : ''}<button class="link" data-considerar>voltar a considerar</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum lançamento desconsiderado no período.</p>'}
    </section>
    <section class="painel"><h2>Regras para desconsiderar automaticamente</h2>
      <p class="muted">Lançamentos cuja descrição contém o texto são desconsiderados na importação (e os já importados, na hora).
        Marque “só créditos” para pegar apenas valores negativos, como “PGTO PIX”, sem pegar compras via Pix no crédito.</p>
      <form class="inline" id="form-regra-d">
        <input name="padrao" required minlength="2" placeholder="texto, ex.: PIX">
        <select name="banco"><option value="">todos os bancos</option>${opcoes.bancos.map((b) => `<option value="${b}">${nomeBanco(b)}</option>`).join('')}</select>
        <label><input type="checkbox" name="soCreditos" checked> só créditos</label>
        <label><input type="checkbox" name="regex"> regex</label>
        <input name="motivo" placeholder="motivo (opcional)" maxlength="120">
        <button class="primario">Salvar regra</button>
      </form>
      ${regras.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Contém</th><th>Banco</th><th>Valores</th><th>Motivo</th><th class="num">Em uso</th><th></th></tr></thead>
        <tbody>${regras.map((x) => `<tr><td class="c-titulo"><code>${esc(x.padrao)}</code>${x.tipo_match === 'regex' ? ' <span class="selo">regex</span>' : ''}</td>
          <td class="c-meio">${x.banco ? nomeBanco(x.banco) : 'todos'}</td><td class="c-meio">${x.so_creditos ? 'só créditos' : 'todos'}</td>
          <td class="${x.motivo ? '' : 'c-oculta'}" data-rot="Motivo:">${x.motivo ? esc(x.motivo) : '<span class="muted">—</span>'}</td><td class="num c-valor" data-rot="em uso">${x.usos}</td>
          <td class="c-acao"><button class="link" data-remover-rd="${x.id}">remover</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma regra.</p>'}
    </section>`;

  ligarFiltros('desconsiderados');
  const considerar = (ids) => acao(() => api('/api/considerar', { method: 'POST', body: { ids } }),
    `${ids.length} lançamento${ids.length > 1 ? 's' : ''} de volta aos relatórios`);
  $app.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('[data-considerar]').addEventListener('click', () => considerar([id]));
    tr.querySelector('[data-auto-d]')?.addEventListener('click', () =>
      acao(() => api('/api/desconsiderar/automatico', { method: 'POST', body: { ids: [id] } }), 'Voltou para o automático'));
  });
  const caixas = [...$app.querySelectorAll('[data-sel-d]')];
  const selecionadas = () => caixas.filter((c) => c.checked).map((c) => Number(c.closest('tr').dataset.id));
  const lote = document.getElementById('lote-d');
  const atualizar = () => {
    const n = selecionadas().length;
    lote.hidden = n === 0;
    document.getElementById('lote-d-qtd').textContent = `${n} selecionado${n > 1 ? 's' : ''}`;
  };
  caixas.forEach((c) => c.addEventListener('change', atualizar));
  document.getElementById('sel-todas-d')?.addEventListener('change', (e) => { caixas.forEach((c) => { c.checked = e.target.checked; }); atualizar(); });
  document.getElementById('lote-d-limpar').addEventListener('click', () => { caixas.forEach((c) => { c.checked = false; }); atualizar(); });
  document.getElementById('lote-d-considerar').addEventListener('click', () => considerar(selecionadas()));

  document.getElementById('form-regra-d').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/regras-desconsiderar', { method: 'POST', body: {
      padrao: d.padrao, banco: d.banco || null, soCreditos: !!d.soCreditos, regex: !!d.regex, motivo: d.motivo || null,
    } }), (x) => `Regra salva · ${x.desconsideradas} lançamentos desconsiderados automaticamente no total (incluindo pagamentos)`);
  });
  $app.querySelectorAll('[data-remover-rd]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Remover regra?', 'Os lançamentos desconsiderados por ela voltam aos relatórios.', { botao: 'Remover' })) {
      acao(() => api(`/api/regras-desconsiderar/${b.dataset.removerRd}`, { method: 'DELETE' }), 'Regra removida');
    }
  }));
}

// ---------- parcelas futuras ----------

async function telaParcelas({ filtros }) {
  const p = await api(`/api/parcelas?${qs(filtros)}`);
  const ultimo = p.meses.at(-1);
  $app.innerHTML = `
    <h1>Parcelas futuras</h1>
    <p class="sub">Quanto das próximas faturas já está comprometido com compras parceladas, a partir da última fatura importada de cada banco.</p>
    ${barraFiltros(filtros, { periodo: false })}
    <div class="cards">
      <div class="card"><div class="rot">Total a pagar em parcelas</div><div class="val">${brl(p.totalRestante)}</div></div>
      <div class="card"><div class="rot">Próxima fatura${p.proximoMes ? ` (${mes(p.proximoMes.referencia)})` : ''}</div><div class="val">${brl(p.proximoMes?.total ?? 0)}</div></div>
      <div class="card"><div class="rot">Parcelamentos ativos</div><div class="val">${p.parcelamentos.reduce((s, x) => s + x.qtd, 0)}</div></div>
      <div class="card"><div class="rot">Livre de parcelas a partir de</div><div class="val">${ultimo ? mes(somarMeses(ultimo.referencia, 1)) : '—'}</div></div>
    </div>
    ${p.meses.length ? `<section class="painel bloco"><h2>Comprometido por mês</h2><div class="grafico" id="g-parc"></div></section>` : ''}
    <section class="painel"><h2>Parcelamentos em andamento</h2>
      ${p.parcelamentos.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Compra</th><th>Banco</th><th>Categoria</th><th class="num">Parcela</th><th>Andamento</th><th class="num">Valor/mês</th><th class="num">Falta pagar</th><th>Última parcela</th></tr></thead>
        <tbody>${p.parcelamentos.map((x) => `<tr>
          <td class="c-titulo">${esc(x.nome)}${x.qtd > 1 ? ` <span class="selo">×${x.qtd}</span>` : ''}</td>
          <td class="c-meio">${nomeBanco(x.banco)}${x.cartao ? ` <span class="muted">•${x.cartao}</span>` : ''}</td>
          <td class="c-meio">${x.categoria ? esc(x.categoria) : '<span class="muted">—</span>'}</td>
          <td class="num c-meio" data-rot="parcela">${x.parcelaAtual}/${x.parcelaTotal}</td>
          <td class="c-fim"><div class="progresso" role="img" aria-label="${x.parcelaAtual} de ${x.parcelaTotal} pagas"><div class="progresso-fill" style="width:${(x.parcelaAtual / x.parcelaTotal) * 100}%"></div></div></td>
          <td class="num c-valor">${brl(x.valorParcela * x.qtd)}<span class="so-cartao muted">/mês</span></td>
          <td class="num c-fim muted" data-rot="Falta pagar">${brl(x.restanteCentavos)}</td>
          <td class="c-meio" data-rot="até">${mes(x.terminaEm)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma parcela em aberto.</p>'}
    </section>`;
  ligarFiltros('parcelas');
  if (p.meses.length) {
    graficoMeses(document.getElementById('g-parc'),
      p.meses.flatMap((m) => Object.entries(m.porBanco).map(([banco, total]) => ({ referencia: m.referencia, banco, total }))));
  }
}

function somarMeses(ref, n) {
  const d = new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- assinaturas ----------

async function telaAssinaturas() {
  const a = await api('/api/assinaturas');
  const alertas = a.ativas.flatMap((s) => s.alertas.map((x) => ({ ...x, s })));
  const textoAlerta = (x) => x.tipo === 'nova' ? `<b>${esc(x.s.nome)}</b> é uma cobrança nova (primeira vez em ${mes(x.s.ultimaCobranca)}).`
    : x.tipo === 'preco' ? `<b>${esc(x.s.nome)}</b> mudou de preço: ${brl(x.de)} → ${brl(x.para)}.`
    : `<b>${esc(x.s.nome)}</b> não foi cobrada na última fatura${x.s.ultimaCobranca ? ` (última em ${mes(x.s.ultimaCobranca)})` : ''}. Foi cancelada?`;
  $app.innerHTML = `
    <h1>Assinaturas</h1>
    <p class="sub">Cobranças recorrentes. Confirme as sugestões para acompanhar preço e cobranças novas.</p>
    <div class="cards">
      <div class="card"><div class="rot">Custo mensal</div><div class="val">${brl(a.custoMensal)}</div></div>
      <div class="card"><div class="rot">Custo anual estimado</div><div class="val">${brl(a.custoAnual)}</div></div>
      <div class="card"><div class="rot">Assinaturas ativas</div><div class="val">${a.ativas.length}</div></div>
    </div>
    ${alertas.length ? `<section class="painel bloco alerta"><h2>Avisos</h2><ul class="lista">${alertas.map((x) => `<li>${textoAlerta(x)}</li>`).join('')}</ul></section>` : ''}
    <section class="painel bloco"><h2>Suas assinaturas</h2>
      ${a.ativas.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Nome</th><th>Banco</th><th class="num">Valor/mês</th><th>Desde</th><th>Última cobrança</th><th></th></tr></thead>
        <tbody>${a.ativas.map((s) => `<tr data-id="${s.id}" data-banco="${esc(s.banco)}" data-chave="${esc(s.chave)}" data-nome="${esc(s.nome)}">
          <td class="c-titulo"><b>${esc(s.nome)}</b> <button class="link" data-renomear>✎</button><div class="muted">${esc(s.chave)}</div></td>
          <td class="c-meio">${nomeBanco(s.banco)}</td><td class="num c-valor">${brl(s.valorMensal)}</td>
          <td class="c-meio" data-rot="Desde">${s.primeiraCobranca ? mes(s.primeiraCobranca) : '—'}</td><td class="c-meio" data-rot="Última">${s.ultimaCobranca ? mes(s.ultimaCobranca) : '—'}</td>
          <td class="c-acao"><button class="link" data-remover>remover</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma assinatura confirmada ainda.</p>'}
    </section>
    <section class="painel"><h2>Sugestões (${a.sugestoes.length})</h2>
      ${a.sugestoes.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Estabelecimento</th><th>Banco</th><th class="num">Último valor</th><th>Por quê</th><th></th></tr></thead>
        <tbody>${a.sugestoes.map((s) => `<tr data-banco="${esc(s.banco)}" data-chave="${esc(s.chave)}" data-nome="${esc(s.nome)}">
          <td class="c-titulo">${esc(s.nome)}</td><td class="c-meio">${nomeBanco(s.banco)}</td><td class="num c-valor">${brl(s.valor)}</td>
          <td class="muted">${esc(s.motivo)}</td>
          <td class="acoes"><button class="primario" data-confirmar>É assinatura</button> <button data-ignorar>Não é</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Sem sugestões. Coloque lançamentos na categoria “Assinaturas” ou importe mais meses para detectar cobranças recorrentes.</p>'}
    </section>`;

  const salvar = (tr, status, nome = tr.dataset.nome) =>
    api('/api/assinaturas', { method: 'POST', body: { banco: tr.dataset.banco, chave: tr.dataset.chave, nome, status } });
  $app.querySelectorAll('[data-confirmar]').forEach((b) => b.addEventListener('click', () =>
    acao(() => salvar(b.closest('tr'), 'ativa'), 'Assinatura confirmada')));
  $app.querySelectorAll('[data-ignorar]').forEach((b) => b.addEventListener('click', () =>
    acao(() => salvar(b.closest('tr'), 'ignorada'), 'Sugestão descartada')));
  $app.querySelectorAll('[data-renomear]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    const nome = await perguntar('Renomear assinatura', { rotulo: 'Nome', valor: tr.dataset.nome, max: 80 });
    if (nome?.trim()) acao(() => salvar(tr, 'ativa', nome), 'Nome salvo');
  }));
  $app.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Parar de acompanhar?', 'A assinatura pode voltar a aparecer como sugestão.', { botao: 'Remover' })) {
      acao(() => api(`/api/assinaturas/${b.closest('tr').dataset.id}`, { method: 'DELETE' }), 'Assinatura removida');
    }
  }));
}

// ---------- orçamento ----------

async function telaOrcamento({ filtros }) {
  const [orc, cats] = await Promise.all([api(`/api/orcamento?${qs({ referencia: filtros.referencia })}`), api('/api/categorias')]);
  if (!orc.referencia) { $app.innerHTML = '<h1>Orçamento</h1><p class="sub">Importe uma fatura primeiro.</p>'; return; }
  const porId = new Map(orc.itens.map((i) => [i.id, i]));
  const linhas = cats.map((c) => porId.get(c.id) ?? { id: c.id, nome: c.nome, gasto: 0, limite: null, status: 'sem-limite' })
    .sort((a, b) => (b.limite ? 1 : 0) - (a.limite ? 1 : 0) || (b.pct ?? -1) - (a.pct ?? -1) || b.gasto - a.gasto);
  const totalPct = orc.totalLimite ? orc.totalGastoComLimite / orc.totalLimite : null;
  $app.innerHTML = `
    <h1>Orçamento</h1>
    <p class="sub">Limite mensal por categoria. Você é avisado a partir de 80% do limite. Digite o valor e pressione Enter; deixe vazio para remover.</p>
    <form class="filtros" id="f-ref"><label>Mês da fatura
      <select name="referencia">${[...opcoes.referencias].reverse().map((r) => `<option value="${r}" ${r === orc.referencia ? 'selected' : ''}>${mes(r)}</option>`).join('')}</select></label></form>
    <div class="cards">
      <div class="card"><div class="rot">Gasto nas categorias com limite</div><div class="val">${brl(orc.totalGastoComLimite)}</div>
        <span class="muted">de ${brl(orc.totalLimite)}${totalPct != null ? ` (${pct(totalPct)})` : ''}</span></div>
      <div class="card"><div class="rot">Acima de 80%</div><div class="val">${orc.itens.filter((i) => i.status === 'atencao').length}</div></div>
      <div class="card"><div class="rot">Estouradas</div><div class="val">${orc.itens.filter((i) => i.status === 'estourado').length}</div></div>
    </div>
    <section class="painel"><div class="tabela-wrap"><table class="cartoes">
      <thead><tr><th>Categoria</th><th class="num">Gasto</th><th>Limite mensal</th><th>Uso</th><th>Situação</th></tr></thead>
      <tbody>${linhas.map((i) => `<tr data-cat="${i.id}">
        <td class="c-titulo"><a href="#/categoria/${i.id}?${qs({ de: orc.referencia, ate: orc.referencia })}">${esc(i.nome)}</a></td>
        <td class="num c-valor">${brl(i.gasto)}</td>
        <td class="c-meio" data-rot="Limite"><input class="limite" data-moeda inputmode="numeric" placeholder="sem limite" aria-label="Limite de ${esc(i.nome)}"
          value="${i.limite ? (i.limite / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}"></td>
        <td class="uso c-fim">${i.limite ? `${barraProgresso(i)}<span class="muted">${pct(i.pct)} · ${i.disponivel >= 0 ? `sobram ${brl(i.disponivel)}` : `passou ${brl(-i.disponivel)}`}</span>` : ''}</td>
        <td class="c-acao">${seloStatus(i.status)}</td></tr>`).join('')}</tbody></table></div></section>`;

  document.getElementById('f-ref').addEventListener('change', (e) => irPara('orcamento', { referencia: e.target.value }));
  $app.querySelectorAll('input.limite').forEach((inp) => {
    const salvar = () => {
      const original = inp.defaultValue;
      if (inp.value === original) return;
      let centavos;
      try { centavos = lerValor(inp.value); } catch (err) { aviso(err.message, true); inp.value = original; return; }
      acao(() => api(`/api/orcamento/${inp.closest('tr').dataset.cat}`, { method: 'PUT', body: { limiteCentavos: centavos } }),
        centavos ? 'Limite salvo' : 'Limite removido');
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur', salvar);
  });
}

// ---------- importar ----------

/** Fila de arquivos: o usuário junta vários CSV/PDF/OFX, revisa a lista e envia; cada arquivo tem seu status. */
const fila = [];
const FORMATOS = ['csv', 'pdf', 'ofx'];
const tamanho = (b) => (b < 1024 * 1024 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
let enviando = false;

async function telaImportar() {
  const hist = await api('/api/importacoes');
  $app.innerHTML = `
    <h1>Importar faturas</h1>
    <p class="sub">Selecione ou arraste vários arquivos de uma vez. Suportados: Nubank (CSV), Inter (PDF) e OFX da fatura do cartão de qualquer banco (Itaú, Bradesco, BB, Santander, C6...).
      O banco é reconhecido pelo conteúdo e o mesmo arquivo nunca é importado duas vezes.</p>
    <label class="drop" id="drop">
      <strong>Arraste os arquivos aqui</strong> ou clique para escolher
      <input type="file" id="arquivos" accept=".csv,.pdf,.ofx,text/csv,application/pdf" multiple hidden>
      <span class="muted">CSV, PDF ou OFX, até 20 MB cada, vários de uma vez</span>
    </label>
    <section class="painel bloco" id="fila"></section>
    <section class="painel bloco" id="extrato-pix"><h2>Pix e saídas da conta corrente</h2>
      <p class="muted">Envie o OFX do extrato da conta (internet banking → extrato → exportar OFX). Todas as saídas (Pix, boleto, débito...)
        entram como gastos da origem Pix, no mês da data, com categoria pelas regras. As entradas são ignoradas, e extratos com períodos
        sobrepostos não duplicam. O que já está no app não conta de novo: a saída com o mesmo valor de uma conta lançada (até 7 dias do vencimento)
        ou de um pagamento de fatura do cartão (até 5 dias) fica em <a href="#/desconsiderados">Desconsiderados</a>.
        Transferências entre contas suas e aplicações você tira com uma regra lá.</p>
      <input type="file" id="arquivos-pix" accept=".ofx" multiple>
      <div id="resultado-pix"></div>
    </section>
    <section class="painel bloco" id="planilha-contas"><h2>Planilha de contas normais</h2>
      <p class="muted">Planilha do ano com as colunas Ano, Mes, Dia, item, VALOR e Categoria (Google Sheets: Arquivo → Fazer download → Microsoft Excel .xlsx, ou CSV).
        Pode enviar o ano inteiro quantas vezes quiser: antes de gravar você vê o que é novo, o que mudou e o que sumiu. Linhas da categoria Cartão são puladas (as compras vêm das faturas).</p>
      <input type="file" id="arquivo-planilha" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      <div id="previa-planilha"></div>
    </section>
    <section class="painel"><h2>Histórico</h2>
      ${hist.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>#</th><th>Arquivo</th><th>Banco</th><th>Fatura</th><th class="num">Lançamentos</th><th class="num">Total impresso</th><th>Importado em</th></tr></thead>
        <tbody>${hist.map((i) => `<tr><td class="c-oculta">${i.id}</td><td class="c-titulo">${esc(i.arquivo_nome)}</td><td class="c-meio">${nomeBanco(i.banco)}</td>
          <td class="c-meio">${i.referencia ? mes(i.referencia) : '—'}</td><td class="num c-meio" data-rot="lançamentos">${i.qtd_transacoes}</td>
          <td class="num c-valor">${i.total_centavos != null ? brl(i.total_centavos) : '—'}</td>
          <td class="muted" data-rot="importado em">${esc(i.importado_em)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma importação ainda.</p>'}
    </section>`;

  const drop = document.getElementById('drop');
  const input = document.getElementById('arquivos');
  input.addEventListener('change', () => { adicionarNaFila(input.files); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); adicionarNaFila(e.dataTransfer.files); });
  desenharFila();
  document.getElementById('arquivo-planilha').addEventListener('change', (e) => {
    if (e.target.files[0]) previaPlanilha(e.target.files[0]);
  });
  desenharPlanilha();
  document.getElementById('arquivos-pix').addEventListener('change', (e) => {
    if (e.target.files.length) enviarExtratos([...e.target.files]);
  });
  desenharExtratos();
}

// ---------- extrato da conta (Pix) ----------

let extratos = []; // resultados da última leva enviada

async function enviarExtratos(arquivos) {
  extratos = arquivos.map((f) => ({ arquivo: f.name, status: 'enviando' }));
  desenharExtratos();
  for (const [i, f] of arquivos.entries()) {
    try {
      const fd = new FormData();
      fd.append('arquivo', f, f.name);
      [extratos[i]] = await api('/api/pix/importar', { method: 'POST', body: fd });
    } catch (err) {
      extratos[i] = { arquivo: f.name, status: 'erro', erro: err.message };
    }
    desenharExtratos();
  }
  await carregarOpcoes().catch(() => {});
  if (rotaAtual().rota === 'importar') await telaImportar();
}

function desenharExtratos() {
  const el = document.getElementById('resultado-pix');
  if (!el) return;
  const meses = (r) => r.meses.length === 1 ? mes(r.meses[0]) : `${mes(r.meses[0])} a ${mes(r.meses.at(-1))}`;
  el.innerHTML = extratos.length ? `<ul>${extratos.map((r) => `<li><b>${esc(r.arquivo)}</b> · ${ROTULO_STATUS[r.status]} ${
    r.status === 'erro' ? `<span class="erro">${esc(r.erro)}</span>`
    : r.status === 'repetido' ? `${nomeBanco(r.origem)} · ${meses(r)}`
    : r.status === 'importado' ? `${nomeBanco(r.origem)} · ${meses(r)} · ${r.inseridas} saídas novas` +
      `${r.duplicadas ? `, ${r.duplicadas} já importadas` : ''} (${r.classificadas} categorizadas` +
      `${r.conciliadas ? `, ${r.conciliadas} já lançadas como conta ou fatura` : ''}` +
      `${r.desconsideradas - r.conciliadas ? `, ${r.desconsideradas - r.conciliadas} desconsideradas por regra` : ''})` : ''
  }</li>`).join('')}</ul>
    <p><a href="#/transacoes?banco=pix">Ver saídas importadas</a> · <a href="#/desconsiderados?banco=pix">Ver as que não contam</a></p>` : '';
}

// ---------- planilha de contas ----------

let planilha = null; // { arquivo, previa }

async function enviarPlanilha(arquivo, extras = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extras)) fd.append(k, v);
  fd.append('arquivo', arquivo, arquivo.name); // campos antes do arquivo: o servidor lê na ordem
  return api('/api/contas/planilha', { method: 'POST', body: fd });
}

async function previaPlanilha(arquivo) {
  try {
    planilha = { arquivo, previa: await enviarPlanilha(arquivo) };
  } catch (err) {
    planilha = null;
    aviso(err.message, true);
  }
  desenharPlanilha();
}

function desenharPlanilha() {
  const el = document.getElementById('previa-planilha');
  if (!el) return;
  if (!planilha) { el.innerHTML = ''; return; }
  const p = planilha.previa;
  const nada = !p.novas.length && !p.alteradas.length && !p.sumidas.length;
  const soma = (xs) => brl(xs.reduce((s, x) => s + x.valorCentavos, 0));
  const linhaConta = (c, extra = '') => `<tr>${extra}<td class="c-meio">${dataBR(c.data)}</td><td class="c-titulo">${esc(c.descricao)}</td>
    <td class="c-meio">${c.categoria ? `${esc(c.categoria.nome ?? c.categoria)}${c.categoria.nova ? ' <span class="selo manual">nova</span>' : ''}` : '<span class="selo sem">sem categoria</span>'}</td>
    <td class="num c-valor">${brl(c.valorCentavos)}</td></tr>`;
  const cab = (extra = '') => `<thead><tr>${extra}<th>Data</th><th>Conta</th><th>Categoria</th><th class="num">Valor</th></tr></thead>`;
  el.innerHTML = `
    <p><b>${esc(planilha.arquivo.name)}</b> · ${p.meses.length ? `${mes(p.meses[0])} a ${mes(p.meses.at(-1))}` : 'nenhuma conta'} ·
      ${p.iguais} já lançadas · ${p.novas.length} novas · ${p.alteradas.length} alteradas · ${p.sumidas.length} sumiram da planilha
      <span class="muted">· puladas: ${p.ignoradas.cartao} de cartão, ${p.ignoradas.semValor} sem valor</span></p>
    ${p.erros.length ? `<p class="erro">Linhas com erro (corrija na planilha e envie de novo):</p>
      <ul class="erro">${p.erros.map((e) => `<li>linha ${e.linha}: ${esc(e.erro)}</li>`).join('')}</ul>` : ''}
    ${p.novas.length ? `<h3>Novas (${soma(p.novas)})</h3><div class="tabela-wrap"><table class="cartoes">${cab()}
      <tbody>${p.novas.map((c) => linhaConta(c)).join('')}</tbody></table></div>` : ''}
    ${p.alteradas.length ? `<h3>Alteradas</h3><div class="tabela-wrap"><table class="cartoes">
      <thead><tr><th>Conta</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>${p.alteradas.map((a) => `<tr><td class="c-titulo">${esc(a.descricao)}</td><td data-rot="antes:">${dataBR(a.de.data)} · ${brl(a.de.valorCentavos)}</td>
        <td data-rot="depois:">${dataBR(a.para.data)} · ${brl(a.para.valorCentavos)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${p.sumidas.length ? `<h3>Sumiram da planilha</h3>
      <p class="muted">Estão no app nesses meses, mas não na planilha. Marque as que devem ser apagadas; as outras ficam como estão.</p>
      <div class="tabela-wrap"><table class="cartoes">${cab('<th>Apagar</th>')}
      <tbody>${p.sumidas.map((c) => linhaConta(c, `<td class="c-sel"><input type="checkbox" data-apagar="${c.id}" aria-label="Apagar ${esc(c.descricao)} de ${dataBR(c.data)}"></td>`)).join('')}</tbody></table></div>` : ''}
    <div class="barra-acoes">${nada ? '<span>Tudo em dia: nada a gravar.</span>'
      : `<button class="primario" id="gravar-planilha" ${p.erros.length ? 'disabled' : ''}>Gravar</button>`}
      <button type="button" class="link" id="fechar-planilha">${nada ? 'fechar' : 'cancelar'}</button></div>`;
  document.getElementById('fechar-planilha').addEventListener('click', () => {
    planilha = null;
    document.getElementById('arquivo-planilha').value = '';
    desenharPlanilha();
  });
  document.getElementById('gravar-planilha')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const apagar = [...el.querySelectorAll('[data-apagar]:checked')].map((c) => c.dataset.apagar).join(',');
    const { arquivo } = planilha;
    const ok = await acao(() => enviarPlanilha(arquivo, { gravar: '1', apagar }), (r) => {
      planilha = null; // antes do redesenho que a ação faz
      const g = r.gravado;
      return `Planilha gravada: ${g.lancadas} novas, ${g.alteradas} alteradas, ${g.apagadas} apagadas`;
    });
    if (!ok) e.target.disabled = false;
  });
}

function adicionarNaFila(files) {
  for (const f of files) {
    if (fila.some((x) => x.arquivo.name === f.name && x.arquivo.size === f.size && x.status !== 'importado')) continue;
    const ext = f.name.split('.').pop().toLowerCase();
    fila.push(FORMATOS.includes(ext)
      ? { arquivo: f, status: 'aguardando' }
      : { arquivo: f, status: 'erro', detalhe: 'Formato não suportado (use CSV, PDF ou OFX)' });
  }
  desenharFila();
}

const ROTULO_STATUS = {
  aguardando: '<span class="selo">aguardando</span>',
  enviando: '<span class="selo manual">importando…</span>',
  importado: '<span class="status st-ok"><b aria-hidden="true">✓</b> importado</span>',
  repetido: '<span class="selo">já importado</span>',
  erro: '<span class="status st-estourado"><b aria-hidden="true">✕</b> erro</span>',
};

function desenharFila() {
  const el = document.getElementById('fila');
  if (!el) return;
  if (!fila.length) { el.hidden = true; return; }
  el.hidden = false;
  const pendentes = fila.filter((x) => x.status === 'aguardando').length;
  const feitos = fila.filter((x) => ['importado', 'repetido', 'erro'].includes(x.status));
  const novos = fila.filter((x) => x.status === 'importado').reduce((s, x) => s + x.resultado.inseridas, 0);
  el.innerHTML = `
    <div class="lista-linha"><h2>Arquivos (${fila.length})</h2>
      <span><button class="primario" id="enviar" ${!pendentes || enviando ? 'disabled' : ''}>${enviando ? 'Importando…' : pendentes ? `Importar ${pendentes} arquivo${pendentes === 1 ? '' : 's'}` : 'Nada para importar'}</button>
      <button class="link" id="limpar-fila" ${enviando ? 'disabled' : ''}>limpar lista</button></span></div>
    <div class="tabela-wrap"><table class="cartoes">
      <thead><tr><th>Arquivo</th><th>Tipo</th><th class="num">Tamanho</th><th>Status</th><th>Detalhes</th><th></th></tr></thead>
      <tbody>${fila.map((x, i) => `<tr>
        <td class="c-titulo">${esc(x.arquivo.name)}</td><td class="c-oculta">${esc(x.arquivo.name.split('.').pop().toUpperCase())}</td>
        <td class="num c-meio">${tamanho(x.arquivo.size)}</td><td class="c-meio">${ROTULO_STATUS[x.status]}</td>
        <td>${detalheFila(x)}</td>
        <td class="c-valor">${x.status === 'aguardando' && !enviando ? `<button class="link" data-tirar-fila="${i}" aria-label="Tirar da lista">×</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${feitos.length && !pendentes && !enviando ? `<p>Concluído: ${feitos.filter((x) => x.status === 'importado').length} importados, ${novos} lançamentos novos,
      ${feitos.filter((x) => x.status === 'repetido').length} repetidos, ${feitos.filter((x) => x.status === 'erro').length} com erro.
      <a href="#/transacoes?categoria=sem">Ver lançamentos sem categoria</a> · <a href="#/">Visão geral</a></p>` : ''}`;
  document.getElementById('enviar').addEventListener('click', enviarFila);
  document.getElementById('limpar-fila').addEventListener('click', () => { fila.length = 0; desenharFila(); });
  el.querySelectorAll('[data-tirar-fila]').forEach((b) => b.addEventListener('click', () => { fila.splice(Number(b.dataset.tirarFila), 1); desenharFila(); }));
}

function detalheFila(x) {
  if (x.status === 'erro') return `<span class="erro">${esc(x.detalhe)}</span>`;
  const r = x.resultado;
  if (!r) return '';
  if (x.status === 'repetido') return `${nomeBanco(r.banco)} · fatura ${mes(r.referencia)}`;
  return `${nomeBanco(r.banco)} · fatura ${mes(r.referencia)} · ${r.inseridas} lançamentos (${r.classificadas} categorizados` +
    `${r.desconsideradas ? `, ${r.desconsideradas} desconsiderados` : ''})` +
    (r.totalImpresso != null ? ` · total ${brl(r.totalImpresso)}` : '');
}

/** Envia um arquivo por vez para mostrar o andamento de cada um. */
async function enviarFila() {
  enviando = true;
  for (const item of fila.filter((x) => x.status === 'aguardando')) {
    item.status = 'enviando';
    desenharFila();
    try {
      const fd = new FormData();
      fd.append('arquivo', item.arquivo, item.arquivo.name);
      const [r] = await api('/api/importar', { method: 'POST', body: fd });
      item.resultado = r;
      item.status = r.status;
      item.detalhe = r.erro;
    } catch (err) {
      item.status = 'erro';
      item.detalhe = err.message;
    }
  }
  enviando = false;
  await carregarOpcoes().catch(() => {});
  if (rotaAtual().rota === 'importar') await telaImportar(); else desenharFila();
}

// ---------- evolução patrimonial ----------

/** "1.234,56" | "-500" | "0" -> centavos (aceita zero e negativo); vazio -> null */
function lerValorComSinal(txt) {
  const s = String(txt ?? '').trim();
  if (!s) return null;
  const neg = /^-/.test(s);
  const resto = s.replace(/^-/, '');
  if (/^0+([.,]0+)?$/.test(resto.replace(/R\$|\s/g, ''))) return 0;
  const v = lerValor(resto);
  return neg ? -v : v;
}
const reaisCampo = (c) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const corCarteira = (c, i) => c.cor || css(`--series-${(i % 8) + 1}`);
let modoPatrimonio = null; // null = automático: "objetivo" se houver objetivo, senão "pct"

async function telaPatrimonio({ filtros }) {
  const ev = await api('/api/patrimonio');
  const { carteiras, linhas, resumo, objetivos, ritmo } = ev;
  // O gráfico mostra o próximo objetivo ainda não alcançado (ou o último, se todos foram).
  const objetivo = objetivos.find((o) => !o.alcancado) ?? objetivos.at(-1);
  const modos = [['objetivo', 'Total × objetivo'], ['pct', '% do total'], ['carteiras', 'R$ por carteira'], ['mensal', 'Ganho × aporte por mês']]
    .filter(([m]) => (m !== 'objetivo' || objetivo) && (m !== 'mensal' || linhas.length > 1));
  const modo = modos.some(([m]) => m === modoPatrimonio) ? modoPatrimonio : (objetivo ? 'objetivo' : 'pct');
  const titulos = { objetivo: 'Patrimônio total × objetivo', pct: 'Participação de cada carteira', carteiras: 'Valor de cada carteira', mensal: 'Ganho e aporte por mês' };
  // ?objetivo=novo abre o formulário em branco; ?objetivo=<id> edita esse objetivo.
  const novoObjetivo = filtros.objetivo === 'novo' || !objetivos.length;
  const ativas = carteiras.filter((c) => c.ativa);
  const editando = filtros.editar ? linhas.find((l) => l.data === filtros.editar) : null;
  const ultima = linhas.at(-1);
  const hoje = new Date().toLocaleDateString('sv-SE');
  const sinal = (c) => (c == null ? '—' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${brl(Math.abs(c))}`);
  const classeSinal = (c) => (c > 0 ? 'var-desce' : c < 0 ? 'var-sobe' : ''); // ganho positivo = verde
  const pct2 = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  // Último valor conhecido da carteira antes de uma data (para repetir quando o campo fica em branco).
  const valorAnterior = (id, data) => linhas.findLast((l) => l.data < data && l.valores[id] != null)?.valores[id] ?? null;
  // Tabela: as 12 anotações mais recentes (ou todas), só com as carteiras que têm valor nelas.
  const LIMITE_TABELA = 12;
  const todas = filtros.todas === '1' || linhas.length <= LIMITE_TABELA;
  const exibidas = [...linhas].reverse().slice(0, todas ? undefined : LIMITE_TABELA);
  const colunas = carteiras.filter((c) => exibidas.some((l) => l.valores[c.id] != null));

  const sel = (o, tx) => (o ? seloStatus('ok').replace('dentro do limite', tx) : seloStatus('estourado').replace('limite estourado', tx));
  const numero = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const situacao = (o) => (o.dataAlvo ? numero('Situação', o.alcancado ? sel(true, 'alcançado')
    : o.noPrazo === true ? sel(true, 'no prazo') : o.noPrazo === false ? sel(false, 'fora do prazo') : '—') : '');

  // Formulário de objetivo: em branco (novo) ou com os valores de um existente.
  const formObjetivo = (o) => `<form class="campos form-objetivo" data-id="${o?.id ?? ''}">
      <label>Nome (opcional)<input name="nome" maxlength="60" value="${esc(o?.nome ?? '')}" placeholder="ex.: Independência financeira"></label>
      <label>Valor do objetivo (R$)<input name="valor" required data-moeda inputmode="numeric" value="${o ? reaisCampo(o.valor) : ''}" placeholder="ex.: 250.000,00"></label>
      <label>Até quando (opcional)<input type="date" name="dataAlvo" value="${o?.dataAlvo ?? ''}"></label>
      <label>Aporte desejado por mês (R$, opcional)<input name="aporteDesejado" data-moeda inputmode="numeric" value="${o?.aporteDesejado != null ? reaisCampo(o.aporteDesejado) : ''}" placeholder="ex.: 5.000,00"></label>
      <div class="barra-acoes largo"><button class="primario">Salvar objetivo</button>
        ${objetivos.length ? '<a href="#/patrimonio">cancelar</a>' : '<span class="muted">O objetivo aparece como uma linha no gráfico, com a previsão de quando você chega lá.</span>'}</div>
    </form>`;

  // Rendimento e aportes do patrimônio: rendimento em destaque e comparativo (início × 3 meses).
  const painelRitmo = () => {
    const r = ritmo;
    const cols = [['Desde o início', r.ritmoMes, r.aporteMedioMes, r.patrimonioRendeAporte]];
    if (r.desde3m) cols.push(['Últimos 3 meses', r.ritmo3mMes, r.aporte3mMes, r.patrimonioRendeAporte3m]);
    const cel = (v, f) => (v != null ? f(v) : '—');
    const alvo = (p) => `${brl(p)}<small class="sob${p <= r.atual ? ' pos' : ''}">${p <= r.atual ? 'já superado' : `faltam ${brl(p - r.atual)}`}</small>`;
    const linha = (rotulo, i, f) => `<div class="det-comp-item"><span class="det-comp-rotulo">${rotulo}</span>
      ${cols.map((c) => `<span class="det-comp-valor">${cel(c[i], f)}</span>`).join('')}</div>`;
    return `
      ${r.taxaMes != null ? `<div class="det-destaque">
        <div><span class="det-rotulo">Rendimento médio sem aportes</span>
          <b>${pct2(r.taxaMes)} <small>a.m.</small></b>
          <span class="muted">≈ ${pct2((1 + r.taxaMes) ** 12 - 1)} a.a.</span></div>
        <div><span class="det-rotulo">Rende hoje</span><b>${brl(r.rendimentoMes)}<small>/mês</small></b></div>
      </div>` : ''}
      <div class="det-grupo">
        <h3 class="det-rotulo">Ritmo e aportes</h3>
        <div class="det-comp" style="--colunas:${cols.length}">
          <div class="det-comp-cab">${cols.map((c) => `<span>${c[0]}</span>`).join('')}</div>
          ${linha('Crescimento com aportes', 1, (v) => `${sinal(v)}<small>/mês</small>`)}
          ${linha('Aporte médio', 2, (v) => `${brl(v)}<small>/mês</small>`)}
          ${r.patrimonioRendeAporte != null || r.patrimonioRendeAporte3m != null ? linha('Patrimônio para o rendimento superar o aporte', 3, alvo) : ''}
        </div>
      </div>
      <ul class="det-notas muted">
        <li>Crescimento: variação média do patrimônio desde ${dataBR(r.desde)}${r.estimado ? ' (inclui o histórico estimado)' : ''}${r.desde3m ? `; nos últimos 3 meses, a partir de ${dataBR(r.desde3m)}` : ''}, contando aportes.</li>
        ${r.patrimonioRendeAporte != null ? '<li>Patrimônio para o rendimento superar o aporte: aporte médio ÷ rendimento médio. A partir dele, só o rendimento já cresce mais que os aportes.</li>' : ''}
        ${linhas.some((l) => l.extraordinario) ? '<li>Aporte médio: sem os aportes extraordinários (doações, heranças), que contam como aporte mas não como ritmo habitual.</li>' : ''}
      </ul>`;
  };
  // Aporte do mês e prazo, no cartão do objetivo.
  const extrasObjetivo = (o) => {
    const pctAporte = o.aporteDesejado ? o.aportadoMes / o.aporteDesejado : 0;
    return `
      ${o.aporteDesejado != null ? `<div class="det-grupo">
        <h3 class="det-rotulo">Aporte de ${mes(o.mesAtual)}</h3>
        <div class="det-linha"><span><b>${brl(o.aportadoMes)}</b> de ${brl(o.aporteDesejado)} desejados</span>
          ${o.aporteDesejado ? `<span class="muted">${pct(pctAporte)}</span>` : ''}</div>
        <div class="progresso" role="img" aria-label="${pct(pctAporte)} do aporte desejado do mês">
          <div class="progresso-fill ${pctAporte >= 1 ? 'st-ok' : ''}" style="width:${Math.min(pctAporte, 1) * 100}%"></div></div>
      </div>` : ''}
      ${o.dataAlvo ? `<div class="det-grupo">
        <h3 class="det-rotulo">Prazo</h3>
        <div class="det-linha"><span>Até <b>${dataBR(o.dataAlvo)}</b></span>
          <span>${o.alcancado ? '—' : o.necessarioMes != null ? `precisa de <b>${brl(o.necessarioMes)}/mês</b>` : 'prazo vencido'}</span></div>
      </div>` : ''}
      <p class="det-notas sem-marcador muted">Previsão no ritmo atual e nos últimos 3 meses: o crescimento médio de <b>Rendimento e aportes</b> mantido até o objetivo.${o.aporteDesejado != null ? ' Previsão com aporte desejado: rende a taxa média (juros compostos) e recebe o aporte desejado todo mês.' : ''}</p>`;
  };

  $app.innerHTML = `
    <h1>Evolução patrimonial</h1>
    <p class="sub">Anote o valor de cada carteira de investimento numa data. O painel calcula a variação, o ganho
      (variação menos aportes) e a participação de cada carteira no total.</p>
    ${resumo ? `<div class="cards">
      <div class="card"><div class="rot">Patrimônio em ${dataBR(resumo.data)}</div><div class="val">${brl(resumo.atual)}</div>
        <span class="muted">desde ${dataBR(resumo.desde)}: ${sinal(resumo.atual - resumo.inicial)}</span></div>
      ${resumo.ultimo ? `<div class="card"><div class="rot">Ganho desde a anotação anterior</div>
        <div class="val ${classeSinal(resumo.ultimo.ganho)}">${sinal(resumo.ultimo.ganho)}</div>
        <span class="muted">${resumo.ultimo.dias} dias · variação ${sinal(resumo.ultimo.variacao)}${resumo.ultimo.aportado ? ` · aporte ${sinal(resumo.ultimo.aportado)}` : ''}</span></div>` : ''}
      <div class="card"><div class="rot">Ganho no período</div><div class="val ${classeSinal(resumo.ganhoTotal)}">${sinal(resumo.ganhoTotal)}</div>
        <span class="muted">${resumo.rendimento != null ? `${pct2(resumo.rendimento)} em ${resumo.diasTotal} dias` : ''}${resumo.rendimentoAno != null
          ? ` · ≈ ${pct2(resumo.rendimentoAno)} a.a.` : ''}</span></div>
      <div class="card"><div class="rot">Aportado no período</div><div class="val">${sinal(resumo.aportadoTotal)}</div>
        ${resumo.extraordinarioTotal ? `<span class="muted">inclui ${brl(resumo.extraordinarioTotal)} extraordinário</span>` : ''}</div>
      <div class="card"><div class="rot">Ganho por dia hoje</div><div class="val">${resumo.ganhoDiaHoje != null ? brl(resumo.ganhoDiaHoje) : '—'}</div>
        ${resumo.ganhoDiaHoje != null ? `<span class="muted">${pct2(resumo.taxaMes)} a.m. sobre ${brl(resumo.atual)}</span>` : ''}</div>
    </div>` : ''}
    ${ritmo && linhas.length > 1 ? `<details class="painel bloco" id="rendimento-aportes">
      <summary><h2>Rendimento e aportes</h2></summary>
      ${painelRitmo()}
    </details>` : ''}
    <details class="painel bloco" id="nova-anotacao" ${editando || !linhas.length ? 'open' : ''}>
      <summary><h2>${editando ? `Editar anotação de ${dataBR(editando.data)}` : '+ Nova anotação'}</h2></summary>
      ${ativas.length ? `<form id="form-patrimonio" class="campos">
        <label>Data<input type="date" name="data" required value="${editando?.data ?? hoje}" ${editando ? 'readonly' : ''}></label>
        ${ativas.map((c) => `<label><span>${bolinha(corCarteira(c, carteiras.indexOf(c)))} ${esc(c.nome)} (R$)</span>
          <input name="c${c.id}" data-carteira-id="${c.id}" data-moeda inputmode="numeric" value="${reaisCampo(editando?.valores[c.id])}"
            placeholder="${ultima?.valores[c.id] != null ? `último: ${reaisCampo(ultima.valores[c.id])}` : '0,00'}"></label>`).join('')}
        <label>Aporte do período (R$)<input name="aporte" data-moeda="sinal" inputmode="decimal" value="${editando ? reaisCampo(editando.aportado) : ''}"
          placeholder="0,00 (resgate: digite −)"></label>
        <label>Dos quais extraordinário (R$, opcional)<input name="extraordinario" data-moeda inputmode="numeric"
          value="${editando?.extraordinario ? reaisCampo(editando.extraordinario) : ''}" placeholder="doação, herança…"></label>
        <p class="largo" id="total-ao-vivo" aria-live="polite"></p>
        <div class="barra-acoes largo"><button class="primario">${editando ? 'Salvar alterações' : 'Salvar anotação'}</button>
          ${editando ? '<a href="#/patrimonio">cancelar edição</a>' : `${ultima ? '<button type="button" class="link" id="copiar-ultimos">copiar últimos valores</button>' : ''}
            <span class="muted">Carteira em branco repete o último valor. Aporte: dinheiro novo colocado desde a anotação anterior; não conta como ganho.</span>`}</div>
      </form>` : '<p class="muted">Cadastre uma carteira abaixo para começar.</p>'}
    </details>
    ${linhas.length ? `<section class="painel bloco">
      <div class="lista-linha"><h2>${titulos[modo]}</h2>
        <div class="alternar" role="group" aria-label="Visualização do gráfico">
          ${modos.map(([m, t]) => `<button type="button" class="chip-mes ${modo === m ? 'ativo' : ''}" data-modo="${m}" aria-pressed="${modo === m}">${t}</button>`).join('')}
        </div></div>
      <div class="grafico" id="g-patrimonio" style="height:${modo === 'objetivo' ? 420 : 380}px"></div>
      ${modo === 'objetivo' ? `<p class="muted"><span id="nota-escala" hidden>Escala ajustada ao intervalo dos valores (não começa em zero). </span>Arraste a barra abaixo do gráfico${telaEstreita.matches ? ' ou faça pinça com dois dedos' : ', ou use a roda do mouse,'} para aproximar um período.</p>`
        : modo === 'mensal' ? `<p class="muted">Ganho: o que o patrimônio rendeu no mês, sem contar aportes. Cada anotação conta no mês da sua data.${linhas.some((l) => l.estimado) ? ' Inclui o histórico estimado.' : ''}</p>`
        : objetivo ? '<p class="muted">O objetivo aparece em <b>Total × objetivo</b>.</p>' : ''}
      ${modo === 'objetivo' && objetivos.length > 1 ? `<p class="muted">Mostra ${objetivo.alcancado ? 'o último objetivo' : 'o próximo objetivo a alcançar'}${objetivo.nome ? ` (<b>${esc(objetivo.nome)}</b>)` : ''}; os anteriores aparecem como linhas de referência.</p>` : ''}
    </section>` : ''}
    ${objetivos.map((o) => `<section class="painel bloco" id="objetivo-${o.id}"><h2>Objetivo${o.nome ? `: ${esc(o.nome)}` : ''}</h2>
      ${filtros.objetivo === String(o.id) ? formObjetivo(o) : `
        <div class="lista-linha"><b>${brl(o.atual)} de ${brl(o.valor)}</b>
          <span>${o.alcancado ? sel(true, 'objetivo alcançado') : `${pct(o.progresso)} · faltam ${brl(o.falta)}`}</span></div>
        <div class="progresso grande" role="img" aria-label="${pct(o.progresso)} do objetivo">
          <div class="progresso-fill" style="width:${Math.min(o.progresso, 1) * 100}%"></div></div>
        <dl class="numeros">
          ${numero('Previsão no ritmo atual', o.alcancado ? 'alcançado' : o.dataPrevista ? dataBR(o.dataPrevista) : 'sem crescimento')}
          ${o.desde3m ? numero('Previsão nos últimos 3 meses', o.alcancado ? 'alcançado' : o.dataPrevista3m ? dataBR(o.dataPrevista3m) : 'sem crescimento') : ''}
          ${o.aporteDesejado != null ? numero('Previsão com aporte desejado', o.alcancado ? 'alcançado'
            : o.dataPrevistaPlanejada ? dataBR(o.dataPrevistaPlanejada) : 'sem crescimento') : ''}
          ${situacao(o)}
        </dl>
        ${extrasObjetivo(o)}
        <div class="barra-acoes"><a href="#/patrimonio?objetivo=${o.id}">editar objetivo</a>
          <button class="link perigo" data-remover-objetivo="${o.id}">remover</button></div>`}
    </section>`).join('')}
    ${novoObjetivo ? `<section class="painel bloco" id="objetivo-novo"><h2>${objetivos.length ? 'Novo objetivo' : 'Objetivo'}</h2>${formObjetivo(null)}</section>`
      : '<a class="painel bloco novo-objetivo" href="#/patrimonio?objetivo=novo"><h2>+ Novo objetivo</h2></a>'}
    ${linhas.length ? `<section class="painel bloco"><div class="lista-linha"><h2>Anotações</h2>
      ${linhas.some((l) => l.estimado) ? `<span><span class="muted">${linhas.filter((l) => l.estimado).length} estimadas a partir dos aportes</span>
        <button class="link perigo" id="apagar-estimados">apagar estimativas</button></span>` : ''}</div>
      <div class="tabela-wrap"><table class="tabela-patrimonio">
      <thead><tr><th>Data</th>${colunas.map((c) => `<th class="num">${bolinha(corCarteira(c, carteiras.indexOf(c)))} ${esc(c.nome)}</th>`).join('')}
        <th class="num">Total</th><th class="num">Variação</th><th class="num">Aportado</th><th class="num">Ganho</th>
        <th class="num col-sec">Dias</th><th class="num col-sec">Ganho/dia</th><th></th></tr></thead>
      <tbody>${exibidas.map((l) => `<tr data-data="${l.data}" class="${l.estimado ? 'estimado' : ''}">
        <td>${dataBR(l.data)}${l.estimado ? ' <span class="selo" title="Calculado a partir dos aportes e de um rendimento médio; não é um valor real">estimado</span>' : ''}</td>
        ${colunas.map((c) => `<td class="num">${l.valores[c.id] != null ? `${brl(l.valores[c.id])}<div class="muted">${pct(l.participacao[c.id])}</div>` : '—'}</td>`).join('')}
        <td class="num"><b>${brl(l.total)}</b></td>
        <td class="num">${sinal(l.variacao)}</td>
        <td class="num">${l.dias == null && !l.aportado ? '—' : sinal(l.aportado)}${l.extraordinario
          ? `<div class="muted" title="Fora da média de aportes">${brl(l.extraordinario)} extraord.</div>` : ''}</td>
        <td class="num ${classeSinal(l.ganho)}">${sinal(l.ganho)}</td>
        <td class="num col-sec">${l.dias ?? '—'}</td>
        <td class="num col-sec">${l.ganhoDia != null ? sinal(l.ganhoDia) : '—'}</td>
        <td class="acoes"><a href="#/patrimonio?editar=${l.data}">editar</a> · <button class="link perigo" data-apagar-data>apagar</button></td>
      </tr>`).join('')}</tbody></table></div>
      ${linhas.length > LIMITE_TABELA ? `<p class="muted">${todas ? `<a href="#/patrimonio">mostrar só as ${LIMITE_TABELA} mais recentes</a>`
        : `Mostrando as ${LIMITE_TABELA} anotações mais recentes de ${linhas.length}. <a href="#/patrimonio?todas=1">ver todas</a>`}</p>` : ''}</section>` : ''}
    <section class="painel"><h2>Carteiras</h2>
      <form class="inline" id="form-carteira">
        <input name="nome" required maxlength="40" placeholder="ex.: Tesouro Direto" aria-label="Nome da nova carteira">
        <input type="color" name="cor" value="${corHex(css(`--series-${(carteiras.length % 8) + 1}`))}" aria-label="Cor">
        <button class="primario">Adicionar carteira</button>
      </form>
      ${carteiras.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Cor</th><th>Nome</th><th>Situação</th><th class="num">Valor atual</th><th></th></tr></thead>
        <tbody>${carteiras.map((c, i) => `<tr data-carteira="${c.id}" data-nome="${esc(c.nome)}">
          <td class="c-meio"><input type="color" data-cor value="${esc(corHex(corCarteira(c, i)))}" aria-label="Cor de ${esc(c.nome)}"></td>
          <td class="c-titulo"><input class="nome-inline" data-nome-input value="${esc(c.nome)}" maxlength="40" aria-label="Renomear ${esc(c.nome)}"></td>
          <td class="c-meio"><label><input type="checkbox" data-ativa ${c.ativa ? 'checked' : ''}> ativa</label></td>
          <td class="num c-valor">${ultima?.valores[c.id] != null ? brl(ultima.valores[c.id]) : '—'}</td>
          <td class="c-acao"><button class="link perigo" data-apagar-carteira>apagar</button></td></tr>`).join('')}</tbody></table></div>
        <p class="muted">Desative uma carteira encerrada para tirá-la do formulário sem perder o histórico.</p>` : ''}
    </section>`;

  if (linhas.length) {
    const el = document.getElementById('g-patrimonio');
    if (modo === 'objetivo') {
      const yMin = graficoObjetivo(el, linhas, objetivo, objetivos.filter((o) => o !== objetivo && o.valor <= objetivo.valor));
      document.getElementById('nota-escala').hidden = !(yMin > 0);
    }
    else if (modo === 'mensal') graficoGanhoMensal(el, linhas);
    else graficoPatrimonio(el, carteiras, linhas, modo);
  }
  if (filtros.objetivo) document.getElementById(`objetivo-${filtros.objetivo}`)?.scrollIntoView({ block: 'start' });
  $app.querySelectorAll('.form-objetivo').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    let valorCentavos, aporteDesejadoCentavos;
    try { valorCentavos = lerValor(d.valor); if (!valorCentavos) throw new Error(); } catch { return aviso('Valor do objetivo inválido', true); }
    try { aporteDesejadoCentavos = lerValorComSinal(d.aporteDesejado); if (aporteDesejadoCentavos < 0) throw new Error(); } catch { return aviso('Aporte desejado inválido', true); }
    const id = f.dataset.id;
    acao(() => api(id ? `/api/patrimonio-objetivos/${id}` : '/api/patrimonio-objetivos', { method: id ? 'PUT' : 'POST', body: {
      nome: d.nome || null, valorCentavos, dataAlvo: d.dataAlvo || null, aporteDesejadoCentavos,
    } }),
      'Objetivo salvo').then((ok) => { if (ok && filtros.objetivo) irPara('patrimonio'); });
  }));
  $app.querySelectorAll('[data-remover-objetivo]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Remover objetivo?', 'O histórico do patrimônio não é afetado.', { botao: 'Remover' })) {
      acao(() => api(`/api/patrimonio-objetivos/${b.dataset.removerObjetivo}`, { method: 'DELETE' }), 'Objetivo removido');
    }
  }));
  $app.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { modoPatrimonio = b.dataset.modo; render(); }));
  if (editando) document.getElementById('nova-anotacao').scrollIntoView({ block: 'start' });

  const form = document.getElementById('form-patrimonio');
  if (form) {
    /** Valores do formulário; em branco: o valor que já tinha nessa data (ao editar) ou o anterior (nova anotação). */
    const lerFormulario = () => {
      const d = Object.fromEntries(new FormData(form));
      const valores = Object.fromEntries(ativas.map((c) => [c.id, lerValorComSinal(d[`c${c.id}`])]));
      if (Object.values(valores).some((v) => v != null && v < 0)) throw new Error('Valor de carteira não pode ser negativo');
      const aporte = lerValorComSinal(d.aporte) ?? 0;
      const extraordinario = lerValorComSinal(d.extraordinario) ?? 0;
      if (extraordinario < 0 || extraordinario > Math.max(aporte, 0)) throw new Error('O extraordinário deve estar entre zero e o aporte');
      const repetidas = [];
      if (editando) {
        for (const [id, v] of Object.entries(editando.valores)) if (valores[id] == null) valores[id] = v;
      } else {
        for (const c of ativas) {
          if (valores[c.id] != null) continue;
          valores[c.id] = valorAnterior(c.id, d.data);
          if (valores[c.id] != null) repetidas.push(c.nome);
        }
      }
      return { d, valores, aporte, extraordinario, repetidas };
    };
    const aoVivo = document.getElementById('total-ao-vivo');
    const atualizarTotal = () => {
      let r;
      try { r = lerFormulario(); } catch (err) { aoVivo.textContent = err.message; return; }
      const total = Object.values(r.valores).reduce((s, v) => s + (v ?? 0), 0);
      const anterior = linhas.findLast((l) => l.data < r.d.data);
      const partes = [`Total: <b>${brl(total)}</b>`];
      if (anterior) {
        const variacaoNova = total - anterior.total;
        partes.push(`variação ${sinal(variacaoNova)} desde ${dataBR(anterior.data)}`,
          `ganho <span class="${classeSinal(variacaoNova - r.aporte)}">${sinal(variacaoNova - r.aporte)}</span>`);
      }
      if (r.repetidas.length) partes.push(`<span class="muted">repete o último valor de ${r.repetidas.map(esc).join(', ')}</span>`);
      aoVivo.innerHTML = partes.join(' · ');
    };
    form.addEventListener('input', atualizarTotal);
    atualizarTotal();
    document.getElementById('copiar-ultimos')?.addEventListener('click', () => {
      const data = form.elements.data.value;
      for (const c of ativas) {
        const v = valorAnterior(c.id, data);
        if (v != null) form.elements[`c${c.id}`].value = reaisCampo(v);
      }
      atualizarTotal();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let r;
      try { r = lerFormulario(); } catch (err) { return aviso(err.message, true); }
      const { d, valores, aporte, extraordinario, repetidas } = r;
      if (!editando && linhas.some((l) => l.data === d.data)
        && !(await confirmar('Substituir anotação?', `Já existe uma anotação em ${dataBR(d.data)}.`, { botao: 'Substituir' }))) return;
      const msg = `Anotação de ${dataBR(d.data)} salva${repetidas.length ? ` (${repetidas.length === 1 ? '1 carteira repetiu' : `${repetidas.length} carteiras repetiram`} o último valor)` : ''}`;
      acao(() => api(`/api/patrimonio/${d.data}`, { method: 'PUT', body: { valores, aporte, extraordinario } }), msg)
        .then((ok) => { if (ok && editando) irPara('patrimonio'); });
    });
  }
  document.getElementById('apagar-estimados')?.addEventListener('click', async () => {
    if (await confirmar('Apagar as estimativas?', 'Todas as anotações estimadas saem; as anotações reais ficam.')) {
      acao(() => api('/api/patrimonio-estimados', { method: 'DELETE' }), (x) => `${x.apagadas} anotações estimadas apagadas`);
    }
  });
  $app.querySelectorAll('[data-apagar-data]').forEach((b) => b.addEventListener('click', async () => {
    const data = b.closest('tr').dataset.data;
    if (await confirmar('Apagar anotação?', `A anotação de ${dataBR(data)} sai do histórico.`)) acao(() => api(`/api/patrimonio/${data}`, { method: 'DELETE' }), 'Anotação apagada');
  }));
  document.getElementById('form-carteira').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/carteiras', { method: 'POST', body: { nome: d.nome, cor: d.cor } }), `Carteira “${d.nome.trim()}” criada`);
  });
  $app.querySelectorAll('tr[data-carteira]').forEach((tr) => {
    const id = tr.dataset.carteira;
    const salvar = (body, msg) => acao(() => api(`/api/carteiras/${id}`, { method: 'PUT', body }), msg);
    tr.querySelector('[data-cor]').addEventListener('change', (e) => salvar({ cor: e.target.value }, 'Cor salva'));
    aoEditar(tr.querySelector('[data-nome-input]'), (nome) => salvar({ nome }, `Renomeada para “${nome.trim()}”`));
    tr.querySelector('[data-ativa]').addEventListener('change', (e) => salvar({ ativa: e.target.checked }, e.target.checked ? 'Carteira ativada' : 'Carteira desativada'));
    tr.querySelector('[data-apagar-carteira]').addEventListener('click', async () => {
      if (await confirmar(`Apagar a carteira “${tr.dataset.nome}”?`,
        'TODOS os valores anotados dela também são apagados. Para só tirá-la do formulário, desmarque “ativa”.')) {
        acao(() => api(`/api/carteiras/${id}`, { method: 'DELETE' }), 'Carteira apagada');
      }
    });
  });
}

/** Arredonda para um passo "redondo" (1, 2 ou 5 × 10^n) adequado ao intervalo. */
function passoRedondo(intervalo) {
  const bruto = intervalo / 6;
  const pot = 10 ** Math.floor(Math.log10(bruto || 1));
  return [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? pot * 10;
}

/**
 * Total do patrimônio × objetivo. A escala vertical vai do menor valor (com folga) até o objetivo,
 * em vez de começar em zero, para a evolução ficar visível; o eixo horizontal vai até a data
 * prevista/prazo e tem zoom (barra e roda do mouse) para olhar só o histórico.
 */
function graficoObjetivo(el, linhas, objetivo, anteriores = []) {
  const ultima = linhas.at(-1);
  // Meio-dia UTC: no fuso do Brasil continua sendo o mesmo dia (meia-noite UTC viraria o dia anterior).
  const ts = (d) => `${d}T12:00:00Z`;
  const limite = new Date(Date.parse(ts(ultima.data)) + 3652 * 86400000).toISOString().slice(0, 10);
  const fim = [objetivo.dataPrevista && objetivo.dataPrevista <= limite ? objetivo.dataPrevista : null, objetivo.dataAlvo,
    objetivo.dataPrevistaPlanejada && objetivo.dataPrevistaPlanejada <= limite ? objetivo.dataPrevistaPlanejada : null]
    .filter(Boolean).sort().at(-1);
  const projecao = !objetivo.alcancado && objetivo.dataPrevista && objetivo.dataPrevista <= limite
    ? [[ts(ultima.data), ultima.total], [ts(objetivo.dataPrevista), objetivo.valor]] : null;
  const necessario = !objetivo.alcancado && objetivo.dataAlvo && objetivo.dataAlvo > ultima.data
    ? [[ts(ultima.data), ultima.total], [ts(objetivo.dataAlvo), objetivo.valor]] : null;
  const planejado = !objetivo.alcancado && objetivo.dataPrevistaPlanejada && objetivo.dataPrevistaPlanejada <= limite
    ? [[ts(ultima.data), ultima.total], [ts(objetivo.dataPrevistaPlanejada), objetivo.valor]] : null;
  // Histórico estimado (tracejado) até a primeira anotação real, que liga as duas linhas.
  const iReal = linhas.findIndex((l) => !l.estimado);
  const estimadas = iReal > 0 ? linhas.slice(0, iReal + 1) : [];
  const reais = linhas.filter((l) => !l.estimado);

  const valores = [...linhas.map((l) => l.total), objetivo.valor];
  // referências abaixo do histórico achatariam o gráfico: ficam de fora
  anteriores = anteriores.filter((o) => o.valor >= Math.min(...linhas.map((l) => l.total)));
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const passo = passoRedondo(maximo - minimo);
  const yMin = Math.max(0, Math.floor((minimo - passo / 2) / passo) * passo);
  const yMax = Math.ceil((maximo + passo / 4) / passo) * passo;
  const spanDias = (Date.parse(ts(fim ?? ultima.data)) - Date.parse(ts(linhas[0].data))) / 86400000;
  const rotuloData = (v) => {
    const d = new Date(v);
    return spanDias > 120 ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`
      : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  // Histórico curto diante de um horizonte longo: abre mostrando o histórico e um trecho da projeção.
  const fracHistorico = spanDias ? (Date.parse(ts(ultima.data)) - Date.parse(ts(linhas[0].data))) / 86400000 / spanDias : 1;
  const zoomFim = fracHistorico < 0.2 ? Math.max(fracHistorico * 250, 15) : 100;
  const cor = css('--series-1');
  const g = novoGrafico(el);
  g.setOption({
    grid: { left: 8, right: 24, top: 40, bottom: 56, containLabel: true },
    legend: { ...legendaBase(),
      data: [...(estimadas.length ? ['Estimado'] : []), 'Patrimônio', ...(projecao ? ['Ritmo atual'] : []),
        ...(planejado ? ['Com aporte desejado'] : []), ...(necessario ? ['Necessário p/ prazo'] : [])] },
    tooltip: {
      ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: css('--text-3') } },
      formatter: (ps) => {
        const p = ps.find((x) => x.seriesName === 'Patrimônio') ?? ps.find((x) => x.seriesName === 'Estimado');
        if (!p) return '';
        const l = linhas.find((x) => ts(x.data) === p.value[0]);
        if (!l) return '';
        return `<b>${dataBR(l.data)}</b>${l.estimado ? ' <i>(estimado)</i>' : ''}<br>${p.marker}Patrimônio: <b>${brl(l.total)}</b><br>
          ${pct(l.total / objetivo.valor)} do objetivo · faltam ${brl(Math.max(0, objetivo.valor - l.total))}`;
      },
    },
    dataZoom: [
      { type: 'slider', xAxisIndex: 0, height: 22, bottom: 8, filterMode: 'none', borderColor: css('--border'),
        start: 0, end: zoomFim, textStyle: { color: css('--text-3') }, labelFormatter: (v) => rotuloData(v) },
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', start: 0, end: zoomFim },
    ],
    xAxis: {
      type: 'time', ...eixoBase(), splitLine: { show: false },
      max: fim ? Date.parse(ts(fim)) : null,
      // Marcas no 1º do mês (horizonte longo) saem como "jan/27"; com zoom no histórico, como dia/mês.
      axisLabel: { color: css('--text-2'), hideOverlap: true,
        formatter: (v) => {
          const d = new Date(v);
          return d.getUTCDate() === 1 ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`
            : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        } },
    },
    yAxis: {
      type: 'value', ...eixoBase(), min: yMin, max: yMax, interval: passo,
      axisLabel: { color: css('--text-2'), formatter: (v) => brl(v).replace(/,00$/, '') },
    },
    series: [
      {
        name: 'Patrimônio', type: 'line', symbol: 'circle', symbolSize: 8, showSymbol: true,
        lineStyle: { width: 2, color: cor }, itemStyle: { color: cor, borderColor: css('--surface'), borderWidth: 2 },
        areaStyle: { color: cor, opacity: 0.12, origin: 'start' },
        data: reais.map((l) => [ts(l.data), l.total]),
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: css('--text-2'), type: 'dashed', width: 2 },
          // No celular os rótulos encurtam: inteiros, o do objetivo cruzava a linha do prazo.
          label: { formatter: `${telaEstreita.matches ? 'Objetivo: ' : objetivo.nome ? `${objetivo.nome}: ` : 'Objetivo: '}${brl(objetivo.valor).replace(/,00$/, '')}`,
            position: 'insideStartTop', color: css('--text') },
          data: [{ yAxis: objetivo.valor },
            // objetivos de valor menor: linhas de referência mais discretas
            ...anteriores.map((o) => ({ yAxis: o.valor, lineStyle: { color: css('--text-3'), width: 1 },
              label: { formatter: `${o.nome ?? 'Objetivo'}: ${brl(o.valor).replace(/,00$/, '')}`, color: css('--text-3') } })),
            ...(objetivo.dataAlvo ? [{
            xAxis: ts(objetivo.dataAlvo), label: { formatter: telaEstreita.matches ? 'Prazo' : `Prazo ${dataBR(objetivo.dataAlvo)}`, position: 'insideStartTop' },
          }] : [])],
        },
        markPoint: objetivo.dataPrevista && projecao ? {
          symbol: 'pin', symbolSize: 0, silent: true,
          label: { show: true, color: css('--text-2'), formatter: `previsão ${dataBR(objetivo.dataPrevista)}`, position: 'top', offset: [-40, -6] },
          data: [{ coord: projecao[1] }],
        } : undefined,
      },
      ...(estimadas.length ? [{
        name: 'Estimado', type: 'line', data: estimadas.map((l) => [ts(l.data), l.total]),
        symbol: 'circle', symbolSize: 4, showSymbol: estimadas.length < 60,
        lineStyle: { width: 2, color: cor, type: 'dashed', opacity: 0.7 }, itemStyle: { color: cor, opacity: 0.7 },
        areaStyle: { color: cor, opacity: 0.06, origin: 'start' },
      }] : []),
      ...(planejado ? [{
        name: 'Com aporte desejado', type: 'line', data: planejado, symbol: 'none',
        lineStyle: { color: css('--text-2'), type: [8, 4, 2, 4], width: 2 }, itemStyle: { color: css('--text-2') },
      }] : []),
      ...(projecao ? [{
        name: 'Ritmo atual', type: 'line', data: projecao, symbol: 'none',
        lineStyle: { color: cor, type: 'dotted', width: 2, opacity: 0.8 }, itemStyle: { color: cor },
      }] : []),
      ...(necessario ? [{
        name: 'Necessário p/ prazo', type: 'line', data: necessario, symbol: 'none',
        lineStyle: { color: css('--text-3'), type: 'dashed', width: 1.5 }, itemStyle: { color: css('--text-3') },
      }] : []),
    ],
  });
  return yMin;
}

/** Ganho (sem aportes) e aporte somados por mês, em barras lado a lado. */
function graficoGanhoMensal(el, linhas) {
  const porMes = new Map();
  for (const l of linhas.slice(1)) {
    const m = porMes.get(l.data.slice(0, 7)) ?? { ganho: 0, aporte: 0, estimado: false };
    m.ganho += l.ganho ?? 0;
    m.aporte += l.aportado ?? 0;
    m.estimado ||= l.estimado;
    porMes.set(l.data.slice(0, 7), m);
  }
  const refs = [...porMes.keys()];
  const g = novoGrafico(el);
  g.setOption({
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { ...legendaBase(), icon: 'roundRect', data: ['Ganho', 'Aporte'] },
    tooltip: {
      ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const m = porMes.get(refs[ps[0].dataIndex]);
        return `<b>${mes(refs[ps[0].dataIndex])}</b>${m.estimado ? ' <i>(estimado)</i>' : ''}<br>
          ${ps.map((p) => `${p.marker}${p.seriesName}: ${brl(p.value)}`).join('<br>')}<br>Variação: <b>${brl(m.ganho + m.aporte)}</b>`;
      },
    },
    xAxis: { type: 'category', data: refs.map(mes), ...eixoBase() },
    yAxis: { type: 'value', ...eixoBase(), axisLabel: { color: css('--text-2'), formatter: (v) => brl(v).replace(/,00$/, '') } },
    series: [{
      name: 'Ganho', type: 'bar', barMaxWidth: 28, itemStyle: { color: css('--good') },
      data: refs.map((r) => {
        const m = porMes.get(r);
        return { value: m.ganho, itemStyle: { color: css(m.ganho < 0 ? '--critical' : '--good'), opacity: m.estimado ? 0.5 : 1,
          borderRadius: m.ganho < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } };
      }),
    }, {
      name: 'Aporte', type: 'bar', barMaxWidth: 28, itemStyle: { color: css('--series-1') },
      data: refs.map((r) => {
        const m = porMes.get(r);
        return { value: m.aporte, itemStyle: { opacity: m.estimado ? 0.5 : 1, borderRadius: m.aporte < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } };
      }),
    }],
  });
}

/**
 * Áreas empilhadas por carteira ao longo do tempo (eixo de datas real, pois as anotações não têm
 * intervalo fixo). Modo "%": cada data soma 100%; modo "R$": valores absolutos.
 */
function graficoPatrimonio(el, carteiras, linhas, modo) {
  const pctModo = modo === 'pct';
  const dias = (Date.parse(`${linhas.at(-1).data}T00:00:00Z`) - Date.parse(`${linhas[0].data}T00:00:00Z`)) / 86400000;
  const usadas = carteiras.filter((c) => linhas.some((l) => l.valores[c.id] != null));
  const g = novoGrafico(el);
  g.setOption({
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    legend: { ...legendaBase(), icon: 'roundRect', data: usadas.map((c) => c.nome) },
    tooltip: {
      ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: css('--text-3') } },
      formatter: (ps) => {
        if (!ps.length) return '';
        const l = linhas[ps[0].dataIndex];
        if (!l) return '';
        return `<b>${dataBR(l.data)}</b> · total ${brl(l.total)}<br>${[...ps].reverse().map((p) => {
          const c = usadas[p.seriesIndex];
          return `${p.marker}${esc(c.nome)}: ${pct(l.participacao[c.id] ?? 0)} · ${brl(l.valores[c.id] ?? 0)}`;
        }).join('<br>')}`;
      },
    },
    xAxis: {
      type: 'time', ...eixoBase(), splitLine: { show: false },
      axisLabel: {
        color: css('--text-2'), hideOverlap: true,
        formatter: (v) => {
          const d = new Date(v);
          return dias > 120 ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`
            : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        },
      },
    },
    yAxis: {
      type: 'value', ...eixoBase(), max: pctModo ? 100 : null,
      axisLabel: { color: css('--text-2'), formatter: (v) => (pctModo ? `${v}%` : brl(v).replace(/,00$/, '')) },
    },
    series: usadas.map((c, idx) => ({
      markArea: idx === 0 && linhas.some((l) => l.estimado) ? {
        silent: true, itemStyle: { color: css('--text-3'), opacity: 0.08 },
        label: { show: true, color: css('--text-3'), position: 'insideTop', formatter: 'estimado' },
        data: [[{ xAxis: `${linhas[0].data}T00:00:00Z` }, { xAxis: `${linhas.findLast((l) => l.estimado).data}T00:00:00Z` }]],
      } : undefined,
      name: c.nome, type: 'line', stack: 'total', smooth: false, symbol: 'circle', symbolSize: 6, showSymbol: linhas.length < 40,
      lineStyle: { width: 2, color: css('--surface') },
      itemStyle: { color: corCarteira(c, carteiras.indexOf(c)) },
      areaStyle: { color: corCarteira(c, carteiras.indexOf(c)), opacity: 0.95 },
      emphasis: { focus: 'series' },
      data: linhas.map((l) => [`${l.data}T00:00:00Z`,
        pctModo ? +(((l.participacao[c.id] ?? 0) * 100).toFixed(2)) : (l.valores[c.id] ?? 0)]),
    })),
  });
}

// ---------- configurar ----------

const abasConfig = (ativa) => `<nav class="abas" aria-label="Configurar">
  ${[['categorias', 'Categorias'], ['bancos', 'Bancos e cartões'], ['regras', 'Regras e etiquetas']]
    .map(([r, t]) => `<a href="#/${r}" class="${r === ativa ? 'ativo' : ''}">${t}</a>`).join('')}</nav>`;

/** Salva um campo de texto ao pressionar Enter ou sair dele, se mudou. */
function aoEditar(input, salvar) {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  input.addEventListener('blur', () => { if (input.value !== input.defaultValue) salvar(input.value); });
}

async function telaCategorias() {
  const [cats, grupos] = await Promise.all([api('/api/categorias'), api('/api/grupos')]);
  const optsGrupo = (atual) => `<option value="">— sem grupo —</option>` +
    grupos.map((g) => `<option value="${g.id}" ${g.id === atual ? 'selected' : ''}>${esc(g.nome)}</option>`).join('');
  const total = cats.reduce((s, c) => s + c.total, 0);
  $app.innerHTML = `
    ${abasConfig('categorias')}
    <h1>Categorias</h1>
    <p class="sub">${cats.length} categorias. Clique no nome para renomear e na cor para trocar; as mudanças são salvas na hora.</p>
    <section class="painel bloco"><h2>Nova categoria</h2>
      <form class="inline" id="form-cat">
        <input name="nome" required maxlength="40" placeholder="ex.: Viagem" aria-label="Nome da nova categoria">
        <input type="color" name="cor" value="#2a78d6" aria-label="Cor">
        <button class="primario">Criar categoria</button>
      </form>
    </section>
    <section class="painel bloco"><h2>Grupos</h2>
      <p class="muted">Juntam categorias afins numa barra só no gráfico do painel (ex.: “Alimentação” = Restaurante + Marmita). Escolha o grupo de cada categoria na tabela abaixo.</p>
      <form class="inline" id="form-grupo">
        <input name="nome" required maxlength="40" placeholder="ex.: Alimentação" aria-label="Nome do novo grupo">
        <button class="primario">Criar grupo</button>
      </form>
      ${grupos.length ? `<div class="tabela-wrap"><table class="cartoes"><thead><tr><th>Nome</th><th class="num">Categorias</th><th></th></tr></thead>
        <tbody>${grupos.map((g) => `<tr data-grupo="${g.id}" data-nome="${esc(g.nome)}">
          <td class="c-titulo"><input class="nome-inline" data-nome-grupo value="${esc(g.nome)}" maxlength="40" aria-label="Renomear ${esc(g.nome)}"></td>
          <td class="num c-meio" data-rot="categorias">${g.categorias}</td>
          <td class="acoes c-acao"><button class="link perigo" data-apagar-grupo>apagar</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
    </section>
    <section class="painel"><div class="tabela-wrap"><table class="cartoes">
      <thead><tr><th>Cor</th><th>Nome</th><th>Grupo</th><th class="num">Lançamentos</th><th class="num">Total</th><th class="num">% do total</th>
        <th class="num col-sec">Regras</th><th class="num">Limite mensal</th><th class="col-sec">Último</th><th></th></tr></thead>
      <tbody>${cats.map((c) => `<tr data-id="${c.id}" data-nome="${esc(c.nome)}" data-qtd="${c.qtd}" data-regras="${c.regras}">
        <td class="c-meio"><input type="color" data-cor value="${esc(c.cor || '#888888')}" aria-label="Cor de ${esc(c.nome)}"></td>
        <td class="c-titulo"><input class="nome-inline" data-nome-input value="${esc(c.nome)}" maxlength="40" aria-label="Renomear ${esc(c.nome)}"></td>
        <td class="c-fim"><select data-grupo-sel aria-label="Grupo de ${esc(c.nome)}">${optsGrupo(c.grupoId)}</select></td>
        <td class="num c-meio" data-rot="lançamentos">${c.qtd}</td><td class="num c-valor">${brl(c.total)}</td>
        <td class="num c-meio">${total ? pct(c.total / total) : '—'}</td>
        <td class="num c-oculta col-sec">${c.regras}</td>
        <td class="num c-oculta">${c.limite ? brl(c.limite) : '<span class="muted">—</span>'}</td>
        <td class="c-oculta col-sec">${c.ultimo ? dataBR(c.ultimo) : '<span class="muted">—</span>'}</td>
        <td class="acoes c-acao"><a href="#/categoria/${c.id}">ver</a> · <button class="link perigo" data-apagar>apagar</button></td>
      </tr>`).join('')}</tbody></table></div></section>
    <dialog id="dlg-apagar"><form method="dialog" id="form-apagar">
      <h2>Apagar categoria <span id="dlg-nome"></span></h2>
      <p id="dlg-info"></p>
      <label>O que fazer com os lançamentos, regras e orçamento dela?
        <select name="moverPara"><option value="">Deixar os lançamentos sem categoria e apagar as regras</option>
          ${cats.map((c) => `<option value="${c.id}">Mover para “${esc(c.nome)}”</option>`).join('')}</select></label>
      <p class="muted">Lançamentos que ficarem sem categoria são reavaliados pelas outras regras.</p>
      <div class="barra-acoes"><button value="cancelar">Cancelar</button><button class="primario perigo-btn" value="apagar">Apagar categoria</button></div>
    </form></dialog>`;

  document.getElementById('form-cat').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/categorias', { method: 'POST', body: { nome: d.nome, cor: d.cor } }), `Categoria “${d.nome.trim()}” criada`);
  });
  document.getElementById('form-grupo').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = new FormData(e.target).get('nome');
    acao(() => api('/api/grupos', { method: 'POST', body: { nome } }), `Grupo “${nome.trim()}” criado`);
  });
  $app.querySelectorAll('tr[data-grupo]').forEach((tr) => {
    const id = Number(tr.dataset.grupo);
    aoEditar(tr.querySelector('[data-nome-grupo]'), (nome) =>
      acao(() => api(`/api/grupos/${id}`, { method: 'PUT', body: { nome } }), `Grupo renomeado para “${nome.trim()}”`));
    tr.querySelector('[data-apagar-grupo]').addEventListener('click', async () => {
      if (await confirmar(`Apagar o grupo “${tr.dataset.nome}”?`, 'As categorias dele ficam sem grupo.')) {
        acao(() => api(`/api/grupos/${id}`, { method: 'DELETE' }), 'Grupo apagado');
      }
    });
  });
  const dlg = document.getElementById('dlg-apagar');
  $app.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('[data-grupo-sel]').addEventListener('change', (e) =>
      acao(() => api(`/api/categorias/${id}`, { method: 'PUT', body: { grupoId: e.target.value ? Number(e.target.value) : null } }),
        e.target.value ? `Categoria colocada em “${e.target.selectedOptions[0].text}”` : 'Categoria sem grupo'));
    tr.querySelector('[data-cor]').addEventListener('change', (e) =>
      acao(() => api(`/api/categorias/${id}`, { method: 'PUT', body: { cor: e.target.value } }), 'Cor salva'));
    aoEditar(tr.querySelector('[data-nome-input]'), (nome) =>
      acao(() => api(`/api/categorias/${id}`, { method: 'PUT', body: { nome } }), `Renomeada para “${nome.trim()}”`));
    tr.querySelector('[data-apagar]').addEventListener('click', () => {
      document.getElementById('dlg-nome').textContent = `“${tr.dataset.nome}”`;
      document.getElementById('dlg-info').textContent =
        `Ela tem ${tr.dataset.qtd} lançamento(s) e ${tr.dataset.regras} regra(s).`;
      const sel = dlg.querySelector('select');
      sel.value = '';
      [...sel.options].forEach((o) => { o.hidden = o.value === String(id); });
      dlg.returnValue = '';
      dlg.showModal();
      dlg.onclose = () => {
        if (dlg.returnValue !== 'apagar') return;
        const mover = sel.value;
        acao(() => api(`/api/categorias/${id}${mover ? `?moverPara=${mover}` : ''}`, { method: 'DELETE' }),
          (x) => x.movidosPara ? `Categoria apagada; ${x.lancamentos} lançamentos movidos para “${x.movidosPara}”`
            : `Categoria apagada; ${x.semCategoria} lançamentos sem categoria no total`);
      };
    });
  });
}

async function telaBancos() {
  const [bancos, parcelas] = await Promise.all([api('/api/bancos'), api('/api/parcelas')]);
  const parcelasPorBanco = parcelas.parcelamentos.reduce((m, p) => ({ ...m, [p.banco]: (m[p.banco] ?? 0) + p.restanteCentavos }), {});
  const reais = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  $app.innerHTML = `
    ${abasConfig('bancos')}
    <h1>Bancos e cartões</h1>
    <p class="sub">Nome e cor aparecem em todo o painel (filtros, tabelas e gráficos). Os lançamentos continuam ligados ao banco pelo código.</p>
    <div class="cartoes-banco">${bancos.map((b) => `
      <section class="painel" data-codigo="${esc(b.codigo)}">
        <form class="form-banco">
          <div class="lista-linha">
            <h2>${bolinha(b.cor || corBanco(b.codigo))} ${esc(b.nome)}</h2>
            <span class="muted">código: <code>${esc(b.codigo)}</code></span>
          </div>
          <div class="campos">
            <label>Nome<input name="nome" required maxlength="40" value="${esc(b.nome)}"></label>
            <label>Cor<input type="color" name="cor" value="${esc(b.cor || corHex(corBanco(b.codigo)))}"></label>
            <label>Dia de fechamento<input name="diaFechamento" type="number" min="1" max="31" value="${b.dia_fechamento ?? ''}" placeholder="—"></label>
            <label>Dia de vencimento<input name="diaVencimento" type="number" min="1" max="31" value="${b.dia_vencimento ?? ''}" placeholder="—"></label>
            <label>Limite do cartão (R$)<input name="limite" data-moeda inputmode="numeric" value="${reais(b.limite_centavos)}" placeholder="—"></label>
            <label class="largo">Observação<input name="observacao" maxlength="200" value="${esc(b.observacao ?? '')}" placeholder="opcional"></label>
          </div>
          <dl class="numeros">
            <div><dt>Lançamentos</dt><dd>${b.lancamentos}</dd></div>
            <div><dt>Faturas</dt><dd>${b.faturas}${b.ultima_fatura ? ` <span class="muted">até ${mes(b.ultima_fatura)}</span>` : ''}</dd></div>
            <div><dt>Gasto total</dt><dd>${brl(b.total)}</dd></div>
            <div><dt>Parcelas a pagar</dt><dd>${brl(parcelasPorBanco[b.codigo] ?? 0)}${b.limite_centavos
              ? ` <span class="muted">(${pct((parcelasPorBanco[b.codigo] ?? 0) / b.limite_centavos)} do limite)</span>` : ''}</dd></div>
          </dl>
          ${b.cartoes.length ? `<h3>Cartões</h3><div class="campos">${b.cartoes.map((c) => `
            <label>•${esc(c.final)} <span class="muted">(${c.lancamentos} lanç.)</span>
              <input data-cartao="${esc(c.final)}" maxlength="30" value="${esc(c.apelido ?? '')}" placeholder="apelido, ex.: Virtual"></label>`).join('')}</div>` : ''}
          <div class="barra-acoes">
            <button class="primario">Salvar</button>
            ${b.lancamentos ? '<span class="muted">Bancos com lançamentos não podem ser apagados.</span>'
              : '<button type="button" class="link perigo" data-apagar-banco>apagar banco</button>'}
          </div>
        </form>
      </section>`).join('')}</div>
    <section class="painel"><h2>Novo banco</h2>
      <p class="muted">Para cadastrar antes de importar. Só Nubank (CSV) e Inter (PDF) têm importador por enquanto.</p>
      <form class="inline" id="form-novo-banco">
        <input name="nome" required maxlength="40" placeholder="ex.: Itaú" aria-label="Nome do banco">
        <input type="color" name="cor" value="#1baf7a" aria-label="Cor">
        <button class="primario">Criar banco</button>
      </form>
    </section>`;

  $app.querySelectorAll('section[data-codigo]').forEach((sec) => {
    const codigo = sec.dataset.codigo;
    const form = sec.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      let limiteCentavos;
      try { limiteCentavos = lerValor(d.limite); } catch { return aviso('Limite inválido', true); }
      const dia = (v) => (v === '' ? null : Number(v));
      const apelidos = [...form.querySelectorAll('[data-cartao]')].filter((i) => i.value !== i.defaultValue);
      acao(async () => {
        await api(`/api/bancos/${encodeURIComponent(codigo)}`, { method: 'PUT', body: {
          nome: d.nome, cor: d.cor, diaFechamento: dia(d.diaFechamento), diaVencimento: dia(d.diaVencimento),
          limiteCentavos, observacao: d.observacao,
        } });
        for (const i of apelidos) {
          await api(`/api/bancos/${encodeURIComponent(codigo)}/cartoes/${encodeURIComponent(i.dataset.cartao)}`,
            { method: 'PUT', body: { apelido: i.value } });
        }
      }, `${d.nome.trim()} salvo`);
    });
    sec.querySelector('[data-apagar-banco]')?.addEventListener('click', async () => {
      if (await confirmar('Apagar banco?', 'Ele sai do cadastro.')) {
        acao(() => api(`/api/bancos/${encodeURIComponent(codigo)}`, { method: 'DELETE' }), 'Banco apagado');
      }
    });
  });
  document.getElementById('form-novo-banco').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/bancos', { method: 'POST', body: { nome: d.nome, cor: d.cor } }), `Banco “${d.nome.trim()}” criado`);
  });
}

/** Converte uma cor CSS qualquer (ex.: valor de variável) para #rrggbb, para o <input type="color">. */
function corHex(cor) {
  if (/^#[0-9a-f]{6}$/i.test(cor)) return cor;
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = cor;
  return /^#[0-9a-f]{6}$/i.test(c.fillStyle) ? c.fillStyle : '#888888';
}

// ---------- regras e etiquetas ----------

async function telaRegras() {
  const [cats, regras, etiquetas] = await Promise.all([api('/api/categorias'), api('/api/regras'), api('/api/etiquetas')]);
  const optsCat = cats.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  $app.innerHTML = `
    ${abasConfig('regras')}
    <h1>Regras e etiquetas</h1>
    <p class="sub">Uma regra classifica automaticamente todo lançamento cuja descrição contém o texto.
      Regras suas têm prioridade sobre as padrão; lançamentos com categoria manual nunca são alterados.</p>
    <div>
      <section class="painel bloco"><h2>Nova regra</h2>
        <form class="inline" id="form-regra">
          <input name="padrao" required minlength="2" placeholder="texto, ex.: CARREFOUR">
          <select name="categoriaId" required>${optsCat}</select>
          <select name="banco"><option value="">todos os bancos</option>${opcoes.bancos.map((b) => `<option value="${b}">${nomeBanco(b)}</option>`).join('')}</select>
          <label><input type="checkbox" name="regex"> regex</label>
          <button class="primario">Salvar regra</button>
        </form>
      </section>
    </div>
    <section class="painel bloco"><h2>Etiquetas (${etiquetas.length})</h2>
      ${etiquetas.length ? `<div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Etiqueta</th><th class="num">Lançamentos</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${etiquetas.map((e) => `<tr><td class="c-titulo"><a href="#/transacoes?etiqueta=${e.id}">${esc(e.nome)}</a></td>
          <td class="num c-meio" data-rot="lançamentos">${e.qtd}</td><td class="num c-valor">${brl(e.total)}</td>
          <td class="c-acao"><button class="link" data-remover-etq="${e.id}">remover</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma etiqueta. Crie pela tela de Transações (“+ etiqueta” ou selecionando várias linhas).</p>'}
    </section>
    <section class="painel"><div class="titulo-acoes"><h2>Regras (${regras.length})</h2>
        <input type="search" id="busca-regra" placeholder="filtrar por texto ou categoria" aria-label="Filtrar regras"></div>
      <div class="tabela-wrap"><table class="cartoes">
        <thead><tr><th>Contém</th><th>Categoria</th><th>Banco</th><th>Origem</th><th class="num">Em uso</th><th></th></tr></thead>
        <tbody>${regras.map((r) => `<tr data-busca="${esc(`${r.padrao} ${r.categoria}`.toLowerCase())}">
          <td class="c-titulo"><code>${esc(r.padrao)}</code>${r.tipo_match === 'regex' ? ' <span class="selo">regex</span>' : ''}</td>
          <td class="c-meio"><a href="#/categorias">${esc(r.categoria)}</a></td><td class="c-meio">${r.banco ? nomeBanco(r.banco) : 'todos'}</td>
          <td class="c-meio">${r.origem === 'usuario' ? '<span class="selo manual">sua</span>' : '<span class="selo">padrão</span>'}</td>
          <td class="num c-valor" data-rot="em uso">${r.usos}</td>
          <td class="c-acao"><button class="link" data-remover="${r.id}">remover</button></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" id="regras-vazio" hidden>Nenhuma regra com esse texto.</p>
    </section>`;

  document.getElementById('form-regra').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/regras', { method: 'POST', body: { padrao: d.padrao, categoriaId: Number(d.categoriaId), banco: d.banco || null, regex: !!d.regex } }),
      (r) => `Regra salva · ${r.semCategoria} lançamentos ainda sem categoria`);
  });
  const linhasRegra = [...$app.querySelectorAll('tr[data-busca]')];
  document.getElementById('busca-regra').addEventListener('input', (e) => {
    const termo = e.target.value.trim().toLowerCase();
    linhasRegra.forEach((tr) => { tr.hidden = !tr.dataset.busca.includes(termo); });
    document.getElementById('regras-vazio').hidden = linhasRegra.some((tr) => !tr.hidden);
  });
  $app.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Remover regra?', 'Os lançamentos classificados por ela voltam a ser avaliados pelas outras regras.', { botao: 'Remover' })) {
      acao(() => api(`/api/regras/${b.dataset.remover}`, { method: 'DELETE' }), 'Regra removida');
    }
  }));
  $app.querySelectorAll('[data-remover-etq]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Remover etiqueta?', 'Ela sai de todos os lançamentos.', { botao: 'Remover' })) {
      acao(() => api(`/api/etiquetas/${b.dataset.removerEtq}`, { method: 'DELETE' }), 'Etiqueta removida');
    }
  }));
}

const TELAS = {
  '': telaVisaoGeral, transacoes: telaTransacoes, categoria: telaCategoria, parcelas: telaParcelas,
  assinaturas: telaAssinaturas, orcamento: telaOrcamento, importar: telaImportar, regras: telaRegras,
  desconsiderados: telaDesconsiderados, categorias: telaCategorias, bancos: telaBancos, patrimonio: telaPatrimonio,
  renda: telaRenda, medias: telaMedias,
};

async function render() {
  renderSeq++;
  const r = rotaAtual();
  const ativo = [...document.querySelectorAll('#menu nav a')].map((a) => {
    a.classList.toggle('ativo', a.dataset.rota.split(' ').includes(r.rota));
    if (a.classList.contains('ativo')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    return a;
  }).find((a) => a.classList.contains('ativo'));
  document.getElementById('pagina-atual').textContent = ativo?.textContent ?? (r.rota === 'categoria' ? 'Categoria' : '');
  descartarGraficos();
  try {
    if (!opcoes) await carregarOpcoes();
    await (TELAS[r.rota] ?? telaVisaoGeral)(r);
  } catch (err) {
    if (err instanceof Obsoleto) return;
    $app.innerHTML = `<p class="erro">Erro ao carregar: ${esc(err.message)}</p>`;
  }
}

// ---------- menu lateral ----------

const $menu = document.getElementById('menu');
const $abrirMenu = document.getElementById('abrir-menu');
// Desktop largo: o menu fica sempre à mostra (CSS), então nunca é inerte nem "abre".
const menuFixo = matchMedia('(min-width: 1100px)');
function menu(aberto) {
  if (menuFixo.matches) aberto = false;
  $menu.classList.toggle('aberta', aberto);
  $menu.inert = !aberto && !menuFixo.matches;
  document.getElementById('fundo-menu').hidden = !aberto;
  document.body.classList.toggle('menu-aberto', aberto);
  $abrirMenu.setAttribute('aria-expanded', aberto);
  if (aberto) ($menu.querySelector('nav a.ativo') ?? $menu.querySelector('nav a')).focus();
  else if (!menuFixo.matches && $menu.contains(document.activeElement)) $abrirMenu.focus();
}
$abrirMenu.addEventListener('click', () => menu(true));
document.getElementById('fechar-menu').addEventListener('click', () => menu(false));
document.getElementById('fundo-menu').addEventListener('click', () => menu(false));
$menu.addEventListener('click', (e) => { if (e.target.closest('nav a')) menu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && $menu.classList.contains('aberta')) menu(false); });
menuFixo.addEventListener('change', () => menu(false));
menu(false);

// ---------- tema ----------
// Sem escolha salva, segue o sistema; o script no <head> aplica a escolha antes de pintar.
const $tema = document.getElementById('alternar-tema');
const temaEscuro = () => (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const marcarTema = () => $tema.setAttribute('aria-checked', String(temaEscuro()));
$tema.addEventListener('click', () => {
  const tema = temaEscuro() ? 'light' : 'dark';
  document.documentElement.dataset.theme = tema;
  try { localStorage.setItem('tema', tema); } catch { /* sem armazenamento: vale só nesta visita */ }
  marcarTema();
  render(); // os gráficos leem as cores do tema ao desenhar
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', marcarTema);
marcarTema();

addEventListener('hashchange', () => { scrollTo(0, 0); render(); });
// Ao abrir o painel, as telas com filtro de período começam no último mês (não em "Todos").
const ROTAS_COM_PERIODO = ['', 'categoria', 'renda', 'transacoes', 'desconsiderados'];
addEventListener('DOMContentLoaded', async () => {
  const { rota } = rotaAtual();
  if (!location.hash.includes('?') && ROTAS_COM_PERIODO.includes(rota)) {
    try {
      await carregarOpcoes();
      const ultimo = opcoes.referencias.at(-1);
      const caminho = location.hash.replace(/^#\/?/, '');
      if (ultimo) history.replaceState(null, '', `#/${caminho}?${qs({ de: ultimo, ate: ultimo })}`);
    } catch { /* sem opções: abre sem filtro */ }
  }
  render();
});
