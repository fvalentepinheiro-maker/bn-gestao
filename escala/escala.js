// =====================================================================
// BN Gestão — Módulo de Escala Médica e Repasse
// Vanilla JS. Usa o MESMO backend Supabase e a MESMA sessão do GSER.
// Tabelas: cm_schedule_units, cm_schedule_period_rates, cm_physicians,
//          cm_physician_units, cm_schedule_slots, cm_physician_payments.
// =====================================================================
import {
  aggregatePhysicianMonth, aggregateDaily, rateFor, slotAmount,
  imposto, margem, statusValor, money, round2,
} from './schedule-model.mjs';

const config = globalThis.GSER_CONFIG || {};
const URL = String(config.supabaseUrl || '').replace(/\/+$/, '');
const KEY = String(config.supabasePublishableKey || '');
const SESSION_KEY = config.sessionKey || 'gser.session.v1';

const app = document.getElementById('app');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let sess = null; try { sess = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
const state = {
  session: sess, profile: null, tab: null, month: hoje().slice(0, 7),
  units: [], rates: [], physicians: [], physUnits: [], slots: [], payments: [],
  error: '', busy: false,
};
let refreshPromise = null, toastTimer;

function toast(text, error = false) {
  const n = document.getElementById('toast');
  n.textContent = text; n.className = error ? 'error' : ''; n.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => n.style.display = 'none', 5000);
}
function setSession(s) {
  state.session = s;
  s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY);
}

// ---- camada de rede (mesmo padrão do GSER) ----
async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  if (auth && state.session && state.session.expires_at < Date.now() / 1000 + 45) {
    if (!refreshPromise)
      refreshPromise = request('/auth/v1/token?grant_type=refresh_token',
        { method: 'POST', body: { refresh_token: state.session.refresh_token }, auth: false })
        .then(s => setSession({ ...s, expires_at: Math.floor(Date.now() / 1000) + s.expires_in }))
        .catch(e => { setSession(null); throw e; })
        .finally(() => refreshPromise = null);
    await refreshPromise;
  }
  const h = { apikey: KEY, ...(auth && state.session ? { Authorization: 'Bearer ' + state.session.access_token } : {}), ...headers };
  if (body !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch(URL + path, { method, headers: h, body, signal: AbortSignal.timeout(25000) });
  if (!r.ok) { let e; try { e = await r.json(); } catch { e = { message: 'Falha na conexão (' + r.status + ').' }; } throw new Error(e.msg || e.message || e.error_description || e.error || 'Não foi possível concluir a operação.'); }
  if (r.status === 204) return null;
  return r.headers.get('content-type')?.includes('application/json') ? r.json() : r.text();
}
const rows = (table, query = '') => request('/rest/v1/' + table + '?select=*' + query + '&limit=2000');
const upsert = (table, body, onConflict) =>
  request('/rest/v1/' + table + '?on_conflict=' + onConflict,
    { method: 'POST', body, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });

const canEdit = () => state.profile?.is_active && ['manager', 'operator'].includes(state.profile.role);
const physName = id => state.physicians.find(p => p.id === id)?.full_name || '—';
const unitBySlug = slug => state.units.find(u => u.slug === slug);
const ratesOf = unitId => state.rates.filter(r => r.unit_id === unitId).sort((a, b) => a.display_order - b.display_order);

// ---- autenticação ----
async function login(email, password) {
  const s = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
  setSession({ ...s, expires_at: Math.floor(Date.now() / 1000) + s.expires_in });
}
async function loadProfile() {
  const uid = state.session?.user?.id;
  if (!uid) return null;
  const p = await rows('cm_profiles', '&id=eq.' + uid);
  return Array.isArray(p) ? p[0] : null;
}

// ---- carga de dados ----
async function loadData() {
  const [units, rates, phys, pu, contracts, consumo] = await Promise.all([
    rows('cm_schedule_units', '&order=display_order'),
    rows('cm_schedule_period_rates'),
    rows('cm_physicians', '&order=full_name'),
    rows('cm_physician_units'),
    rows('cm_contracts', '&select=id,contract_number,supplier_name,teto_qtd,valor_norte&order=supplier_name'),
    rows('cm_schedule_slots', '&select=unit_id,slot_date,period_key,physician_id,patients,status&order=slot_date'),
  ]);
  state.units = units || []; state.rates = rates || []; state.physicians = phys || []; state.physUnits = pu || []; state.contracts = contracts || [];
  state.allSlots = consumo || [];
  // executado acumulado por SERVIÇO (todos os meses) — para bater com o teto do serviço
  state.consumoUnidade = {};
  for (const s of state.allSlots) {
    if (['preenchido', 'confirmado'].includes(s.status))
      state.consumoUnidade[s.unit_id] = (state.consumoUnidade[s.unit_id] || 0) + Number(s.patients || 0);
  }
  await loadMonth();
}
async function loadMonth() {
  const ini = state.month + '-01';
  const fim = proximoMes(state.month) + '-01';
  const [slots, pays] = await Promise.all([
    rows('cm_schedule_slots', '&slot_date=gte.' + ini + '&slot_date=lt.' + fim),
    rows('cm_physician_payments', '&competence=eq.' + ini),
  ]);
  state.slots = slots || []; state.payments = pays || [];
}
function proximoMes(ym) { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }

// ---- operações ----
const findSlot = (unitId, iso, period) => state.slots.find(s => s.unit_id === unitId && s.slot_date === iso && s.period_key === period);

async function salvarSlot(patch) {
  // patch precisa de unit_id, slot_date, period_key (a chave única) + campos a gravar
  const existente = findSlot(patch.unit_id, patch.slot_date, patch.period_key) || {};
  const body = {
    unit_id: patch.unit_id, slot_date: patch.slot_date, period_key: patch.period_key,
    physician_id: 'physician_id' in patch ? patch.physician_id : (existente.physician_id ?? null),
    status: 'status' in patch ? patch.status : (existente.status || 'vago'),
    patients: 'patients' in patch ? patch.patients : (existente.patients ?? 0),
    contract_id: unitBySlug_byId(patch.unit_id)?.contract_id ?? null,
  };
  try {
    const [saved] = await upsert('cm_schedule_slots', body, 'unit_id,slot_date,period_key');
    const i = state.slots.findIndex(s => s.unit_id === body.unit_id && s.slot_date === body.slot_date && s.period_key === body.period_key);
    if (i >= 0) state.slots[i] = saved; else state.slots.push(saved);
    render();
  } catch (e) { toast(e.message, true); }
}
const unitBySlug_byId = id => state.units.find(u => u.id === id);

