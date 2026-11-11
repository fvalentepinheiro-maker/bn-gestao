// =====================================================================
// GERENCIAL BN — Regras de cálculo (puro: sem tela e sem banco)
// Tudo que vira número no sistema passa por aqui. Testado em testes/calculo.test.mjs
// =====================================================================

// Só estas situações contam como produção.
export const CONTAM = ['realizado', 'confirmado'];
export const conta = (l) => CONTAM.includes(l.status);

// Dinheiro sempre arredondado a centavos (evita erro de ponto flutuante).
export const r2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

export const mesDe = (data) => String(data || '').slice(0, 7); // 'AAAA-MM'

export function turnoDe(turnos, unidadeId, chave) {
  return turnos.find((t) => t.unidade_id === unidadeId && t.chave === chave) || { fat_paciente: 0, rep_paciente: 0, rotulo: chave };
}

// Faturamento e repasse de um lançamento da escala (zero se vago/cancelado).
export function valores(l, turno) {
  if (!conta(l)) return { pacientes: 0, fat: 0, rep: 0 };
  const p = Number(l.pacientes || 0);
  return { pacientes: p, fat: r2(p * Number(turno.fat_paciente || 0)), rep: r2(p * Number(turno.rep_paciente || 0)) };
}

// Uma linha por médico × serviço × mês.
export function porMedicoMes(escala, turnos) {
  const m = new Map();
  for (const l of escala) {
    if (!l.pessoa_id || !conta(l)) continue;
    const mes = mesDe(l.data), k = l.pessoa_id + '|' + l.unidade_id + '|' + mes;
    const v = valores(l, turnoDe(turnos, l.unidade_id, l.turno));
    const a = m.get(k) || { pessoa_id: l.pessoa_id, unidade_id: l.unidade_id, mes, turnos: 0, pacientes: 0, fat: 0, rep: 0 };
    a.turnos += 1; a.pacientes += v.pacientes; a.fat = r2(a.fat + v.fat); a.rep = r2(a.rep + v.rep);
    m.set(k, a);
  }
  return [...m.values()];
}

// Totais de um conjunto de lançamentos (pacientes, faturamento, repasse, imposto, margem).
// O imposto usa a alíquota de cada serviço.
export function totais(escala, turnos, unidades) {
  const t = { pacientes: 0, fat: 0, rep: 0, imposto: 0, margem: 0 };
  for (const l of escala) {
    if (!conta(l)) continue;
    const v = valores(l, turnoDe(turnos, l.unidade_id, l.turno));
    const u = unidades.find((x) => x.id === l.unidade_id);
    t.pacientes += v.pacientes; t.fat += v.fat; t.rep += v.rep;
    t.imposto += v.fat * Number(u?.aliquota ?? 0.17);
  }
  t.fat = r2(t.fat); t.rep = r2(t.rep); t.imposto = r2(t.imposto); t.margem = r2(t.fat - t.rep - t.imposto);
  return t;
}

// Situação de um valor pago/recebido frente ao devido.
export function situacaoValor(valor, devido) {
  const v = Number(valor || 0), d = Number(devido || 0);
  if (d <= 0 && v <= 0) return { cls: 'neutro', txt: '—' };
  if (v <= 0.005) return { cls: 'pendente', txt: 'pendente' };
  if (v < d - 0.005) return { cls: 'parcial', txt: 'parcial · falta ' + dinheiro(d - v) };
  if (v > d + 0.005) return { cls: 'excedente', txt: dinheiro(v - d) + ' a mais' };
  return { cls: 'ok', txt: 'completo' };
}

// Teto do serviço: 'total' soma tudo que já foi executado; 'mensal' olha só o mês pedido.
export function consumoTeto(unidade, escala, mes) {
  const teto = Number(unidade.teto_qtd || 0);
  let exec = 0;
  for (const l of escala) {
    if (l.unidade_id !== unidade.id || !conta(l)) continue;
    if (unidade.teto_tipo === 'mensal' && mesDe(l.data) !== mes) continue;
    exec += Number(l.pacientes || 0);
  }
  return { teto, exec, saldo: teto - exec, pct: teto ? Math.round((exec / teto) * 100) : 0, mensal: unidade.teto_tipo === 'mensal' };
}

// Resumo financeiro de uma lista de lançamentos. Aporte de capital NÃO é receita.
export function resumoFinanceiro(lancs) {
  const s = { entradas: 0, despesas: 0, aportes: 0, saldo: 0, liquidado: 0, aberto: 0, dea: 0 };
  for (const e of lancs) {
    const v = Number(e.valor || 0);
    if (e.tipo === 'entrada' && e.aporte) { s.aportes += v; continue; }
    const sinal = e.tipo === 'entrada' ? 1 : -1;
    if (e.tipo === 'entrada') s.entradas += v; else s.despesas += v;
    if (e.situacao === 'aberto') s.aberto += sinal * v;
    else if (e.situacao === 'dea') s.dea += v;
    else s.liquidado += sinal * v;
  }
  for (const k of Object.keys(s)) s[k] = r2(s[k]);
  s.saldo = r2(s.entradas - s.despesas);
  return s;
}

// Validade de documento. dias < 0 = vencido.
export function situacaoDocumento(validade, hoje) {
  if (!validade) return { cls: 'neutro', txt: 'sem validade', dias: null };
  const dias = Math.round((Date.parse(validade + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000);
  if (dias < 0) return { cls: 'pendente', txt: 'vencido há ' + -dias + (dias === -1 ? ' dia' : ' dias'), dias };
  if (dias <= 30) return { cls: 'parcial', txt: dias === 0 ? 'vence hoje' : 'vence em ' + dias + (dias === 1 ? ' dia' : ' dias'), dias };
  return { cls: 'ok', txt: 'vigente', dias };
}

// Semanas (segunda a domingo) que cobrem um mês 'AAAA-MM'. Só devolve os dias do próprio mês.
export function semanasDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const semanas = [];
  let atual = null;
  for (let d = 1; d <= ultimo; d++) {
    const dt = new Date(Date.UTC(a, m - 1, d)), ds = dt.getUTCDay();
    if (!atual || ds === 1) { atual = []; semanas.push(atual); }
    atual.push({ iso: mes + '-' + String(d).padStart(2, '0'), dia: d, ds });
  }
  return semanas;
}

export function mesSeguinte(mes, passo = 1) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + passo, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

export const dinheiro = (x) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(x || 0));
