// =====================================================================
// BN GESTÃO — Núcleo de cálculo da escala e do repasse (puro, sem DOM)
// Pode ser importado no navegador, no Node ou no backend.
// Regras espelham o sistema atual da BN e as views do banco.
// =====================================================================

// Turnos que contam como produção realizada (igual à view cm_schedule_physician_month).
export const REALIZADOS = ['preenchido', 'confirmado'];
export const isRealizado = (status) => REALIZADOS.includes(status);

// Dinheiro sempre arredondado a centavos, para não acumular erro de ponto flutuante.
export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// Valores por paciente de um turno de uma unidade.
export function rateFor(rates, unitId, periodKey) {
  return rates.find(r => r.unit_id === unitId && r.period_key === periodKey)
      || { billing_per_patient: 0, transfer_per_patient: 0 };
}

// Faturamento e repasse de um único slot (0 se vago/cancelado).
export function slotAmount(slot, rate) {
  if (!isRealizado(slot.status)) return { pacientes: 0, faturamento: 0, repasse: 0 };
  const p = Number(slot.patients || 0);
  return {
    pacientes: p,
    faturamento: round2(p * Number(rate.billing_per_patient || 0)),
    repasse: round2(p * Number(rate.transfer_per_patient || 0)),
  };
}

export const competenceOf = (dateStr) => String(dateStr).slice(0, 7); // 'YYYY-MM'

// Agrega por médico + unidade + competência (mês). Devolve lista de linhas
// com pacientes, faturamento_devido e repasse_devido — como a view SQL.
export function aggregatePhysicianMonth(slots, rates) {
  const acc = new Map();
  for (const s of slots) {
    if (!s.physician_id || !isRealizado(s.status)) continue;
    const comp = competenceOf(s.slot_date);
    const key = [s.physician_id, s.unit_id, comp].join('|');
    const amt = slotAmount(s, rateFor(rates, s.unit_id, s.period_key));
    const cur = acc.get(key) || {
      physician_id: s.physician_id, unit_id: s.unit_id, competence: comp,
      slots_realizados: 0, pacientes: 0, faturamento_devido: 0, repasse_devido: 0,
    };
    cur.slots_realizados += 1;
    cur.pacientes += amt.pacientes;
    cur.faturamento_devido = round2(cur.faturamento_devido + amt.faturamento);
    cur.repasse_devido = round2(cur.repasse_devido + amt.repasse);
    acc.set(key, cur);
  }
  return [...acc.values()];
}

// Resumo diário por unidade (pacientes e faturamento do dia).
export function aggregateDaily(slots, rates) {
  const acc = new Map();
  for (const s of slots) {
    if (!isRealizado(s.status)) continue;
    const key = [s.unit_id, s.slot_date].join('|');
    const amt = slotAmount(s, rateFor(rates, s.unit_id, s.period_key));
    const cur = acc.get(key) || { unit_id: s.unit_id, slot_date: s.slot_date, pacientes: 0, faturamento: 0 };
    cur.pacientes += amt.pacientes;
    cur.faturamento = round2(cur.faturamento + amt.faturamento);
    acc.set(key, cur);
  }
  return [...acc.values()];
}

// Imposto sobre o faturamento (BN usa 0.17).
export const imposto = (faturamento, taxRate = 0.17) => round2(Number(faturamento || 0) * Number(taxRate || 0));

// Margem = faturamento - repasse - imposto.
export function margem(faturamento, repasse, taxRate = 0.17) {
  return round2(Number(faturamento || 0) - Number(repasse || 0) - imposto(faturamento, taxRate));
}

// Estado de um pagamento/recebimento frente ao devido (espelha statusValor da BN).
export function statusValor(valor, total) {
  const v = Number(valor || 0), t = Number(total || 0);
  if (t <= 0) return { cls: 'completo', txt: '—' };
  if (v <= 0.005) return { cls: 'pendente', txt: 'pendente' };
  if (v < t - 0.005) return { cls: 'parcial', txt: `parcial · falta ${money(t - v)}` };
  if (v > t + 0.005) return { cls: 'excedente', txt: `+${money(v - t)} a mais` };
  return { cls: 'completo', txt: 'completo' };
}

export const money = (x) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(x || 0));