async function salvarPagamento(physId, unitId, campo, valor) {
  const comp = state.month + '-01';
  const ex = state.payments.find(p => p.physician_id === physId && p.unit_id === unitId && p.competence === comp) || {};
  const body = {
    physician_id: physId, unit_id: unitId, competence: comp,
    paid_value: ex.paid_value ?? 0, paid_patients: ex.paid_patients ?? 0, paid_at: ex.paid_at ?? null,
    received_value: ex.received_value ?? 0, received_patients: ex.received_patients ?? 0, received_at: ex.received_at ?? null,
    [campo]: valor,
  };
  try {
    const [saved] = await upsert('cm_physician_payments', body, 'physician_id,unit_id,competence');
    const i = state.payments.findIndex(p => p.physician_id === physId && p.unit_id === unitId && p.competence === comp);
    if (i >= 0) state.payments[i] = saved; else state.payments.push(saved);
  } catch (e) { toast(e.message, true); }
}

// =====================================================================
// RENDER
// =====================================================================
function render() {
  if (!state.session) return renderLogin();
  if (!state.units.length && !state.error) { app.innerHTML = '<div class="vazio-aviso">Carregando…</div>'; return; }
  if (!state.tab) state.tab = state.units[0]?.slug || 'financeiro';

  const nav = [
    ...state.units.map(u => [u.slug, u.name]),
    ['financeiro', '💰 Repasse / Financeiro'],
    ['medicos', '👩‍⚕️ Médicos'],
    ['servicos', '⚙️ Serviços'],
  ];
  app.innerHTML = `
    <header>
      <div class="brand"><h1>BN Gestão — Escala Médica</h1><p>Integramos Processos, Otimizamos Cuidado</p></div>
      <div class="user">
        <span>${esc(state.profile?.full_name || state.session.user?.email || '')} · ${esc(state.profile?.role || '')}</span>
        <button onclick="BN.sair()">Sair</button>
      </div>
    </header>
    <div class="tabs">${nav.map(([k, l]) => `<button class="tab ${state.tab === k ? 'ativo' : ''}" onclick="BN.tab('${k}')">${esc(l)}</button>`).join('')}</div>
    <div class="toolbar">
      <span class="info">Competência</span>
      <input type="month" value="${state.month}" onchange="BN.mes(this.value)">
      ${canEdit() && !['financeiro', 'medicos', 'servicos'].includes(state.tab) ? `<button class="btn" onclick="BN.abrirMarcarPeriodo('${unitBySlug(state.tab)?.id}')">📅 Marcar período</button>` : ''}
      ${!['financeiro', 'medicos', 'servicos'].includes(state.tab) ? `<button class="btn" onclick="BN.abrirPDF('${unitBySlug(state.tab)?.id}')">📄 Gerar PDF faturamento</button>` : ''}
      ${canEdit() && !['financeiro', 'medicos', 'servicos'].includes(state.tab) ? `<button class="btn" onclick="BN.abrirImportar('${unitBySlug(state.tab)?.id}')">📥 Importar</button>` : ''}
      ${!canEdit() ? '<span class="info" style="color:var(--laranja)">Seu perfil é somente consulta.</span>' : ''}
    </div>
    <div class="painel" id="painel"></div>`;

  const p = document.getElementById('painel');
  if (state.tab === 'financeiro') renderFinanceiro(p);
  else if (state.tab === 'medicos') renderMedicos(p);
  else if (state.tab === 'servicos') renderServicos(p);
  else renderGrade(p, unitBySlug(state.tab));
}

// ---- grade de uma unidade ----
function renderGrade(el, unit) {
  if (!unit) { el.innerHTML = '<div class="vazio-aviso">Unidade não encontrada.</div>'; return; }
  const periods = ratesOf(unit.id);
  if (!periods.length) { el.innerHTML = '<div class="vazio-aviso">Cadastre os turnos desta unidade em Médicos → Turnos.</div>'; return; }
  const semanas = semanasDoMes(state.month);
  const diario = aggregateDaily(state.slots.filter(s => s.unit_id === unit.id), state.rates);

  // Banner: serviço × contrato × teto DO SERVIÇO × executado acumulado do serviço
  const contrato = (state.contracts || []).find(c => c.id === unit.contract_id);
  const teto = Number(unit.teto_qtd || 0);
  const exec = Number(state.consumoUnidade?.[unit.id] || 0);
  const saldo = teto - exec;
  const pct = teto ? Math.min(100, Math.round(exec / teto * 100)) : 0;
  const cor = pct >= 100 ? 'var(--verde,#0e7c5a)' : pct >= 90 ? 'var(--laranja,#ea580c)' : 'var(--azul,#14688b)';
  const banner = `<div class="teto-banner" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;background:#fff;border:1px solid #dde1e8;border-left:4px solid ${cor};border-radius:10px;padding:12px 16px;margin-bottom:16px">
    <div><div style="font-size:.72rem;color:#6b7280">Serviço</div><b>${esc(unit.name)}</b></div>
    <div><div style="font-size:.72rem;color:#6b7280">Contrato</div><b>${esc(contrato?.contract_number || '— sem contrato —')}</b></div>
    <div><div style="font-size:.72rem;color:#6b7280">Teto (atend.)</div><b>${teto || '—'}</b></div>
    <div><div style="font-size:.72rem;color:#6b7280">Executado acumulado</div><b>${exec}</b></div>
    <div><div style="font-size:.72rem;color:#6b7280">Saldo</div><b style="color:${saldo < 0 ? 'var(--vermelho,#c62828)' : 'inherit'}">${teto ? saldo : '—'}</b></div>
    <div style="flex:1;min-width:120px"><div style="font-size:.72rem;color:#6b7280">Consumo do teto <b style="color:${cor}">${teto ? pct + '%' : '—'}</b></div>
      <div style="height:8px;background:#eef2f7;border-radius:5px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${pct}%;background:${cor}"></div></div></div>
  </div>`;

  el.innerHTML = banner + semanas.map(sem => {
    const totalSem = sem.days.reduce((n, d) => n + (diario.find(x => x.slot_date === d.iso)?.faturamento || 0), 0);
    return `<div class="semana">
      <div class="semana-header">
        <span class="semana-titulo">${sem.label}</span>
        <span class="semana-resumo">Faturamento previsto: <b>${money(totalSem)}</b></span>
      </div>
      <div class="dias-grid">
        ${sem.days.map(d => cardDia(unit, d, periods, diario)).join('')}
      </div></div>`;
  }).join('');
}

function cardDia(unit, d, periods, diario) {
  const tot = diario.find(x => x.slot_date === d.iso);
  return `<div class="dia-card" style="--u:${unit.color}">
    <div class="dia-header" style="background:${unit.color}1a;color:${unit.color}">
      <span><span class="dia-num">${d.d}</span> <span class="dia-nome">${DIAS_SEMANA[d.wd]}</span></span>
      <span class="dia-total">${tot ? money(tot.faturamento) : ''}</span>
    </div>
    <div class="turnos">
      ${periods.map(pr => turnoCell(unit, d.iso, pr)).join('')}
    </div></div>`;
}

