// Reconstrução estimada do patrimônio passado a partir dos aportes mensais por carteira.
//
// Modelo, por carteira: rende a uma taxa mensal fixa (juros compostos por dia) e o aporte do
// mês entra no dia 15. Partindo do valor real mais antigo e voltando no tempo:
//   valor no fim do mês anterior = (valor no fim do mês − aporte × rendimento do dia 15 ao fim)
//                                  ÷ rendimento do mês inteiro
// O que sobra antes do primeiro aporte é o saldo que já existia ("saldo inicial inferido").

const DIA = 86400000;
const dias = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA;
const fimDoMes = (ref) => {
  const [a, m] = ref.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

/**
 * @param ancora    { data: 'YYYY-MM-DD', valores: { carteiraId: centavos } } — valor real mais antigo
 * @param aportes   [{ ref: 'YYYY-MM', valores: { carteiraId: centavos } }] — meses anteriores à âncora
 * @param taxaMes   rendimento mensal suposto (0.0106 = 1,06% a.m.)
 * @param semSaldoAnterior ids de carteiras que não existiam antes do primeiro aporte: o saldo que
 *                  sobraria antes dele vira aporte (não informado) no mês do primeiro aporte.
 * @returns pontos [{ data, valores, aporte }] no fim de cada mês (mais antigo primeiro) e o saldo
 *          inicial inferido de cada carteira antes do primeiro mês.
 */
export function reconstruir({ ancora, aportes, taxaMes, semSaldoAnterior = [] }) {
  if (!(taxaMes > -0.5 && taxaMes < 0.5)) throw new Error('Taxa mensal inválida');
  const fator = (n) => (1 + taxaMes) ** (n / 30.4375);
  const meses = [...aportes].sort((a, b) => a.ref.localeCompare(b.ref));
  if (meses.length && fimDoMes(meses.at(-1).ref) >= ancora.data) throw new Error('Os aportes devem ser anteriores à primeira anotação');

  const ids = Object.keys(ancora.valores);
  let valores = { ...ancora.valores };
  let data = ancora.data;
  const pontos = [];
  for (let i = meses.length - 1; i >= 0; i--) {
    const { ref } = meses[i];
    const fim = fimDoMes(ref);
    // sem aportes entre o fim deste mês e o ponto seguinte (meses sem linha = sem aporte)
    valores = Object.fromEntries(ids.map((id) => [id, valores[id] / fator(dias(fim, data))]));
    const aporteMes = ids.reduce((s, id) => s + (meses[i].valores[id] ?? 0), 0);
    pontos.unshift({ data: fim, valores: arredondar(valores), aporte: aporteMes });
    // desfaz o mês: tira o aporte (que rendeu do dia 15 ao fim) e o rendimento do mês
    const inicio = fimDoMes(anterior(ref));
    const meio = `${ref}-15`;
    valores = Object.fromEntries(ids.map((id) =>
      [id, (valores[id] - (meses[i].valores[id] ?? 0) * fator(dias(meio, fim))) / fator(dias(inicio, fim))]));
    data = inicio;
  }
  const saldoInicial = { data, valores: arredondar(valores) };

  // Carteiras sem saldo antes do primeiro aporte: zera os meses anteriores e completa o aporte do
  // primeiro mês com o valor que faltava (aporte implícito no dia 15).
  const aportesExtras = {};
  for (const id of semSaldoAnterior.map(String)) {
    const i = meses.findIndex((m) => (m.valores[id] ?? 0) > 0);
    if (i < 0) continue;
    for (let j = 0; j < i; j++) pontos[j].valores[id] = 0;
    const fim = pontos[i].data;
    const implicito = Math.round(pontos[i].valores[id] / fator(dias(`${meses[i].ref}-15`, fim)));
    const extra = implicito - (meses[i].valores[id] ?? 0);
    pontos[i].aporte += extra;
    aportesExtras[id] = { ref: meses[i].ref, valor: extra };
    saldoInicial.valores[id] = 0;
  }
  return { pontos, saldoInicial, aportesExtras };
}

const arredondar = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x)]));
function anterior(ref) {
  const [a, m] = ref.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}
