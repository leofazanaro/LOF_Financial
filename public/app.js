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

/** "1.234,56" | "900" | "R$ 50,5" -> centavos; vazio -> null */
function lerValor(txt) {
  const s = String(txt).replace(/R\$|\s/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Valor inválido');
  return Math.round(n * 100);
}

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

/** Barra de filtros: período (mês da fatura), banco, cartão e, opcionalmente, categoria, etiqueta e busca. */
function barraFiltros(filtros, { periodo = true, categoria = false, etiqueta = false, busca = false } = {}) {
  const sel = (nome, rotulo, itens, todos = 'Todos') => `
    <label>${rotulo}
      <select name="${nome}">
        <option value="">${todos}</option>
        ${itens.map(([v, t]) => `<option value="${esc(v)}" ${String(filtros[nome] ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
    </label>`;
  const refs = opcoes.referencias.map((r) => [r, mes(r)]);
  return `${periodo ? seletorMes(filtros) : ''}<form class="filtros" data-filtros>
    ${periodo ? sel('de', 'De (fatura)', refs, 'Início') + sel('ate', 'Até (fatura)', refs, 'Fim') : ''}
    ${sel('banco', 'Banco', opcoes.bancos.map((b) => [b, nomeBanco(b)]))}
    ${sel('cartao', 'Cartão', opcoes.cartoes.map((c) => [c.cartao_final, `${nomeBanco(c.banco)} ${nomeCartao(c.banco, c.cartao_final)}`]))}
    ${categoria ? sel('categoria', 'Categoria', [['sem', 'Sem categoria'], ...opcoes.categorias.map((c) => [c.id, c.nome])], 'Todas') : ''}
    ${etiqueta && opcoes.etiquetas.length ? sel('etiqueta', 'Etiqueta', opcoes.etiquetas.map((e) => [e.id, e.nome]), 'Todas') : ''}
    ${busca ? `<label>Busca<input type="search" name="q" value="${esc(filtros.q ?? '')}" placeholder="descrição ou apelido"></label>` : ''}
    ${Object.keys(filtros).length ? '<button type="button" class="link" data-limpar>Limpar filtros</button>' : ''}
  </form>`;
}

/**
 * Atalho de mês: um clique filtra só aquele mês da fatura (de = até = mês).
 * "Todos" limpa o período; as setas andam um mês para trás/frente.
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
  const chips = refs.map((r) => {
    const sep = r.slice(0, 4) !== ano ? `<span class="meses-ano">${(ano = r.slice(0, 4))}</span>` : '';
    return `${sep}<button type="button" class="chip-mes ${r === atual ? 'ativo' : ''}" data-mes="${r}"
      aria-pressed="${r === atual}" title="${mes(r)}">${MESES[Number(r.slice(5, 7)) - 1]}</button>`;
  }).join('');
  return `<div class="meses" data-meses role="group" aria-label="Filtrar por mês da fatura">
    <button type="button" class="chip-mes seta" data-mes="${anterior ?? ''}" ${anterior ? '' : 'disabled'} aria-label="Mês anterior">‹</button>
    <div class="meses-lista">
      <button type="button" class="chip-mes ${semPeriodo ? 'ativo' : ''}" data-mes="todos" aria-pressed="${semPeriodo}">Todos</button>
      ${chips}
    </div>
    <button type="button" class="chip-mes seta" data-mes="${proximo ?? ''}" ${proximo ? '' : 'disabled'} aria-label="Próximo mês">›</button>
  </div>`;
}

function ligarFiltros(rota) {
  const form = $app.querySelector('[data-filtros]');
  if (!form) return;
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
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

const eixoBase = () => ({
  axisLine: { lineStyle: { color: css('--border') } },
  axisTick: { show: false },
  axisLabel: { color: css('--text-2') },
  splitLine: { lineStyle: { color: css('--grid') } },
});
const tooltipBase = () => ({
  backgroundColor: css('--surface'), borderColor: css('--border'), textStyle: { color: css('--text') },
  // Fica dentro do gráfico (senão corta na borda da tela) e quebra linha se não couber.
  confine: true, extraCssText: 'max-width: 100%; white-space: normal;',
});

/** Barras horizontais, uma cor só: o comprimento já mostra a grandeza. */
function graficoCategorias(el, porCategoria, aoClicar) {
  const dados = [...porCategoria].reverse();
  const total = dados.reduce((s, d) => s + d.total, 0);
  const parte = (v) => (total ? `${((v / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '');
  const g = novoGrafico(el);
  el.style.height = `${Math.max(220, dados.length * 34 + 40)}px`;
  g.resize();
  g.setOption({
    grid: { left: 8, right: 140, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(), trigger: 'item', formatter: (p) => `${esc(p.name)}<br><b>${brl(p.value)}</b> · ${parte(p.value)} do total · ${dados[p.dataIndex].qtd} lançamentos` },
    xAxis: { type: 'value', ...eixoBase(), axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: dados.map((d) => d.nome), ...eixoBase() },
    series: [{
      type: 'bar', barMaxWidth: 22, cursor: 'pointer',
      data: dados.map((d) => ({
        value: d.total,
        itemStyle: { color: d.id == null ? css('--series-4') : css('--series-1'), borderRadius: [0, 4, 4, 0] },
      })),
      label: { show: true, position: 'right', color: css('--text-2'), formatter: (p) => `${brl(p.value)} · ${parte(p.value)}` },
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
  const camadas = Math.max(0, ...grupos.map((g) => g.itens.length));
  const series = Array.from({ length: camadas }, (_, i) => ({
    type: 'bar', stack: 'grupo', barMaxWidth: 22, cursor: 'pointer',
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
    label: { show: true, position: 'right', color: css('--text-2'),
      formatter: (p) => `${brl(grupos[p.dataIndex].total)} · ${pctDe(grupos[p.dataIndex].total, total)}` },
  });

  const g = novoGrafico(el);
  el.style.height = `${Math.max(220, grupos.length * 34 + 40)}px`;
  g.resize();
  g.setOption({
    grid: { left: 8, right: 140, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase(), trigger: 'item',
      formatter: (p) => {
        const { categoria: c, grupo } = p.data;
        const dentro = grupo.itens.length > 1 ? ` · ${pctDe(c.total, grupo.total)} de ${esc(grupo.nome)}` : '';
        return `${p.marker}${esc(c.nome)}<br><b>${brl(c.total)}</b>${dentro} · ${pctDe(c.total, total)} do total · ${c.qtd} lançamentos`;
      },
    },
    xAxis: { type: 'value', ...eixoBase(), axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: grupos.map((x) => x.nome), ...eixoBase() },
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
    legend: { top: 0, left: 0, textStyle: { color: css('--text-2') }, icon: 'roundRect', show: bancos.length > 1 },
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
  return `<div class="tabela-wrap"><table>
    <thead><tr><th>Data</th><th>Banco</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
    <tbody>${linhas.map((t) => `<tr>
      <td>${dataBR(t.data)}</td><td>${nomeBanco(t.banco)}</td>
      <td>${esc(t.descricao)}${t.parcela_total ? ` <span class="muted">${t.parcela_atual}/${t.parcela_total}</span>` : ''}</td>
      <td>${t.categoria ? esc(t.categoria) : '<span class="selo sem">sem categoria</span>'}</td>
      <td class="num">${brl(t.valor_centavos)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- visão geral ----------

async function telaVisaoGeral({ filtros }) {
  const [r, parcelas, orc, comp] = await Promise.all([
    api(`/api/resumo?${qs(filtros)}`),
    api(`/api/parcelas?${qs({ banco: filtros.banco, cartao: filtros.cartao })}`),
    api(`/api/orcamento?${qs({ referencia: filtros.ate })}`),
    api(`/api/comparacao?${qs(filtros)}`),
  ]);
  if (!r.qtd && !Object.keys(filtros).length) {
    $app.innerHTML = `<h1>Visão geral</h1><p class="sub">Nenhuma fatura importada ainda. <a href="#/importar">Importe um CSV ou PDF</a>.</p>`;
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
            <div class="tabela-wrap"><table><thead><tr><th>Categoria</th><th class="num">Este mês</th><th class="num">Média</th><th>Variação</th></tr></thead>
            <tbody>${comp.itens.slice(0, 8).map((i) => `<tr><td>${esc(i.nome)}</td><td class="num">${brl(i.atual)}</td>
              <td class="num">${i.media == null ? '—' : brl(i.media)}</td><td>${variacao(i)}</td></tr>`).join('')}</tbody></table></div>`
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
      <label>Valor (R$)<input name="valor" required inputmode="decimal" value="${reaisCampo(t.valor_centavos)}" placeholder="ex.: 1.500,00"></label>
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
      <button id="lote-aplicar-cat">Aplicar categoria</button>
      <input id="lote-etiqueta" list="lista-etiquetas" placeholder="etiqueta, ex.: viagem" maxlength="40">
      <button id="lote-aplicar-etq">Etiquetar</button>
      <button id="lote-desconsiderar" title="Tirar dos relatórios e totais">⊘ Desconsiderar</button>
      <button class="link" id="lote-limpar">limpar seleção</button>
    </div>
    <datalist id="lista-etiquetas">${opcoes.etiquetas.map((e) => `<option value="${esc(e.nome)}">`).join('')}</datalist>
    <div class="tabela-wrap"><table>
      <thead><tr><th><input type="checkbox" id="sel-todas" aria-label="Selecionar todas"></th>
        <th>Data</th><th>Banco</th><th>Descrição</th><th class="num">Valor</th><th>Categoria</th><th>Origem</th></tr></thead>
      <tbody>${lista.map((t) => `<tr data-id="${t.id}" data-chave="${esc(t.chave)}" data-nome="${esc(t.apelido ?? t.descricao)}" class="${t.categoria_id ? '' : 'pendente'}">
        <td><input type="checkbox" data-sel aria-label="Selecionar"></td>
        <td>${dataBR(t.data)}<div class="muted">${t.manual ? 'vencimento' : `fatura ${mes(t.referencia)}`}</div></td>
        <td>${nomeBanco(t.banco)}${t.cartao_final ? `<div class="muted">${esc(nomeCartao(t.banco, t.cartao_final))}</div>` : ''}</td>
        <td class="desc">
          <b>${esc(t.apelido ?? t.descricao)}</b>${t.parcela_total ? ` <span class="muted">parcela ${t.parcela_atual}/${t.parcela_total}</span>` : ''}
          <button class="link" data-apelido title="Dar um apelido a este estabelecimento (vale para todas as faturas)">✎ apelido</button>
          ${t.categoria_id ? '' : linkBusca(t.descricao)}
          <div class="muted" title="Texto exatamente como veio do banco">${t.apelido ? `${esc(t.descricao)} · ` : ''}original: ${esc(t.descricao_original)}</div>
          <div class="chips">${t.etiquetas.map((e) => `<span class="chip">${esc(e.nome)}<button data-tirar="${e.id}" aria-label="Remover etiqueta ${esc(e.nome)}">×</button></span>`).join('')}
            <button class="link" data-etiquetar>+ etiqueta</button></div>
        </td>
        <td class="num">${brl(t.valor_centavos)}</td>
        <td><select aria-label="Categoria" data-categoria>${opts(t.categoria_id)}</select></td>
        <td>${seloOrigem(t)}
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
    tr.querySelector('[data-apelido]').addEventListener('click', () => {
      const novo = prompt('Apelido para este estabelecimento (vale para todas as faturas). Deixe vazio para remover.', tr.dataset.nome);
      if (novo === null) return;
      acao(() => api('/api/apelidos', { method: 'PUT', body: { chave: tr.dataset.chave, apelido: novo } }),
        novo.trim() ? 'Apelido salvo' : 'Apelido removido');
    });
    tr.querySelector('[data-etiquetar]').addEventListener('click', () => {
      const nome = prompt(`Etiqueta (existentes: ${opcoes.etiquetas.map((e) => e.nome).join(', ') || 'nenhuma'})`);
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
    tr.querySelector('[data-apagar-conta]')?.addEventListener('click', () => {
      if (confirm(`Apagar a conta “${tr.dataset.nome}”?`)) acao(() => api(`/api/contas/${id}`, { method: 'DELETE' }), 'Conta apagada');
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
function desconsiderar(ids) {
  const motivo = prompt(`Desconsiderar ${ids.length} lançamento${ids.length > 1 ? 's' : ''}? Eles saem de relatórios, totais e análises ` +
    'e ficam na tela “Desconsiderados”.\n\nMotivo (opcional):', '');
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
      ${lista.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th><input type="checkbox" id="sel-todas-d" aria-label="Selecionar todos"></th>
          <th>Data</th><th>Banco</th><th>Descrição</th><th class="num">Valor</th><th>Motivo</th><th>Decisão</th><th></th></tr></thead>
        <tbody>${lista.map((t) => `<tr data-id="${t.id}">
          <td><input type="checkbox" data-sel-d aria-label="Selecionar"></td>
          <td>${dataBR(t.data)}<div class="muted">${t.manual ? 'vencimento' : `fatura ${mes(t.referencia)}`}</div></td>
          <td>${nomeBanco(t.banco)}${t.cartao_final ? `<div class="muted">${esc(nomeCartao(t.banco, t.cartao_final))}</div>` : ''}</td>
          <td><b>${esc(t.apelido ?? t.descricao)}</b>${t.parcela_total ? ` <span class="muted">parcela ${t.parcela_atual}/${t.parcela_total}</span>` : ''}
            <div class="muted">original: ${esc(t.descricao_original)}${t.categoria ? ` · ${esc(t.categoria)}` : ''}</div></td>
          <td class="num">${brl(t.valor_centavos)}</td>
          <td>${t.motivo ? esc(t.motivo) : '<span class="muted">—</span>'}</td>
          <td>${t.origem === 'manual' ? '<span class="selo manual">manual</span>' : '<span class="selo">automática</span>'}</td>
          <td class="acoes">${t.origem === 'manual'
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
      ${regras.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Contém</th><th>Banco</th><th>Valores</th><th>Motivo</th><th class="num">Em uso</th><th></th></tr></thead>
        <tbody>${regras.map((x) => `<tr><td><code>${esc(x.padrao)}</code>${x.tipo_match === 'regex' ? ' <span class="selo">regex</span>' : ''}</td>
          <td>${x.banco ? nomeBanco(x.banco) : 'todos'}</td><td>${x.so_creditos ? 'só créditos' : 'todos'}</td>
          <td>${x.motivo ? esc(x.motivo) : '<span class="muted">—</span>'}</td><td class="num">${x.usos}</td>
          <td><button class="link" data-remover-rd="${x.id}">remover</button></td></tr>`).join('')}</tbody></table></div>`
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
  $app.querySelectorAll('[data-remover-rd]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Remover esta regra? Os lançamentos desconsiderados por ela voltam aos relatórios.')) {
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
      ${p.parcelamentos.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Compra</th><th>Banco</th><th>Categoria</th><th class="num">Parcela</th><th>Andamento</th><th class="num">Valor/mês</th><th class="num">Falta pagar</th><th>Última parcela</th></tr></thead>
        <tbody>${p.parcelamentos.map((x) => `<tr>
          <td>${esc(x.nome)}${x.qtd > 1 ? ` <span class="selo">×${x.qtd}</span>` : ''}</td>
          <td>${nomeBanco(x.banco)}${x.cartao ? ` <span class="muted">•${x.cartao}</span>` : ''}</td>
          <td>${x.categoria ? esc(x.categoria) : '<span class="muted">—</span>'}</td>
          <td class="num">${x.parcelaAtual}/${x.parcelaTotal}</td>
          <td><div class="progresso" role="img" aria-label="${x.parcelaAtual} de ${x.parcelaTotal} pagas"><div class="progresso-fill" style="width:${(x.parcelaAtual / x.parcelaTotal) * 100}%"></div></div></td>
          <td class="num">${brl(x.valorParcela * x.qtd)}</td>
          <td class="num">${brl(x.restanteCentavos)}</td>
          <td>${mes(x.terminaEm)}</td></tr>`).join('')}</tbody></table></div>`
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
      ${a.ativas.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>Banco</th><th class="num">Valor/mês</th><th>Desde</th><th>Última cobrança</th><th></th></tr></thead>
        <tbody>${a.ativas.map((s) => `<tr data-id="${s.id}" data-banco="${esc(s.banco)}" data-chave="${esc(s.chave)}" data-nome="${esc(s.nome)}">
          <td><b>${esc(s.nome)}</b> <button class="link" data-renomear>✎</button><div class="muted">${esc(s.chave)}</div></td>
          <td>${nomeBanco(s.banco)}</td><td class="num">${brl(s.valorMensal)}</td>
          <td>${s.primeiraCobranca ? mes(s.primeiraCobranca) : '—'}</td><td>${s.ultimaCobranca ? mes(s.ultimaCobranca) : '—'}</td>
          <td><button class="link" data-remover>remover</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma assinatura confirmada ainda.</p>'}
    </section>
    <section class="painel"><h2>Sugestões (${a.sugestoes.length})</h2>
      ${a.sugestoes.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Estabelecimento</th><th>Banco</th><th class="num">Último valor</th><th>Por quê</th><th></th></tr></thead>
        <tbody>${a.sugestoes.map((s) => `<tr data-banco="${esc(s.banco)}" data-chave="${esc(s.chave)}" data-nome="${esc(s.nome)}">
          <td>${esc(s.nome)}</td><td>${nomeBanco(s.banco)}</td><td class="num">${brl(s.valor)}</td>
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
  $app.querySelectorAll('[data-renomear]').forEach((b) => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    const nome = prompt('Nome da assinatura', tr.dataset.nome);
    if (nome?.trim()) acao(() => salvar(tr, 'ativa', nome), 'Nome salvo');
  }));
  $app.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Parar de acompanhar esta assinatura? Ela pode voltar a aparecer como sugestão.')) {
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
    <section class="painel"><div class="tabela-wrap"><table>
      <thead><tr><th>Categoria</th><th class="num">Gasto</th><th>Limite mensal</th><th>Uso</th><th>Situação</th></tr></thead>
      <tbody>${linhas.map((i) => `<tr data-cat="${i.id}">
        <td><a href="#/categoria/${i.id}?${qs({ de: orc.referencia, ate: orc.referencia })}">${esc(i.nome)}</a></td>
        <td class="num">${brl(i.gasto)}</td>
        <td><input class="limite" inputmode="decimal" placeholder="sem limite" aria-label="Limite de ${esc(i.nome)}"
          value="${i.limite ? (i.limite / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}"></td>
        <td class="uso">${i.limite ? `${barraProgresso(i)}<span class="muted">${pct(i.pct)} · ${i.disponivel >= 0 ? `sobram ${brl(i.disponivel)}` : `passou ${brl(-i.disponivel)}`}</span>` : ''}</td>
        <td>${seloStatus(i.status)}</td></tr>`).join('')}</tbody></table></div></section>`;

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

/** Fila de arquivos: o usuário junta vários CSV/PDF, revisa a lista e envia; cada arquivo tem seu status. */
const fila = [];
const FORMATOS = ['csv', 'pdf'];
const tamanho = (b) => (b < 1024 * 1024 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
let enviando = false;

async function telaImportar() {
  const hist = await api('/api/importacoes');
  $app.innerHTML = `
    <h1>Importar faturas</h1>
    <p class="sub">Selecione ou arraste vários arquivos de uma vez. Suportados: Nubank (CSV) e Inter (PDF).
      O banco é reconhecido pelo conteúdo e o mesmo arquivo nunca é importado duas vezes.</p>
    <label class="drop" id="drop">
      <strong>Arraste os arquivos aqui</strong> ou clique para escolher
      <input type="file" id="arquivos" accept=".csv,.pdf,text/csv,application/pdf" multiple hidden>
      <span class="muted">CSV ou PDF, até 20 MB cada, vários de uma vez</span>
    </label>
    <section class="painel bloco" id="fila"></section>
    <section class="painel"><h2>Histórico</h2>
      ${hist.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>#</th><th>Arquivo</th><th>Banco</th><th>Fatura</th><th class="num">Lançamentos</th><th class="num">Total impresso</th><th>Importado em</th></tr></thead>
        <tbody>${hist.map((i) => `<tr><td>${i.id}</td><td>${esc(i.arquivo_nome)}</td><td>${nomeBanco(i.banco)}</td>
          <td>${i.referencia ? mes(i.referencia) : '—'}</td><td class="num">${i.qtd_transacoes}</td>
          <td class="num">${i.total_centavos != null ? brl(i.total_centavos) : '—'}</td>
          <td>${esc(i.importado_em)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma importação ainda.</p>'}
    </section>`;

  const drop = document.getElementById('drop');
  const input = document.getElementById('arquivos');
  input.addEventListener('change', () => { adicionarNaFila(input.files); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); adicionarNaFila(e.dataTransfer.files); });
  desenharFila();
}

function adicionarNaFila(files) {
  for (const f of files) {
    if (fila.some((x) => x.arquivo.name === f.name && x.arquivo.size === f.size && x.status !== 'importado')) continue;
    const ext = f.name.split('.').pop().toLowerCase();
    fila.push(FORMATOS.includes(ext)
      ? { arquivo: f, status: 'aguardando' }
      : { arquivo: f, status: 'erro', detalhe: 'Formato não suportado (use CSV ou PDF)' });
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
    <div class="tabela-wrap"><table>
      <thead><tr><th>Arquivo</th><th>Tipo</th><th class="num">Tamanho</th><th>Status</th><th>Detalhes</th><th></th></tr></thead>
      <tbody>${fila.map((x, i) => `<tr>
        <td>${esc(x.arquivo.name)}</td><td>${esc(x.arquivo.name.split('.').pop().toUpperCase())}</td>
        <td class="num">${tamanho(x.arquivo.size)}</td><td>${ROTULO_STATUS[x.status]}</td>
        <td>${detalheFila(x)}</td>
        <td>${x.status === 'aguardando' && !enviando ? `<button class="link" data-tirar-fila="${i}" aria-label="Tirar da lista">×</button>` : ''}</td></tr>`).join('')}</tbody>
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
  const { carteiras, linhas, resumo, objetivo } = ev;
  const modos = [['objetivo', 'Total × objetivo'], ['pct', '% do total'], ['carteiras', 'R$ por carteira'], ['mensal', 'Ganho × aporte por mês']]
    .filter(([m]) => (m !== 'objetivo' || objetivo) && (m !== 'mensal' || linhas.length > 1));
  const modo = modos.some(([m]) => m === modoPatrimonio) ? modoPatrimonio : (objetivo ? 'objetivo' : 'pct');
  const titulos = { objetivo: 'Patrimônio total × objetivo', pct: 'Participação de cada carteira', carteiras: 'Valor de cada carteira', mensal: 'Ganho e aporte por mês' };
  const editandoObjetivo = filtros.objetivo === 'editar' || !objetivo;
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
  const situacao = objetivo?.dataAlvo ? numero('Situação', objetivo.alcancado ? sel(true, 'alcançado')
    : objetivo.noPrazo === true ? sel(true, 'no prazo') : objetivo.noPrazo === false ? sel(false, 'fora do prazo') : '—') : '';

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
      <div class="card"><div class="rot">Aportado no período</div><div class="val">${sinal(resumo.aportadoTotal)}</div></div>
      <div class="card"><div class="rot">Ganho médio por dia</div><div class="val">${resumo.ganhoDiaMedio != null ? brl(resumo.ganhoDiaMedio) : '—'}</div></div>
    </div>` : ''}
    <details class="painel bloco" id="nova-anotacao" ${editando || !linhas.length ? 'open' : ''}>
      <summary><h2>${editando ? `Editar anotação de ${dataBR(editando.data)}` : '+ Nova anotação'}</h2></summary>
      ${ativas.length ? `<form id="form-patrimonio" class="campos">
        <label>Data<input type="date" name="data" required value="${editando?.data ?? hoje}" ${editando ? 'readonly' : ''}></label>
        ${ativas.map((c) => `<label>${bolinha(corCarteira(c, carteiras.indexOf(c)))} ${esc(c.nome)} (R$)
          <input name="c${c.id}" data-carteira-id="${c.id}" inputmode="decimal" value="${reaisCampo(editando?.valores[c.id])}"
            placeholder="${ultima?.valores[c.id] != null ? `último: ${reaisCampo(ultima.valores[c.id])}` : '0,00'}"></label>`).join('')}
        <label>Aporte do período (R$)<input name="aporte" inputmode="decimal" value="${editando ? reaisCampo(editando.aportado) : ''}"
          placeholder="0,00 (resgate: negativo)"></label>
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
      ${modo === 'objetivo' ? '<p class="muted">Escala ajustada ao intervalo dos valores (não começa em zero). Arraste a barra abaixo do gráfico, ou use a roda do mouse, para aproximar um período.</p>'
        : modo === 'mensal' ? `<p class="muted">Ganho: o que o patrimônio rendeu no mês, sem contar aportes. Cada anotação conta no mês da sua data.${linhas.some((l) => l.estimado) ? ' Inclui o histórico estimado.' : ''}</p>`
        : objetivo ? '<p class="muted">O objetivo aparece em <b>Total × objetivo</b>.</p>' : ''}
    </section>` : ''}
    <section class="painel bloco" id="objetivo"><h2>Objetivo${objetivo?.nome ? `: ${esc(objetivo.nome)}` : ''}</h2>
      ${objetivo && !editandoObjetivo ? `
        <div class="lista-linha"><b>${brl(objetivo.atual)} de ${brl(objetivo.valor)}</b>
          <span>${objetivo.alcancado ? sel(true, 'objetivo alcançado') : `${pct(objetivo.progresso)} · faltam ${brl(objetivo.falta)}`}</span></div>
        <div class="progresso grande" role="img" aria-label="${pct(objetivo.progresso)} do objetivo">
          <div class="progresso-fill" style="width:${Math.min(objetivo.progresso, 1) * 100}%"></div></div>
        <dl class="numeros">
          ${numero('Previsão no ritmo atual', objetivo.alcancado ? 'alcançado' : objetivo.dataPrevista ? dataBR(objetivo.dataPrevista) : 'sem crescimento')}
          ${objetivo.desde3m ? numero('Previsão nos últimos 3 meses', objetivo.alcancado ? 'alcançado' : objetivo.dataPrevista3m ? dataBR(objetivo.dataPrevista3m) : 'sem crescimento') : ''}
          ${objetivo.aporteDesejado != null ? numero('Previsão com aporte desejado', objetivo.alcancado ? 'alcançado'
            : objetivo.dataPrevistaPlanejada ? dataBR(objetivo.dataPrevistaPlanejada) : 'sem crescimento') : ''}
          ${situacao}
        </dl>
        <details class="detalhes"><summary>ver detalhes</summary>
          <dl class="numeros">
            ${numero('Ritmo atual', objetivo.ritmoMes != null ? `${objetivo.ritmoMes >= 0 ? '+' : '−'}${brl(Math.abs(objetivo.ritmoMes))}/mês` : '—')}
            ${objetivo.desde3m ? numero('Ritmo nos últimos 3 meses', `${objetivo.ritmo3mMes >= 0 ? '+' : '−'}${brl(Math.abs(objetivo.ritmo3mMes))}/mês`) : ''}
            ${numero('Rendimento médio (sem aportes)', objetivo.taxaMes != null
              ? `${pct2(objetivo.taxaMes)} a.m. <span class="muted">≈ ${brl(objetivo.rendimentoMes)}/mês hoje</span>` : '—')}
            ${objetivo.aporteDesejado != null ? `${numero('Aporte desejado', `${brl(objetivo.aporteDesejado)}/mês`)}
            ${numero(`Aportado em ${mes(objetivo.mesAtual)}`, `${brl(objetivo.aportadoMes)}${objetivo.aporteDesejado
              ? ` <span class="muted">(${pct(objetivo.aportadoMes / objetivo.aporteDesejado)} do desejado)</span>` : ''}`)}` : ''}
            ${objetivo.dataAlvo ? `${numero('Prazo', dataBR(objetivo.dataAlvo))}
            ${numero('Necessário até o prazo', objetivo.alcancado ? '—' : objetivo.necessarioMes != null ? `${brl(objetivo.necessarioMes)}/mês` : 'prazo vencido')}` : ''}
          </dl>
          ${objetivo.aporteDesejado != null ? `<div class="progresso" role="img" aria-label="${pct(objetivo.aportadoMes / (objetivo.aporteDesejado || 1))} do aporte desejado do mês">
            <div class="progresso-fill ${objetivo.aportadoMes >= objetivo.aporteDesejado ? 'st-ok' : ''}" style="width:${Math.min(objetivo.aportadoMes / (objetivo.aporteDesejado || 1), 1) * 100}%"></div></div>` : ''}
          <p class="muted">Ritmo atual: média de crescimento do patrimônio desde ${dataBR(linhas[0].data)}${linhas.some((l) => l.estimado) ? ' (inclui o histórico estimado)' : ''}, com aportes.
            ${objetivo.desde3m ? `Últimos 3 meses: o mesmo cálculo a partir de ${dataBR(objetivo.desde3m)}.` : ''}
            ${objetivo.aporteDesejado != null ? 'Previsão com aporte desejado: o patrimônio rende a taxa média (juros compostos) e recebe o aporte desejado todo mês.' : ''}</p>
        </details>
        <div class="barra-acoes"><a href="#/patrimonio?objetivo=editar">editar objetivo</a>
          <button class="link perigo" id="remover-objetivo">remover</button></div>`
      : `<form id="form-objetivo" class="campos">
          <label>Nome (opcional)<input name="nome" maxlength="60" value="${esc(objetivo?.nome ?? '')}" placeholder="ex.: Independência financeira"></label>
          <label>Valor do objetivo (R$)<input name="valor" required inputmode="decimal" value="${objetivo ? reaisCampo(objetivo.valor) : ''}" placeholder="ex.: 250.000,00"></label>
          <label>Até quando (opcional)<input type="date" name="dataAlvo" value="${objetivo?.dataAlvo ?? ''}"></label>
          <label>Aporte desejado por mês (R$, opcional)<input name="aporteDesejado" inputmode="decimal" value="${objetivo?.aporteDesejado != null ? reaisCampo(objetivo.aporteDesejado) : ''}" placeholder="ex.: 5.000,00"></label>
          <div class="barra-acoes largo"><button class="primario">Salvar objetivo</button>
            ${objetivo ? '<a href="#/patrimonio">cancelar</a>' : '<span class="muted">O objetivo aparece como uma linha no gráfico, com a previsão de quando você chega lá.</span>'}</div>
        </form>`}
    </section>
    ${linhas.length ? `<section class="painel bloco"><div class="lista-linha"><h2>Anotações</h2>
      ${linhas.some((l) => l.estimado) ? `<span><span class="muted">${linhas.filter((l) => l.estimado).length} estimadas a partir dos aportes</span>
        <button class="link perigo" id="apagar-estimados">apagar estimativas</button></span>` : ''}</div>
      <div class="tabela-wrap"><table class="tabela-patrimonio">
      <thead><tr><th>Data</th>${colunas.map((c) => `<th class="num">${bolinha(corCarteira(c, carteiras.indexOf(c)))} ${esc(c.nome)}</th>`).join('')}
        <th class="num">Total</th><th class="num">Variação</th><th class="num">Aportado</th><th class="num">Ganho</th>
        <th class="num">Dias</th><th class="num">Ganho/dia</th><th></th></tr></thead>
      <tbody>${exibidas.map((l) => `<tr data-data="${l.data}" class="${l.estimado ? 'estimado' : ''}">
        <td>${dataBR(l.data)}${l.estimado ? ' <span class="selo" title="Calculado a partir dos aportes e de um rendimento médio; não é um valor real">estimado</span>' : ''}</td>
        ${colunas.map((c) => `<td class="num">${l.valores[c.id] != null ? `${brl(l.valores[c.id])}<div class="muted">${pct(l.participacao[c.id])}</div>` : '—'}</td>`).join('')}
        <td class="num"><b>${brl(l.total)}</b></td>
        <td class="num">${sinal(l.variacao)}</td>
        <td class="num">${l.dias == null && !l.aportado ? '—' : sinal(l.aportado)}</td>
        <td class="num ${classeSinal(l.ganho)}">${sinal(l.ganho)}</td>
        <td class="num">${l.dias ?? '—'}</td>
        <td class="num">${l.ganhoDia != null ? sinal(l.ganhoDia) : '—'}</td>
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
      ${carteiras.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Cor</th><th>Nome</th><th>Situação</th><th class="num">Valor atual</th><th></th></tr></thead>
        <tbody>${carteiras.map((c, i) => `<tr data-carteira="${c.id}" data-nome="${esc(c.nome)}">
          <td><input type="color" data-cor value="${esc(corHex(corCarteira(c, i)))}" aria-label="Cor de ${esc(c.nome)}"></td>
          <td><input class="nome-inline" data-nome-input value="${esc(c.nome)}" maxlength="40" aria-label="Renomear ${esc(c.nome)}"></td>
        <td><select data-grupo-sel aria-label="Grupo de ${esc(c.nome)}">${optsGrupo(c.grupoId)}</select></td>
          <td><label><input type="checkbox" data-ativa ${c.ativa ? 'checked' : ''}> ativa</label></td>
          <td class="num">${ultima?.valores[c.id] != null ? brl(ultima.valores[c.id]) : '—'}</td>
          <td><button class="link perigo" data-apagar-carteira>apagar</button></td></tr>`).join('')}</tbody></table></div>
        <p class="muted">Desative uma carteira encerrada para tirá-la do formulário sem perder o histórico.</p>` : ''}
    </section>`;

  if (linhas.length) {
    const el = document.getElementById('g-patrimonio');
    if (modo === 'objetivo') graficoObjetivo(el, linhas, objetivo);
    else if (modo === 'mensal') graficoGanhoMensal(el, linhas);
    else graficoPatrimonio(el, carteiras, linhas, modo);
  }
  if (filtros.objetivo === 'editar') document.getElementById('objetivo').scrollIntoView({ block: 'start' });
  document.getElementById('form-objetivo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    let valorCentavos, aporteDesejadoCentavos;
    try { valorCentavos = lerValor(d.valor); if (!valorCentavos) throw new Error(); } catch { return aviso('Valor do objetivo inválido', true); }
    try { aporteDesejadoCentavos = lerValorComSinal(d.aporteDesejado); if (aporteDesejadoCentavos < 0) throw new Error(); } catch { return aviso('Aporte desejado inválido', true); }
    acao(() => api('/api/patrimonio-objetivo', { method: 'PUT', body: {
      nome: d.nome || null, valorCentavos, dataAlvo: d.dataAlvo || null, aporteDesejadoCentavos,
    } }),
      'Objetivo salvo').then((ok) => { if (ok && filtros.objetivo) irPara('patrimonio'); });
  });
  document.getElementById('remover-objetivo')?.addEventListener('click', () => {
    if (confirm('Remover o objetivo?')) acao(() => api('/api/patrimonio-objetivo', { method: 'DELETE' }), 'Objetivo removido');
  });
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
      return { d, valores, aporte, repetidas };
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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let r;
      try { r = lerFormulario(); } catch (err) { return aviso(err.message, true); }
      const { d, valores, aporte, repetidas } = r;
      if (!editando && linhas.some((l) => l.data === d.data)
        && !confirm(`Já existe uma anotação em ${dataBR(d.data)}. Substituir?`)) return;
      const msg = `Anotação de ${dataBR(d.data)} salva${repetidas.length ? ` (${repetidas.length === 1 ? '1 carteira repetiu' : `${repetidas.length} carteiras repetiram`} o último valor)` : ''}`;
      acao(() => api(`/api/patrimonio/${d.data}`, { method: 'PUT', body: { valores, aporte } }), msg)
        .then((ok) => { if (ok && editando) irPara('patrimonio'); });
    });
  }
  document.getElementById('apagar-estimados')?.addEventListener('click', () => {
    if (confirm('Apagar todas as anotações estimadas? As anotações reais ficam.')) {
      acao(() => api('/api/patrimonio-estimados', { method: 'DELETE' }), (x) => `${x.apagadas} anotações estimadas apagadas`);
    }
  });
  $app.querySelectorAll('[data-apagar-data]').forEach((b) => b.addEventListener('click', () => {
    const data = b.closest('tr').dataset.data;
    if (confirm(`Apagar a anotação de ${dataBR(data)}?`)) acao(() => api(`/api/patrimonio/${data}`, { method: 'DELETE' }), 'Anotação apagada');
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
    tr.querySelector('[data-apagar-carteira]').addEventListener('click', () => {
      if (confirm(`Apagar a carteira “${tr.dataset.nome}” e TODOS os valores anotados dela? Para só tirá-la do formulário, desmarque “ativa”.`)) {
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
function graficoObjetivo(el, linhas, objetivo) {
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
  const cor = css('--series-1');
  const g = novoGrafico(el);
  g.setOption({
    grid: { left: 8, right: 24, top: 40, bottom: 56, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: css('--text-2') },
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
        textStyle: { color: css('--text-3') }, labelFormatter: (v) => rotuloData(v) },
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
    ],
    xAxis: {
      type: 'time', ...eixoBase(), splitLine: { show: false },
      max: fim ? Date.parse(ts(fim)) : null,
      // Formato por nível: com zoom no histórico mostra dias; no horizonte longo, meses.
      axisLabel: { color: css('--text-2'), hideOverlap: true,
        formatter: { year: '{yyyy}', month: '{MM}/{yy}', day: '{dd}/{MM}', hour: '', minute: '', second: '', millisecond: '' } },
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
          label: { formatter: `${objetivo.nome ? `${objetivo.nome}: ` : 'Objetivo: '}${brl(objetivo.valor)}`, position: 'insideStartTop', color: css('--text') },
          data: [{ yAxis: objetivo.valor }, ...(objetivo.dataAlvo ? [{
            xAxis: ts(objetivo.dataAlvo), label: { formatter: `Prazo ${dataBR(objetivo.dataAlvo)}`, position: 'insideEndTop' },
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
    legend: { top: 0, left: 0, textStyle: { color: css('--text-2') }, icon: 'roundRect', data: ['Ganho', 'Aporte'] },
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
    legend: { top: 0, left: 0, textStyle: { color: css('--text-2') }, icon: 'roundRect', data: usadas.map((c) => c.nome) },
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
      ${grupos.length ? `<div class="tabela-wrap"><table><thead><tr><th>Nome</th><th class="num">Categorias</th><th></th></tr></thead>
        <tbody>${grupos.map((g) => `<tr data-grupo="${g.id}" data-nome="${esc(g.nome)}">
          <td><input class="nome-inline" data-nome-grupo value="${esc(g.nome)}" maxlength="40" aria-label="Renomear ${esc(g.nome)}"></td>
          <td class="num">${g.categorias}</td>
          <td class="acoes"><button class="link perigo" data-apagar-grupo>apagar</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
    </section>
    <section class="painel"><div class="tabela-wrap"><table>
      <thead><tr><th>Cor</th><th>Nome</th><th>Grupo</th><th class="num">Lançamentos</th><th class="num">Total</th><th class="num">% do total</th>
        <th class="num">Regras</th><th class="num">Limite mensal</th><th>Último</th><th></th></tr></thead>
      <tbody>${cats.map((c) => `<tr data-id="${c.id}" data-nome="${esc(c.nome)}" data-qtd="${c.qtd}" data-regras="${c.regras}">
        <td><input type="color" data-cor value="${esc(c.cor || '#888888')}" aria-label="Cor de ${esc(c.nome)}"></td>
        <td><input class="nome-inline" data-nome-input value="${esc(c.nome)}" maxlength="40" aria-label="Renomear ${esc(c.nome)}"></td>
        <td><select data-grupo-sel aria-label="Grupo de ${esc(c.nome)}">${optsGrupo(c.grupoId)}</select></td>
        <td class="num">${c.qtd}</td><td class="num">${brl(c.total)}</td>
        <td class="num">${total ? pct(c.total / total) : '—'}</td>
        <td class="num">${c.regras}</td>
        <td class="num">${c.limite ? brl(c.limite) : '<span class="muted">—</span>'}</td>
        <td>${c.ultimo ? dataBR(c.ultimo) : '<span class="muted">—</span>'}</td>
        <td class="acoes"><a href="#/categoria/${c.id}">ver</a> · <button class="link perigo" data-apagar>apagar</button></td>
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
    tr.querySelector('[data-apagar-grupo]').addEventListener('click', () => {
      if (confirm(`Apagar o grupo “${tr.dataset.nome}”? As categorias dele ficam sem grupo.`)) {
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
            <label>Limite do cartão (R$)<input name="limite" inputmode="decimal" value="${reais(b.limite_centavos)}" placeholder="—"></label>
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
    sec.querySelector('[data-apagar-banco]')?.addEventListener('click', () => {
      if (confirm('Apagar este banco do cadastro?')) {
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
          <input name="padrao" required minlength="2" placeholder="texto, ex.: MAX PIRACICABA">
          <select name="categoriaId" required>${optsCat}</select>
          <select name="banco"><option value="">todos os bancos</option>${opcoes.bancos.map((b) => `<option value="${b}">${nomeBanco(b)}</option>`).join('')}</select>
          <label><input type="checkbox" name="regex"> regex</label>
          <button class="primario">Salvar regra</button>
        </form>
      </section>
    </div>
    <section class="painel bloco"><h2>Etiquetas (${etiquetas.length})</h2>
      ${etiquetas.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Etiqueta</th><th class="num">Lançamentos</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${etiquetas.map((e) => `<tr><td><a href="#/transacoes?etiqueta=${e.id}">${esc(e.nome)}</a></td>
          <td class="num">${e.qtd}</td><td class="num">${brl(e.total)}</td>
          <td><button class="link" data-remover-etq="${e.id}">remover</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma etiqueta. Crie pela tela de Transações (“+ etiqueta” ou selecionando várias linhas).</p>'}
    </section>
    <section class="painel"><h2>Regras (${regras.length})</h2>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Contém</th><th>Categoria</th><th>Banco</th><th>Origem</th><th class="num">Em uso</th><th></th></tr></thead>
        <tbody>${regras.map((r) => `<tr>
          <td><code>${esc(r.padrao)}</code>${r.tipo_match === 'regex' ? ' <span class="selo">regex</span>' : ''}</td>
          <td><a href="#/categorias">${esc(r.categoria)}</a></td><td>${r.banco ? nomeBanco(r.banco) : 'todos'}</td>
          <td>${r.origem === 'usuario' ? '<span class="selo manual">sua</span>' : '<span class="selo">padrão</span>'}</td>
          <td class="num">${r.usos}</td>
          <td><button class="link" data-remover="${r.id}">remover</button></td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;

  document.getElementById('form-regra').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    acao(() => api('/api/regras', { method: 'POST', body: { padrao: d.padrao, categoriaId: Number(d.categoriaId), banco: d.banco || null, regex: !!d.regex } }),
      (r) => `Regra salva · ${r.semCategoria} lançamentos ainda sem categoria`);
  });
  $app.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Remover esta regra? Os lançamentos classificados por ela voltam a ser avaliados pelas outras regras.')) {
      acao(() => api(`/api/regras/${b.dataset.remover}`, { method: 'DELETE' }), 'Regra removida');
    }
  }));
  $app.querySelectorAll('[data-remover-etq]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Remover esta etiqueta de todos os lançamentos?')) {
      acao(() => api(`/api/etiquetas/${b.dataset.removerEtq}`, { method: 'DELETE' }), 'Etiqueta removida');
    }
  }));
}

const TELAS = {
  '': telaVisaoGeral, transacoes: telaTransacoes, categoria: telaCategoria, parcelas: telaParcelas,
  assinaturas: telaAssinaturas, orcamento: telaOrcamento, importar: telaImportar, regras: telaRegras,
  desconsiderados: telaDesconsiderados, categorias: telaCategorias, bancos: telaBancos, patrimonio: telaPatrimonio,
};

async function render() {
  renderSeq++;
  const r = rotaAtual();
  const ativo = [...document.querySelectorAll('#menu nav a')].map((a) => {
    a.classList.toggle('ativo', a.dataset.rota.split(' ').includes(r.rota));
    if (a.classList.contains('ativo')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    return a;
  }).find((a) => a.classList.contains('ativo'));
  document.getElementById('pagina-atual').textContent = ativo?.textContent ?? '';
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
function menu(aberto) {
  $menu.classList.toggle('aberta', aberto);
  $menu.inert = !aberto;
  document.getElementById('fundo-menu').hidden = !aberto;
  document.body.classList.toggle('menu-aberto', aberto);
  $abrirMenu.setAttribute('aria-expanded', aberto);
  if (aberto) ($menu.querySelector('nav a.ativo') ?? $menu.querySelector('nav a')).focus();
  else if ($menu.contains(document.activeElement)) $abrirMenu.focus();
}
$abrirMenu.addEventListener('click', () => menu(true));
document.getElementById('fechar-menu').addEventListener('click', () => menu(false));
document.getElementById('fundo-menu').addEventListener('click', () => menu(false));
$menu.addEventListener('click', (e) => { if (e.target.closest('nav a')) menu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && $menu.classList.contains('aberta')) menu(false); });

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
addEventListener('DOMContentLoaded', render);