function turnoCell(unit, iso, pr) {
  const s = findSlot(unit.id, iso, pr.period_key);
  const status = s?.status || 'vago';
  const pid = s?.physician_id || null;
  const pacientes = s?.patients ?? 0;
  const amt = s ? slotAmount(s, pr) : { repasse: 0 };
  const ed = canEdit();
  return `<div class="turno ${status}">
    <div class="turno-row1">
      <span class="turno-label">${esc(pr.period_label)}</span>
    </div>
    <div class="turno-medico ${pid ? '' : 'vazio'}" ${ed ? `onclick="BN.abrirMedico('${unit.id}','${iso}','${pr.period_key}')"` : ''}>
      ${pid ? esc(physName(pid)) : 'atribuir médico'}
    </div>
    ${pid ? `<div class="turno-prod">
      <input type="number" min="0" value="${pacientes}" ${ed ? '' : 'disabled'} onchange="BN.pacientes('${unit.id}','${iso}','${pr.period_key}',this.value)">
      <span class="un">pacientes</span>
    </div>
    <div class="turno-status">
      <button class="btn-status ${status === 'preenchido' ? 'on-real' : ''}" ${ed ? '' : 'disabled'} onclick="BN.status('${unit.id}','${iso}','${pr.period_key}','preenchido')">Realizado</button>
      <button class="btn-status ${status === 'confirmado' ? 'on-conf' : ''}" ${ed ? '' : 'disabled'} onclick="BN.status('${unit.id}','${iso}','${pr.period_key}','confirmado')">Confirmado</button>
      <button class="btn-status ${status === 'cancelado' ? 'on-canc' : ''}" ${ed ? '' : 'disabled'} onclick="BN.status('${unit.id}','${iso}','${pr.period_key}','cancelado')">Cancelado</button>
    </div>
    ${amt.repasse ? `<div class="turno-repasse">Repasse: ${money(amt.repasse)}</div>` : ''}` : ''}
  </div>`;
}

// ---- financeiro / repasse ----
function renderFinanceiro(el) {
  const agg = aggregatePhysicianMonth(state.slots, state.rates);
  const comp = state.month + '-01';
  const taxa = state.units[0]?.tax_rate ?? 0.17;

  const totFat = round2(agg.reduce((n, a) => n + a.faturamento_devido, 0));
  const totRep = round2(agg.reduce((n, a) => n + a.repasse_devido, 0));
  const totImp = imposto(totFat, taxa);
  const totMar = margem(totFat, totRep, taxa);

  const linhas = agg.sort((a, b) => physName(a.physician_id).localeCompare(physName(b.physician_id))).map(a => {
    const pay = state.payments.find(p => p.physician_id === a.physician_id && p.unit_id === a.unit_id && p.competence === comp) || {};
    const u = unitBySlug_byId(a.unit_id);
    const sp = statusValor(pay.paid_value, a.repasse_devido);
    const sr = statusValor(pay.received_value, a.faturamento_devido);
    return `<tr>
      <td>${esc(physName(a.physician_id))}</td>
      <td>${esc(u?.name || '')}</td>
      <td>${a.pacientes}</td>
      <td>${money(a.faturamento_devido)}</td>
      <td>${money(a.repasse_devido)}</td>
      <td><input type="number" step="0.01" value="${pay.paid_value ?? 0}" ${canEdit() ? '' : 'disabled'}
           onchange="BN.pagar('${a.physician_id}','${a.unit_id}','paid_value',this.value)"> <span class="chip ${sp.cls}">${sp.txt}</span></td>
      <td><input type="number" step="0.01" value="${pay.received_value ?? 0}" ${canEdit() ? '' : 'disabled'}
           onchange="BN.pagar('${a.physician_id}','${a.unit_id}','received_value',this.value)"> <span class="chip ${sr.cls}">${sr.txt}</span></td>
      <td><button class="btn" title="Demonstrativo do médico" onclick="BN.gerarPDFMedico('${a.physician_id}','${a.unit_id}')">📄</button></td>
    </tr>`;
  }).join('');

  // ---- mês a mês da produção da escala (todos os meses) ----
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const rateFor2 = (uid, pk) => state.rates.find(r => r.unit_id === uid && r.period_key === pk) || { billing_per_patient: 0, transfer_per_patient: 0 };
  const mm = {};
  for (const s of (state.allSlots || [])) {
    if (!['preenchido', 'confirmado'].includes(s.status)) continue;
    const c = (s.slot_date || '').slice(0, 7); if (!c) continue;
    const r = rateFor2(s.unit_id, s.period_key), q = Number(s.patients || 0);
    const o = mm[c] || { pac: 0, fat: 0, rep: 0 };
    o.pac += q; o.fat += q * Number(r.billing_per_patient || 0); o.rep += q * Number(r.transfer_per_patient || 0); mm[c] = o;
  }
  const mmRows = Object.keys(mm).sort().map(c => { const o = mm[c], p = c.split('-'); return `<tr><td>${MES[parseInt(p[1]) - 1]}/${p[0]}</td><td>${o.pac}</td><td>${money(o.fat)}</td><td style="color:var(--verde)">${money(o.rep)}</td><td style="color:var(--azul)">${money(o.fat - o.rep)}</td></tr>`; }).join('');

  el.innerHTML = `
    <div class="cards-kpi">
      <div class="kpi"><div class="rotulo">Faturamento previsto</div><div class="valor">${money(totFat)}</div></div>
      <div class="kpi"><div class="rotulo">Repasse aos médicos</div><div class="valor" style="color:var(--verde)">${money(totRep)}</div></div>
      <div class="kpi"><div class="rotulo">Imposto (${(taxa * 100).toFixed(0)}%)</div><div class="valor" style="color:var(--laranja)">${money(totImp)}</div></div>
      <div class="kpi"><div class="rotulo">Margem (fat − repasse − imposto)</div><div class="valor" style="color:var(--azul)">${money(totMar)}</div></div>
    </div>
    <h3 style="margin:18px 0 8px">Repasse por médico · ${state.month}</h3>
    ${agg.length ? `<table>
      <thead><tr><th>Médico</th><th>Unidade</th><th>Pac.</th><th>Faturamento</th><th>Repasse devido</th><th>Pago ao médico</th><th>Recebido do cliente</th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>` : '<div class="vazio-aviso">Nenhuma produção lançada nesta competência.</div>'}
    <h3 style="margin:22px 0 8px">Acompanhamento mês a mês · produção da escala</h3>
    <table>
      <thead><tr><th>Mês</th><th>Atendimentos</th><th>Faturamento</th><th>Repasse</th><th>Líquido (fat − rep)</th></tr></thead>
      <tbody>${mmRows || '<tr><td colspan="5" class="vazio-aviso">Sem produção lançada.</td></tr>'}</tbody>
    </table>`;
}

