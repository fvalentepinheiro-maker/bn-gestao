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
  const [units, rates, phys, pu, contracts] = await Promise.all([
    rows('cm_schedule_units', '&order=display_order'),
    rows('cm_schedule_period_rates'),
    rows('cm_physicians', '&order=full_name'),
    rows('cm_physician_units'),
    rows('cm_contracts', '&select=id,contract_number,supplier_name&order=supplier_name'),
  ]);
  state.units = units || []; state.rates = rates || []; state.physicians = phys || []; state.physUnits = pu || []; state.contracts = contracts || [];
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

  el.innerHTML = semanas.map(sem => {
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
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="cards-kpi">
      <div class="kpi"><div class="rotulo">Faturamento previsto</div><div class="valor">${money(totFat)}</div></div>
      <div class="kpi"><div class="rotulo">Repasse aos médicos</div><div class="valor" style="color:var(--verde)">${money(totRep)}</div></div>
      <div class="kpi"><div class="rotulo">Imposto (${(taxa * 100).toFixed(0)}%)</div><div class="valor" style="color:var(--laranja)">${money(totImp)}</div></div>
      <div class="kpi"><div class="rotulo">Margem (fat − repasse − imposto)</div><div class="valor" style="color:var(--azul)">${money(totMar)}</div></div>
    </div>
    ${agg.length ? `<table>
      <thead><tr><th>Médico</th><th>Unidade</th><th>Pac.</th><th>Faturamento</th><th>Repasse devido</th><th>Pago ao médico</th><th>Recebido do cliente</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>` : '<div class="vazio-aviso">Nenhuma produção lançada nesta competência.</div>'}`;
}

// ---- cadastro de médicos ----
function renderMedicos(el) {
  const linhas = state.physicians.map(p => {
    const units = state.physUnits.filter(x => x.physician_id === p.id).map(x => unitBySlug_byId(x.unit_id)?.name).filter(Boolean);
    return `<tr>
      <td>${esc(p.full_name)}</td><td>${esc(p.crm || '—')}</td><td>${esc(p.specialty || '—')}</td>
      <td>${esc(p.phone || '—')}</td><td>${units.map(esc).join(', ') || '—'}</td>
      <td>${p.is_active ? '<span class="chip completo">ativo</span>' : '<span class="chip pendente">inativo</span>'}</td>
      ${canEdit() ? `<td><select id="vu_${p.id}"><option value="">unidade…</option>${state.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select> <button class="btn" onclick="BN.vincular('${p.id}')">+</button></td>` : ''}
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
    return `<tr><td>${esc(u.name)}</td><td>${esc(contrName(u.contract_id))}</td><td>${((u.tax_rate || 0) * 100).toFixed(0)}%</td><td>${rs || '—'}</td></tr>`;
  }).join('');
  const contrOpts = ['<option value="">— contrato —</option>', ...(state.contracts || []).map(c => `<option value="${c.id}">${esc(c.contract_number)} · ${esc(c.supplier_name)}</option>`)].join('');
  el.innerHTML = `
    ${canEdit() ? `<div class="row-form">
      <label>Serviço/Unidade<input type="text" id="svNome" placeholder="Ex.: Mãe do Rio"></label>
      <label>Contrato<select id="svContr">${contrOpts}</select></label>
      <label>Imposto %<input type="number" id="svTax" value="17" style="width:70px"></label>
      <label>Manhã fat.<input type="number" id="svMF" value="0" style="width:80px"></label>
      <label>Manhã rep.<input type="number" id="svMR" value="0" style="width:80px"></label>
      <label>Tarde fat.<input type="number" id="svTF" value="0" style="width:80px"></label>
      <label>Tarde rep.<input type="number" id="svTR" value="0" style="width:80px"></label>
      <button class="btn primario" onclick="BN.addServico()">Cadastrar serviço</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Serviço / Unidade</th><th>Contrato</th><th>Imposto</th><th>Turnos (faturamento / repasse por paciente)</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="4" class="vazio-aviso">Nenhum serviço cadastrado.</td></tr>'}</tbody>
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
  abrirMedico, fecharModal() { document.getElementById('overlay').classList.remove('visivel'); },
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
      }, 'slug');
      await upsert('cm_schedule_period_rates', [
        { unit_id: u.id, period_key: 'manha', period_label: 'Manhã', billing_per_patient: num('svMF'), transfer_per_patient: num('svMR'), display_order: 1 },
        { unit_id: u.id, period_key: 'tarde', period_label: 'Tarde', billing_per_patient: num('svTF'), transfer_per_patient: num('svTR'), display_order: 2 },
      ], 'unit_id,period_key');
      await loadData(); toast('Serviço cadastrado.'); render();
    } catch (e) { toast(e.message, true); }
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