// ---- cadastro de médicos ----
function renderMedicos(el) {
  const linhas = state.physicians.map(p => {
    const units = state.physUnits.filter(x => x.physician_id === p.id).map(x => unitBySlug_byId(x.unit_id)?.name).filter(Boolean);
    return `<tr>
      <td>${esc(p.full_name)}</td><td>${esc(p.crm || '—')}</td><td>${esc(p.specialty || '—')}</td>
      <td>${esc(p.phone || '—')}</td><td>${units.map(esc).join(', ') || '—'}</td>
      <td>${p.is_active ? '<span class="chip completo">ativo</span>' : '<span class="chip pendente">inativo</span>'}</td>
      ${canEdit() ? `<td><button class="btn" onclick="BN.abrirEditarMedico('${p.id}')">✏️ Editar</button> <select id="vu_${p.id}"><option value="">vincular a…</option>${state.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select> <button class="btn" onclick="BN.vincular('${p.id}')">+</button></td>` : ''}
    </tr>`;
  }).join('');
  el.innerHTML = `
    ${canEdit() ? `<div class="row-form">
      <label>Nome<input type="text" id="novoMedNome" placeholder="Nome completo"></label>
      <label>CRM<input type="text" id="novoMedCrm" placeholder="CRM"></label>
      <label>Especialidade<input type="text" id="novoMedEsp" placeholder="Especialidade"></label>
      <label>Telefone<input type="text" id="novoMedTel" placeholder="(91) ..."></label>
      <label>Unidade<select id="novoMedUnit"><option value="">— vincular a —</option>${state.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
      <button class="btn primario" onclick="BN.addMedico()">Cadastrar médico</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Médico</th><th>CRM</th><th>Especialidade</th><th>Telefone</th><th>Unidades</th><th>Situação</th>${canEdit() ? '<th>Vincular</th>' : ''}</tr></thead>
      <tbody>${linhas || '<tr><td colspan="7" class="vazio-aviso">Nenhum médico cadastrado.</td></tr>'}</tbody>
    </table>`;
}

// ---- cadastro de serviços / unidades ----
function slugify(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
function renderServicos(el) {
  const contrName = id => { const c = (state.contracts || []).find(c => c.id === id); return c ? `${c.contract_number} · ${c.supplier_name}` : '—'; };
  const linhas = state.units.map(u => {
    const rs = ratesOf(u.id).map(r => `${esc(r.period_label)}: ${money(r.billing_per_patient)} / ${money(r.transfer_per_patient)}`).join('<br>');
    return `<tr><td>${esc(u.name)}</td><td>${esc(contrName(u.contract_id))}</td><td class="r">${u.teto_qtd || '—'}</td><td class="r">${u.valor_norte != null ? money(u.valor_norte) : '—'}</td><td>${((u.tax_rate || 0) * 100).toFixed(0)}%</td><td>${rs || '—'}</td>${canEdit() ? `<td><button class="btn" onclick="BN.abrirEditarServico('${u.id}')">✏️ Editar</button></td>` : ''}</tr>`;
  }).join('');
  const contrOpts = ['<option value="">— contrato —</option>', ...(state.contracts || []).map(c => `<option value="${c.id}">${esc(c.contract_number)} · ${esc(c.supplier_name)}</option>`)].join('');
  el.innerHTML = `
    ${canEdit() ? `<div class="row-form">
      <label>Serviço/Unidade<input type="text" id="svNome" placeholder="Ex.: Mãe do Rio"></label>
      <label>Contrato<select id="svContr">${contrOpts}</select></label>
      <label>Teto (atend.)<input type="number" id="svTeto" placeholder="0" style="width:90px"></label>
      <label>Valor-norte R$<input type="number" step="0.01" id="svNorte" placeholder="0" style="width:90px"></label>
      <label>Imposto %<input type="number" id="svTax" value="17" style="width:70px"></label>
      <label>Manhã fat.<input type="number" id="svMF" value="0" style="width:80px"></label>
      <label>Manhã rep.<input type="number" id="svMR" value="0" style="width:80px"></label>
      <label>Tarde fat.<input type="number" id="svTF" value="0" style="width:80px"></label>
      <label>Tarde rep.<input type="number" id="svTR" value="0" style="width:80px"></label>
      <button class="btn primario" onclick="BN.addServico()">Cadastrar serviço</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Serviço / Unidade</th><th>Contrato</th><th class="r">Teto</th><th class="r">Valor-norte</th><th>Imposto</th><th>Turnos (faturamento / repasse por paciente)</th>${canEdit() ? '<th></th>' : ''}</tr></thead>
      <tbody>${linhas || '<tr><td colspan="7" class="vazio-aviso">Nenhum serviço cadastrado.</td></tr>'}</tbody>
    </table>`;
}

// ---- modal: atribuir médico a um turno ----
function abrirMedico(unitId, iso, period) {
  const disp = state.physUnits.filter(x => x.unit_id === unitId).map(x => x.physician_id);
  const lista = state.physicians.filter(p => p.is_active && disp.includes(p.id));
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal">
    <h3>Atribuir médico</h3><p>${esc(new Date(iso + 'T12:00').toLocaleDateString('pt-BR'))} · ${esc(ratesOf(unitId).find(r => r.period_key === period)?.period_label || period)}</p>
    <div class="modal-medicos">
      ${lista.map(p => `<button class="mm-btn" onclick="BN.atribuir('${unitId}','${iso}','${period}','${p.id}')">${esc(p.full_name)}</button>`).join('') || '<p>Nenhum médico vinculado a esta unidade. Cadastre em Médicos.</p>'}
    </div>
    <div class="modal-acoes">
      <button class="btn" onclick="BN.atribuir('${unitId}','${iso}','${period}','')">Deixar vago</button>
      <button class="btn" onclick="BN.fecharModal()">Fechar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// =====================================================================
// LOGIN
// =====================================================================
function renderLogin() {
  app.innerHTML = `<div class="login-wrap">
    <h2>BN Gestão</h2><p>Escala Médica e Repasse — entre com sua conta do sistema.</p>
    <label>E-mail</label><input type="email" id="loginEmail" autocomplete="username">
    <label>Senha</label><input type="password" id="loginSenha" autocomplete="current-password">
    <button class="btn primario" onclick="BN.entrar()">Entrar</button>
    ${state.error ? `<div class="erro">${esc(state.error)}</div>` : ''}
  </div>`;
}

// ---- modal: marcar período em lote ----
function abrirMarcarPeriodo(unitId) {
  const u = state.units.find(x => x.id === unitId); if (!u) { toast('Abra uma unidade para marcar o período.', true); return; }
  const ini = state.month + '-01';
  const [y, m] = state.month.split('-').map(Number);
  const fim = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal">
    <h3>Marcar período — ${esc(u.name)}</h3>
    <p>Aplica a situação escolhida apenas aos dias que já têm médico atribuído no intervalo. Dias sem escala não são tocados.</p>
    <label>De<br><input type="date" id="mpIni" value="${ini}"></label>
    <label>Até<br><input type="date" id="mpFim" value="${fim}"></label>
    <label>Situação<br><select id="mpStatus">
      <option value="confirmado">Confirmado</option>
      <option value="preenchido">Realizado</option>
      <option value="cancelado">Cancelado</option>
    </select></label>
    <div class="modal-acoes">
      <button class="btn primario" onclick="BN.marcarPeriodo('${unitId}')">Aplicar</button>
      <button class="btn" onclick="BN.fecharModal()">Cancelar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// ---- modal: editar cadastro do médico ----
function abrirEditarMedico(id) {
  const p = state.physicians.find(x => x.id === id); if (!p) return;
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal">
    <h3>Editar médico</h3>
    <label>Nome<br><input id="emNome" value="${esc(p.full_name || '')}"></label>
    <label>CRM<br><input id="emCrm" value="${esc(p.crm || '')}"></label>
    <label>Especialidade<br><input id="emEsp" value="${esc(p.specialty || '')}"></label>
    <label>Telefone<br><input id="emTel" value="${esc(p.phone || '')}"></label>
    <label>Situação<br><select id="emAtivo"><option value="true" ${p.is_active ? 'selected' : ''}>Ativo</option><option value="false" ${!p.is_active ? 'selected' : ''}>Inativo</option></select></label>
    <div class="modal-acoes">
      <button class="btn primario" onclick="BN.salvarMedico('${id}')">Salvar</button>
      <button class="btn" onclick="BN.fecharModal()">Cancelar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// ---- modal: importar escala em lote (colar de planilha/CSV) ----
function abrirImportar(unitId) {
  const u = state.units.find(x => x.id === unitId); if (!u) { toast('Abra uma unidade.', true); return; }
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal" style="max-width:640px">
    <h3>Importar escala — ${esc(u.name)}</h3>
    <p>Cole os dados (de planilha/Excel ou CSV). Uma linha por lançamento, colunas nesta ordem:</p>
    <p style="font-family:monospace;font-size:.8rem;background:#f3f6f9;padding:8px;border-radius:6px">data ; turno ; médico ; pacientes ; situação</p>
    <p style="font-size:.8rem;color:#667">• <b>data</b>: 25/08/2026 ou 2026-08-25 &nbsp; • <b>turno</b>: manha / tarde / extra &nbsp; • <b>situação</b>: confirmado / realizado / cancelado (padrão: confirmado). Aceita vírgula, ponto-e-vírgula ou TAB entre colunas. Primeira linha de cabeçalho é ignorada.</p>
    <textarea id="impTxt" style="width:100%;height:160px;font-family:monospace;font-size:.82rem" placeholder="25/08/2026; manha; Ana Caroline; 43; confirmado
25/08/2026; tarde; Gildeone Farias; 48; confirmado"></textarea>
    <div class="err" id="impErr"></div>
    <div class="modal-acoes">
      <button class="btn primario" onclick="BN.importar('${unitId}')">Importar</button>
      <button class="btn" onclick="BN.fecharModal()">Cancelar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// ---- modal: período da fatura antes de gerar o PDF ----
function abrirPDF(unitId) {
  const u = state.units.find(x => x.id === unitId); if (!u) { toast('Abra uma unidade.', true); return; }
  const ini = state.month + '-01';
  const [y, m] = state.month.split('-').map(Number);
  const fim = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal">
    <h3>Gerar fatura — ${esc(u.name)}</h3>
    <p>Escolha o período da fatura. Só entram os dias com atendimento.</p>
    <label>De<br><input type="date" id="pdfIni" value="${ini}"></label>
    <label>Até<br><input type="date" id="pdfFim" value="${fim}"></label>
    <div class="modal-acoes">
      <button class="btn primario" onclick="BN.gerarPDF('${unitId}')">Gerar PDF</button>
      <button class="btn" onclick="BN.fecharModal()">Cancelar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// ---- modal: editar serviço (teto por serviço) ----
function abrirEditarServico(id) {
  const u = state.units.find(x => x.id === id); if (!u) return;
  const contrOpts = ['<option value="">— sem contrato —</option>', ...(state.contracts || []).map(c => `<option value="${c.id}" ${c.id === u.contract_id ? 'selected' : ''}>${esc(c.contract_number)} · ${esc(c.supplier_name)}</option>`)].join('');
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<div class="modal">
    <h3>Editar serviço</h3>
    <label>Nome<br><input id="esNome" value="${esc(u.name || '')}"></label>
    <label>Contrato<br><select id="esContr">${contrOpts}</select></label>
    <label>Teto (nº de atendimentos)<br><input type="number" id="esTeto" value="${u.teto_qtd ?? ''}"></label>
    <label>Valor-norte (R$/atendimento)<br><input type="number" step="0.01" id="esNorte" value="${u.valor_norte ?? ''}"></label>
    <label>Imposto %<br><input type="number" id="esTax" value="${((u.tax_rate || 0) * 100).toFixed(0)}"></label>
    <div class="modal-acoes">
      <button class="btn primario" onclick="BN.salvarServico('${id}')">Salvar</button>
      <button class="btn" onclick="BN.fecharModal()">Cancelar</button>
    </div>
  </div>`;
  ov.classList.add('visivel');
}

// =====================================================================
// AÇÕES EXPOSTAS
// =====================================================================
const BN = {
  async entrar() {
    const email = document.getElementById('loginEmail').value.trim();
    const senha = document.getElementById('loginSenha').value;
    state.error = '';
    try {
      await login(email, senha);
      await boot();
    } catch (e) {
      state.error = /Invalid login/.test(e.message) ? 'E-mail ou senha incorretos.' : e.message;
      renderLogin();
    }
  },
  sair() { setSession(null); state.profile = null; render(); },
  tab(k) { state.tab = k; render(); },
  async mes(v) { state.month = v; app.querySelector('#painel').innerHTML = '<div class="vazio-aviso">Carregando…</div>'; await loadMonth(); render(); },
  abrirMedico, abrirMarcarPeriodo, abrirEditarMedico, abrirEditarServico, abrirPDF, abrirImportar,
  async importar(unitId) {
    const u = state.units.find(x => x.id === unitId); if (!u) return;
    const ta = document.getElementById('impTxt'); const raw = (ta && ta.value || '').trim();
    const errEl = document.getElementById('impErr');
    if (!raw) { if (errEl) errEl.textContent = 'Cole os dados primeiro.'; return; }
    const low = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const parseDate = s => {
      s = String(s || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) { let y = m[3]; if (y.length === 2) y = '20' + y; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
      return null;
    };
    const turnoOf = s => { s = low(s); if (s.startsWith('manh')) return 'manha'; if (s.startsWith('tard')) return 'tarde'; if (s.startsWith('ext')) return 'extra'; if (s.startsWith('interm')) return 'intermediario'; if (s.startsWith('turn')) return 'turno'; return s; };
    const statusOf = s => { s = low(s); if (!s || s.startsWith('conf')) return 'confirmado'; if (s.startsWith('real') || s.startsWith('preen')) return 'preenchido'; if (s.startsWith('canc')) return 'cancelado'; if (s.startsWith('vag')) return 'vago'; return 'confirmado'; };
    let lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines[0] && /data/i.test(lines[0]) && /(m[eé]dico|paciente|turno|situa)/i.test(lines[0])) lines.shift();
    const rows = [], erros = [], medicos = new Set();
    lines.forEach((ln, i) => {
      const c = ln.split(/[\t;,]/).map(x => x.trim());
      const dt = parseDate(c[0]);
      if (!dt) { erros.push('linha ' + (i + 1) + ': data inválida'); return; }
      const turno = turnoOf(c[1] || ''); const med = (c[2] || '').trim(); const pac = parseInt(c[3]) || 0; const st = statusOf(c[4]);
      if (med) medicos.add(med);
      rows.push({ dt, turno, med, pac, st });
    });
    if (!rows.length) { if (errEl) errEl.textContent = 'Nada válido pra importar. ' + (erros[0] || ''); return; }
    this.fecharModal();
    try {
      // garante médicos e vínculo com a unidade
      for (const nome of medicos) {
        let p = state.physicians.find(x => low(x.full_name) === low(nome));
        if (!p) { const r = await upsert('cm_physicians', { full_name: nome }, 'id'); p = r[0]; state.physicians.push(p); }
        try { await upsert('cm_physician_units', { physician_id: p.id, unit_id: unitId }, 'physician_id,unit_id'); } catch (e) { }
      }
      const body = rows.map(r => {
        const phys = r.med ? (state.physicians.find(x => low(x.full_name) === low(r.med)) || {}).id : null;
        return { unit_id: unitId, slot_date: r.dt, period_key: r.turno, physician_id: phys || null, status: r.st, patients: r.pac, contract_id: u.contract_id || null, notes: 'Importado' };
      });
      await upsert('cm_schedule_slots', body, 'unit_id,slot_date,period_key');
      await loadData(); render();
      toast(rows.length + ' lançamentos importados' + (erros.length ? ' (' + erros.length + ' linhas ignoradas)' : '') + '.');
    } catch (e) { toast(e.message, true); }
  },
  fecharModal() { document.getElementById('overlay').classList.remove('visivel'); },
  async salvarServico(id) {
    const nome = document.getElementById('esNome').value.trim();
    if (!nome) { toast('Informe o nome.', true); return; }
    const body = {
      name: nome,
      contract_id: document.getElementById('esContr').value || null,
      teto_qtd: parseInt(document.getElementById('esTeto').value) || null,
      valor_norte: parseFloat(document.getElementById('esNorte').value) || null,
      tax_rate: (parseFloat(document.getElementById('esTax').value) || 0) / 100,
    };
    this.fecharModal();
    try {
      await request(`/rest/v1/cm_schedule_units?id=eq.${id}`, { method: 'PATCH', body, headers: { Prefer: 'return=minimal' } });
      await loadData(); toast('Serviço atualizado.'); render();
    } catch (e) { toast(e.message, true); }
  },
  async marcarPeriodo(unitId) {
    const a = document.getElementById('mpIni').value, b = document.getElementById('mpFim').value, st = document.getElementById('mpStatus').value;
    if (!a || !b) { toast('Informe o período.', true); return; }
    if (a > b) { toast('A data inicial é maior que a final.', true); return; }
    this.fecharModal();
    try {
      await request(`/rest/v1/cm_schedule_slots?unit_id=eq.${unitId}&slot_date=gte.${a}&slot_date=lte.${b}&physician_id=not.is.null`,
        { method: 'PATCH', body: { status: st }, headers: { Prefer: 'return=minimal' } });
      await loadMonth(); render();
      toast('Período marcado.');
    } catch (e) { toast(e.message, true); }
  },
  async salvarMedico(id) {
    const body = {
      full_name: document.getElementById('emNome').value.trim(),
      crm: document.getElementById('emCrm').value.trim() || null,
      specialty: document.getElementById('emEsp').value.trim() || null,
      phone: document.getElementById('emTel').value.trim() || null,
      is_active: document.getElementById('emAtivo').value === 'true',
    };
    if (!body.full_name) { toast('Informe o nome.', true); return; }
    this.fecharModal();
    try {
      await request(`/rest/v1/cm_physicians?id=eq.${id}`, { method: 'PATCH', body, headers: { Prefer: 'return=minimal' } });
      await loadData(); toast('Médico atualizado.'); render();
    } catch (e) { toast(e.message, true); }
  },
  async atribuir(unitId, iso, period, pid) {
    this.fecharModal();
    await salvarSlot({ unit_id: unitId, slot_date: iso, period_key: period, physician_id: pid || null, status: pid ? 'preenchido' : 'vago' });
  },
  async pacientes(unitId, iso, period, val) {
    await salvarSlot({ unit_id: unitId, slot_date: iso, period_key: period, patients: Math.max(0, parseInt(val) || 0) });
  },
  async status(unitId, iso, period, novo) {
    const s = findSlot(unitId, iso, period);
    const atual = s?.status || 'vago';
    await salvarSlot({ unit_id: unitId, slot_date: iso, period_key: period, status: atual === novo ? 'preenchido' : novo });
  },
  async pagar(physId, unitId, campo, val) {
    await salvarPagamento(physId, unitId, campo, Math.max(0, Number(String(val).replace(',', '.')) || 0));
    render();
  },
  async addMedico() {
    const nome = document.getElementById('novoMedNome').value.trim();
    if (!nome) { toast('Informe o nome.', true); return; }
    try {
      const [p] = await upsert('cm_physicians', {
        full_name: nome,
        crm: document.getElementById('novoMedCrm').value.trim() || null,
        specialty: document.getElementById('novoMedEsp').value.trim() || null,
        phone: document.getElementById('novoMedTel').value.trim() || null,
      }, 'id');
      const uid = document.getElementById('novoMedUnit').value;
      if (uid) await upsert('cm_physician_units', { physician_id: p.id, unit_id: uid }, 'physician_id,unit_id');
      await loadData();
      toast('Médico cadastrado.'); render();
    } catch (e) { toast(e.message, true); }
  },
  async vincular(physId) {
    const uid = document.getElementById('vu_' + physId)?.value;
    if (!uid) { toast('Escolha a unidade.', true); return; }
    try {
      await upsert('cm_physician_units', { physician_id: physId, unit_id: uid }, 'physician_id,unit_id');
      await loadData(); toast('Médico vinculado.'); render();
    } catch (e) { toast(e.message, true); }
  },
  async addServico() {
    const nome = document.getElementById('svNome').value.trim();
    if (!nome) { toast('Informe o nome do serviço.', true); return; }
    const slug = slugify(nome);
    if (!slug) { toast('Nome inválido.', true); return; }
    if (state.units.some(u => u.slug === slug)) { toast('Já existe um serviço com esse nome.', true); return; }
    const num = id => parseFloat(document.getElementById(id).value) || 0;
    const ord = Math.max(0, ...state.units.map(u => u.display_order || 0)) + 1;
    try {
      const [u] = await upsert('cm_schedule_units', {
        name: nome, slug, color: '#0a7fa8', tax_rate: num('svTax') / 100,
        display_order: ord, contract_id: document.getElementById('svContr').value || null,
        teto_qtd: parseInt(document.getElementById('svTeto').value) || null,
        valor_norte: parseFloat(document.getElementById('svNorte').value) || null,
      }, 'slug');
      await upsert('cm_schedule_period_rates', [
        { unit_id: u.id, period_key: 'manha', period_label: 'Manhã', billing_per_patient: num('svMF'), transfer_per_patient: num('svMR'), display_order: 1 },
        { unit_id: u.id, period_key: 'tarde', period_label: 'Tarde', billing_per_patient: num('svTF'), transfer_per_patient: num('svTR'), display_order: 2 },
      ], 'unit_id,period_key');
      await loadData(); toast('Serviço cadastrado.'); render();
    } catch (e) { toast(e.message, true); }
  },
  async gerarPDF(unitId) {
    const u = state.units.find(x => x.id === unitId);
    if (!u) { toast('Abra uma unidade.', true); return; }
    const pIni = document.getElementById('pdfIni')?.value || null;
    const pFim = document.getElementById('pdfFim')?.value || null;
    this.fecharModal();
    let slots;
    try { slots = await rows('cm_schedule_slots', '&unit_id=eq.' + unitId + '&order=slot_date.asc'); }
    catch (e) { toast(e.message, true); return; }
    const rate = Number(ratesOf(unitId).find(r => r.period_key === 'manha')?.billing_per_patient) || 40;
    const byd = {};
    for (const s of slots) {
      if (!['preenchido', 'confirmado'].includes(s.status)) continue;
      if (pIni && s.slot_date < pIni) continue;
      if (pFim && s.slot_date > pFim) continue;
      const d = s.slot_date; byd[d] = byd[d] || { m: 0, t: 0 };
      const q = Number(s.patients || 0);
      if (s.period_key === 'manha') byd[d].m += q; else byd[d].t += q; // tarde + extra entram na tarde
    }
    const dias = Object.keys(byd).filter(d => byd[d].m + byd[d].t > 0).sort();
    if (!dias.length) { toast('Nenhum atendimento lançado nesta unidade.', true); return; }
    const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const fmtD = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let tm = 0, tt = 0;
    const linhas = dias.map(d => {
      const r = byd[d], tot = r.m + r.t; tm += r.m; tt += r.t;
      return `<tr><td>${fmtD(d)}</td><td class="c">${r.m}</td><td class="c">${r.t}</td><td class="c"><b>${tot}</b></td><td class="r">${brl(tot * rate)}</td></tr>`;
    }).join('');
    const totGeral = tm + tt;
    const compMeses = [...new Set(dias.map(d => MES[parseInt(d.slice(5, 7)) - 1]))].join(' · ');
    const ano = dias[0].slice(0, 4);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Faturamento ${esc(u.name)}</title>
<style>
@page{margin:14mm}*{box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2a24;margin:0;font-size:12px}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e7c5a;padding-bottom:10px}
.logo{display:flex;align-items:center;gap:10px}
.logo .mark{width:46px;height:46px;border-radius:10px;background:#0e7c5a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;letter-spacing:1px}
.logo .nome{font-weight:800;color:#0e7c5a;font-size:16px;line-height:1.1}
.logo .slogan{color:#6b7a73;font-size:9px;letter-spacing:.5px;text-transform:uppercase}
.contato{text-align:right;color:#4a5a52;font-size:10px;line-height:1.5}
h1{font-size:15px;color:#0e7c5a;margin:16px 0 2px}.sub{color:#6b7a73;margin:0 0 12px;font-size:11px}
.resumo{display:flex;gap:10px;margin:0 0 14px}
.rc{flex:1;border:1px solid #d8e2dc;border-top:3px solid #0e7c5a;border-radius:8px;padding:8px 10px}
.rc .k{font-size:9px;color:#6b7a73;text-transform:uppercase;letter-spacing:.5px}.rc .v{font-size:14px;font-weight:700;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#0e7c5a;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:7px 8px;text-align:left}
th.c,td.c{text-align:center}th.r,td.r{text-align:right}
td{padding:6px 8px;border-bottom:1px solid #eef3f0}
tr:nth-child(even) td{background:#f7faf9}
tfoot td{border-top:2px solid #0e7c5a;font-weight:700;background:#eef7f3}
.total{display:flex;justify-content:space-between;align-items:center;background:#0e7c5a;color:#fff;border-radius:8px;padding:12px 16px;margin:4px 0 18px}
.total .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.5px}.total .big{font-size:22px;font-weight:800}
.assin{margin-top:26px;font-size:11px}.assin b{display:block}.mut{color:#6b7a73;display:block}
.foot{margin-top:24px;border-top:1px solid #d8e2dc;padding-top:6px;color:#8a9790;font-size:9px;text-align:center}
.acts{position:fixed;top:8px;right:8px}@media print{.acts{display:none}}
button{background:#0e7c5a;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer}
</style></head><body>
<div class="acts"><button onclick="window.print()">Salvar / Imprimir PDF</button></div>
<div class="top">
  <div class="logo"><div class="mark">BN</div><div><div class="nome">BN Med Saúde</div><div class="slogan">Integramos Processos, Otimizamos Cuidado</div></div></div>
  <div class="contato"><b>BN Med Saúde Ltda</b><br>Belém/PA<br>(91) 99299-2424 · (91) 99248-3639<br>licitacaobnsaude@gmail.com</div>
</div>
<h1>Informativo de Faturamento — ${esc(u.name)}</h1>
<p class="sub">Equipe de Oftalmologia BN Med</p>
<div class="resumo">
  <div class="rc"><div class="k">Competência</div><div class="v">${compMeses} / ${ano}</div></div>
  <div class="rc"><div class="k">Valor por atendimento</div><div class="v">${brl(rate)}</div></div>
  <div class="rc"><div class="k">Dias de atendimento</div><div class="v">${dias.length} dias</div></div>
</div>
<table>
  <thead><tr><th>Data</th><th class="c">Manhã</th><th class="c">Tarde</th><th class="c">Total</th><th class="r">Valor</th></tr></thead>
  <tbody>${linhas}</tbody>
  <tfoot><tr><td>TOTAL DO PERÍODO</td><td class="c">${tm}</td><td class="c">${tt}</td><td class="c">${totGeral}</td><td class="r">${brl(totGeral * rate)}</td></tr></tfoot>
</table>
<div class="total"><div><div class="lbl">Valor total a faturar</div><div class="mut" style="font-size:10px;opacity:.85">${totGeral} pacientes (${tm} manhã · ${tt} tarde)</div></div><div class="big">${brl(totGeral * rate)}</div></div>
<p class="mut">Solicitamos a gentileza de confirmação do recebimento deste informativo, bem como a indicação do prazo de pagamento. Permanecemos à disposição para qualquer esclarecimento.</p>
<div class="assin">Atenciosamente,<br><br><b>Fernando S. V. Pinheiro Filho</b><span class="mut">Engenheiro de Produção · CREA/PA 1521414653</span><span class="mut">Diretor de Operações · BN Med Saúde</span></div>
<div class="foot">BN Med Saúde Ltda · Belém/PA · Documento gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Permita pop-ups para gerar o PDF.', true); return; }
    w.document.write(html); w.document.close();
  },
  gerarPDFMedico(physId, unitId) {
    const u = state.units.find(x => x.id === unitId); const med = physName(physId);
    const rate = state.rates.filter(r => r.unit_id === unitId);
    const repOf = pk => Number((rate.find(r => r.period_key === pk) || {}).transfer_per_patient || 0);
    const labOf = pk => (rate.find(r => r.period_key === pk) || {}).period_label || pk;
    const slots = (state.allSlots || []).filter(s => s.physician_id === physId && s.unit_id === unitId && ['preenchido', 'confirmado'].includes(s.status) && Number(s.patients || 0) > 0).sort((a, b) => (a.slot_date || '').localeCompare(b.slot_date || ''));
    if (!slots.length) { toast('Sem produção deste médico nesta unidade.', true); return; }
    const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const fmtD = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let tp = 0, tr = 0;
    const linhas = slots.map(s => { const q = Number(s.patients || 0), rep = q * repOf(s.period_key); tp += q; tr += rep; return `<tr><td>${fmtD(s.slot_date)}</td><td>${esc(labOf(s.period_key))}</td><td class="c">${q}</td><td class="r">${brl(rep)}</td></tr>`; }).join('');
    const comp = [...new Set(slots.map(s => MES[parseInt(s.slot_date.slice(5, 7)) - 1]))].join(' · ');
    const ano = slots[0].slot_date.slice(0, 4);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Produção ${esc(med)}</title>
<style>@page{margin:14mm}*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2a24;margin:0;font-size:12px}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e7c5a;padding-bottom:10px}
.logo{display:flex;align-items:center;gap:10px}.logo .mark{width:46px;height:46px;border-radius:10px;background:#0e7c5a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px}
.logo .nome{font-weight:800;color:#0e7c5a;font-size:16px;line-height:1.1}.logo .slogan{color:#6b7a73;font-size:9px;letter-spacing:.5px;text-transform:uppercase}
.contato{text-align:right;color:#4a5a52;font-size:10px;line-height:1.5}
h1{font-size:15px;color:#0e7c5a;margin:16px 0 2px}.sub{color:#6b7a73;margin:0 0 12px;font-size:11px}
.resumo{display:flex;gap:10px;margin:0 0 14px}.rc{flex:1;border:1px solid #d8e2dc;border-top:3px solid #0e7c5a;border-radius:8px;padding:8px 10px}
.rc .k{font-size:9px;color:#6b7a73;text-transform:uppercase}.rc .v{font-size:14px;font-weight:700;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}th{background:#0e7c5a;color:#fff;font-size:10px;text-transform:uppercase;padding:7px 8px;text-align:left}
th.c,td.c{text-align:center}th.r,td.r{text-align:right}td{padding:6px 8px;border-bottom:1px solid #eef3f0}tr:nth-child(even) td{background:#f7faf9}
tfoot td{border-top:2px solid #0e7c5a;font-weight:700;background:#eef7f3}
.total{display:flex;justify-content:space-between;align-items:center;background:#0e7c5a;color:#fff;border-radius:8px;padding:12px 16px;margin:4px 0 18px}
.total .lbl{font-size:11px;text-transform:uppercase}.total .big{font-size:22px;font-weight:800}
.assin{margin-top:26px;font-size:11px}.assin b{display:block}.mut{color:#6b7a73;display:block}
.foot{margin-top:24px;border-top:1px solid #d8e2dc;padding-top:6px;color:#8a9790;font-size:9px;text-align:center}
.acts{position:fixed;top:8px;right:8px}@media print{.acts{display:none}}button{background:#0e7c5a;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer}</style></head><body>
<div class="acts"><button onclick="window.print()">Salvar / Imprimir PDF</button></div>
<div class="top"><div class="logo"><div class="mark">BN</div><div><div class="nome">BN Med Saúde</div><div class="slogan">Integramos Processos, Otimizamos Cuidado</div></div></div>
<div class="contato"><b>BN Med Saúde Ltda</b><br>Belém/PA<br>(91) 99299-2424 · (91) 99248-3639<br>licitacaobnsaude@gmail.com</div></div>
<h1>Demonstrativo de Produção Médica</h1>
<p class="sub">${esc(med)} — ${esc(u ? u.name : '')}</p>
<div class="resumo"><div class="rc"><div class="k">Competência</div><div class="v">${comp} / ${ano}</div></div>
<div class="rc"><div class="k">Dias trabalhados</div><div class="v">${slots.length}</div></div>
<div class="rc"><div class="k">Atendimentos</div><div class="v">${tp}</div></div></div>
<table><thead><tr><th>Data</th><th>Turno</th><th class="c">Pacientes</th><th class="r">Repasse</th></tr></thead>
<tbody>${linhas}</tbody>
<tfoot><tr><td colspan="2">TOTAL</td><td class="c">${tp}</td><td class="r">${brl(tr)}</td></tr></tfoot></table>
<div class="total"><div><div class="lbl">Total a repassar</div><div class="mut" style="font-size:10px;opacity:.85">${tp} pacientes em ${slots.length} dia(s)</div></div><div class="big">${brl(tr)}</div></div>
<p class="mut">Documento de conferência de produção e repasse. Em caso de divergência, favor comunicar à gestão.</p>
<div class="assin">Atenciosamente,<br><br><b>Fernando S. V. Pinheiro Filho</b><span class="mut">Diretor de Operações · BN Med Saúde</span></div>
<div class="foot">BN Med Saúde Ltda · Belém/PA · Documento gerado em ${new Date().toLocaleDateString('pt-BR')}</div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Permita pop-ups para gerar o PDF.', true); return; }
    w.document.write(html); w.document.close();
  },
};
window.BN = BN;

// =====================================================================
// CALENDÁRIO
// =====================================================================
function semanasDoMes(ym) {
  const [y, m] = ym.split('-').map(Number);
  const dias = new Date(y, m, 0).getDate();
  const semanas = []; let atual = null;
  for (let d = 1; d <= dias; d++) {
    const dt = new Date(y, m - 1, d);
    const wd = dt.getDay();
    if (wd === 0 || !atual) { // nova semana no domingo (ou no 1º dia)
      atual = { label: '', days: [] }; semanas.push(atual);
    }
    atual.days.push({ d, wd, iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  semanas.forEach((s, i) => s.label = `Semana ${i + 1} · ${s.days[0].d} a ${s.days[s.days.length - 1].d}`);
  return semanas;
}

// =====================================================================
// BOOT
// =====================================================================
async function boot() {
  if (!URL || !KEY) { app.innerHTML = '<div class="vazio-aviso">Configure supabaseUrl e supabasePublishableKey em config.js (use os mesmos valores do GSER).</div>'; return; }
  if (!state.session) return renderLogin();
  try {
    state.profile = await loadProfile();
    if (!state.profile || !state.profile.is_active) {
      app.innerHTML = '<div class="vazio-aviso">Sua conta ainda não foi liberada pela gerência.</div>';
      return;
    }
    render();
    await loadData();
    render();
  } catch (e) {
    if (/JWT|token|401|403/i.test(e.message)) { setSession(null); return renderLogin(); }
    state.error = e.message; app.innerHTML = `<div class="vazio-aviso">${esc(e.message)}</div>`;
  }
}
boot();
