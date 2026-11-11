// =====================================================================
// GERENCIAL BN — Núcleo: conexão com o banco, sessão, dados em memória e
// peças de tela reaproveitadas por todos os módulos (aviso, janela, formulário).
// =====================================================================
const cfg = globalThis.BN_CONFIG || {};
const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
const CHAVE = String(cfg.supabaseKey || '');
const CH_SESSAO = 'bn.sessao.v1';

// ---------------- utilidades ----------------
export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const dataBR = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
export const diaMes = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');
export const mesBR = (mes) => (mes ? MESES[parseInt(mes.slice(5, 7), 10) - 1] + '/' + mes.slice(0, 4) : '—');
export const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const num = (v) => { let t = String(v ?? '').trim(); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const n = Number(t); return Number.isFinite(n) ? n : 0; };
export const slug = (s) => semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------------- sessão ----------------
export const estado = { sessao: null, usuario: null };
try { estado.sessao = JSON.parse(localStorage.getItem(CH_SESSAO)); } catch { /* sem sessão guardada */ }

export function guardarSessao(s) {
  estado.sessao = s;
  try { s ? localStorage.setItem(CH_SESSAO, JSON.stringify(s)) : localStorage.removeItem(CH_SESSAO); } catch { /* navegador sem armazenamento */ }
}
const comValidade = (s) => ({ ...s, expires_at: Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600) });

// ---------------- rede ----------------
let renovando = null;
const TRADUCAO = [
  [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/Email not confirmed/i, 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.'],
  [/User already registered/i, 'Este e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".'],
  [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/row-level security|permission denied/i, 'Seu perfil não tem permissão para isso.'],
  [/duplicate key/i, 'Já existe um registro igual a este.'],
  [/violates foreign key/i, 'Este registro está em uso em outro lugar e não pode ser apagado.'],
  [/Could not find the table|relation .* does not exist|schema cache/i, 'O banco novo ainda não foi instalado. Rode os arquivos da pasta "banco" no Supabase.'],
  [/Failed to fetch|NetworkError|Load failed|timed out|aborted/i, 'Sem resposta do banco. Verifique a internet — ou se o projeto no Supabase está pausado.'],
];
function traduzir(msg) { for (const [re, pt] of TRADUCAO) if (re.test(msg)) return pt; return msg; }

export async function pedir(caminho, { metodo = 'GET', corpo, autenticado = true, cabecalhos = {} } = {}) {
  if (!BASE || !CHAVE) throw new Error('Sistema sem configuração de banco (config.js).');
  if (autenticado && estado.sessao && estado.sessao.expires_at < Date.now() / 1000 + 45) {
    renovando ||= pedir('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', corpo: { refresh_token: estado.sessao.refresh_token }, autenticado: false })
      .then((s) => guardarSessao(comValidade(s)))
      .catch((e) => { guardarSessao(null); throw e; })
      .finally(() => { renovando = null; });
    await renovando;
  }
  const h = { apikey: CHAVE, ...cabecalhos };
  if (autenticado && estado.sessao) h.Authorization = 'Bearer ' + estado.sessao.access_token;
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(BASE + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(25000) });
  } catch (e) { throw new Error(traduzir(e.message || 'Failed to fetch')); }
  if (!r.ok) {
    let e = {}; try { e = await r.json(); } catch { /* resposta sem corpo */ }
    const err = new Error(traduzir(e.msg || e.message || e.error_description || e.error || 'Falha na operação (' + r.status + ').'));
    err.status = r.status; throw err;
  }
  if (r.status === 204) return null;
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}

// ---------------- autenticação ----------------
export async function entrar(email, senha) {
  guardarSessao(comValidade(await pedir('/auth/v1/token?grant_type=password', { metodo: 'POST', corpo: { email, password: senha }, autenticado: false })));
}
export async function criarConta(nome, email, senha) {
  const r = await pedir('/auth/v1/signup', { metodo: 'POST', corpo: { email, password: senha, data: { nome } }, autenticado: false });
  if (r?.access_token) guardarSessao(comValidade(r));
  return r;
}
export const recuperarSenha = (email) => pedir('/auth/v1/recover', { metodo: 'POST', corpo: { email }, autenticado: false });
export const trocarSenha = (senha) => pedir('/auth/v1/user', { metodo: 'PUT', corpo: { password: senha } });
export async function sair() {
  try { await pedir('/auth/v1/logout', { metodo: 'POST' }); } catch { /* sai de qualquer jeito */ }
  guardarSessao(null); estado.usuario = null;
}
export const podeEditar = () => !!estado.usuario?.ativo && ['gestor', 'operador'].includes(estado.usuario.perfil);
export const ehGestor = () => !!estado.usuario?.ativo && estado.usuario.perfil === 'gestor';

// ---------------- dados em memória ----------------
// O volume é pequeno, então o sistema carrega tudo ao entrar e trabalha em memória;
// cada gravação vai para o banco e atualiza a cópia local.
export const TABELAS = ['usuarios', 'contratos', 'unidades', 'turnos', 'pessoas', 'pessoa_unidades', 'escala', 'repasses', 'lancamentos', 'documentos', 'processos', 'tarefas'];
export const dados = Object.fromEntries(TABELAS.map((t) => [t, []]));
const rota = (t) => '/rest/v1/bn_' + t;
const VOLTA = { Prefer: 'return=representation' };

async function listarTudo(tabela) {
  const tudo = []; const passo = 1000;
  for (let ini = 0; ; ini += passo) {   // o Supabase devolve no máximo 1000 linhas por vez
    const parte = await pedir(rota(tabela) + '?select=*&order=id&limit=' + passo + '&offset=' + ini);
    tudo.push(...parte);
    if (parte.length < passo) return tudo;
  }
}
export async function carregarUsuario() {
  const id = estado.sessao?.user?.id;
  if (!id) return null;
  const r = await pedir(rota('usuarios') + '?select=*&id=eq.' + id);
  estado.usuario = r[0] || null;
  return estado.usuario;
}
export async function carregarTudo() {
  const listas = await Promise.all(TABELAS.map(listarTudo));
  TABELAS.forEach((t, i) => { dados[t] = listas[i]; });
}

function trocarLocal(tabela, linha) {
  const i = dados[tabela].findIndex((x) => x.id === linha.id);
  if (i >= 0) dados[tabela][i] = linha; else dados[tabela].push(linha);
}
// Cria (sem id) ou altera (com id) uma linha.
export async function salvar(tabela, linha) {
  const { id, ...resto } = linha;
  const r = id
    ? await pedir(rota(tabela) + '?id=eq.' + id, { metodo: 'PATCH', corpo: resto, cabecalhos: VOLTA })
    : await pedir(rota(tabela), { metodo: 'POST', corpo: resto, cabecalhos: VOLTA });
  if (!r?.[0]) throw new Error('Nada foi gravado. Seu perfil pode não ter permissão.');
  trocarLocal(tabela, r[0]);
  return r[0];
}
// Grava várias linhas; se já existir uma com a mesma chave (conflito), atualiza.
export async function gravarVarios(tabela, linhas, conflito) {
  if (!linhas.length) return [];
  const r = await pedir(rota(tabela) + '?on_conflict=' + conflito, { metodo: 'POST', corpo: linhas, cabecalhos: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  (r || []).forEach((l) => trocarLocal(tabela, l));
  return r || [];
}
export async function excluir(tabela, id) {
  await pedir(rota(tabela) + '?id=eq.' + id, { metodo: 'DELETE' });
  dados[tabela] = dados[tabela].filter((x) => x.id !== id);
}
export const achar = (tabela, id) => dados[tabela].find((x) => x.id === id);
export const nomePessoa = (id) => achar('pessoas', id)?.nome || '—';
export const nomeUnidade = (id) => achar('unidades', id)?.nome || '—';
export const rotuloContrato = (id) => { const c = achar('contratos', id); return c ? c.numero + ' · ' + c.cliente : '—'; };
export const unidadesAtivas = () => dados.unidades.filter((u) => u.ativo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
export const turnosDa = (unidadeId) => dados.turnos.filter((t) => t.unidade_id === unidadeId).sort((a, b) => a.ordem - b.ordem);

// ---------------- peças de tela ----------------
let relogioAviso;
export function aviso(texto, erro = false) {
  const n = document.getElementById('aviso');
  n.textContent = texto; n.className = 'aviso visivel' + (erro ? ' erro' : '');
  clearTimeout(relogioAviso); relogioAviso = setTimeout(() => { n.className = 'aviso'; }, erro ? 7000 : 3500);
}
export const selo = (cls, txt) => `<span class="selo ${cls}">${esc(txt)}</span>`;

const fundo = () => document.getElementById('janela');
export function fecharJanela() { fundo().className = 'fundo'; fundo().innerHTML = ''; }
// Abre uma janela com HTML livre. Devolve o elemento para o módulo ligar seus eventos.
export function abrirJanela(titulo, html, { larga = false } = {}) {
  const f = fundo();
  f.innerHTML = `<div class="janela${larga ? ' larga' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    <div class="janela-topo"><h3>${esc(titulo)}</h3><button class="x" data-fechar aria-label="Fechar">×</button></div>
    <div class="janela-corpo">${html}</div></div>`;
  f.className = 'fundo visivel';
  f.onclick = (e) => { if (e.target === f || e.target.closest('[data-fechar]')) fecharJanela(); };
  return f.querySelector('.janela-corpo');
}
export function confirmar(texto, rotulo = 'Confirmar') {
  return new Promise((ok) => {
    const c = abrirJanela('Confirmação', `<p class="texto">${esc(texto)}</p>
      <div class="acoes"><button class="botao" data-nao>Cancelar</button><button class="botao perigo" data-sim>${esc(rotulo)}</button></div>`);
    c.querySelector('[data-sim]').onclick = () => { fecharJanela(); ok(true); };
    c.querySelector('[data-nao]').onclick = () => { fecharJanela(); ok(false); };
  });
}

// Formulário genérico. campos: [{id, rotulo, tipo, valor, opcoes, obrigatorio, meio, dica}]
// tipos: texto | numero | dinheiro | data | mes | escolha | sim | area | varios
export function abrirFormulario({ titulo, campos, aoSalvar, aoExcluir, rotuloSalvar = 'Salvar' }) {
  const campo = (c) => {
    const v = c.valor ?? '';
    const base = `id="f_${c.id}" name="${c.id}"`;
    let ctl;
    if (c.tipo === 'escolha') ctl = `<select ${base}>${c.opcoes.map(([k, r]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
    else if (c.tipo === 'sim') return `<label class="campo marca${c.meio ? ' meio' : ''}"><input type="checkbox" ${base} ${v ? 'checked' : ''}> <span>${esc(c.rotulo)}</span></label>`;
    else if (c.tipo === 'area') ctl = `<textarea ${base} rows="3">${esc(v)}</textarea>`;
    else if (c.tipo === 'varios') ctl = `<div class="varios">${c.opcoes.map(([k, r]) => `<label><input type="checkbox" name="${c.id}" value="${esc(k)}" ${(v || []).includes(k) ? 'checked' : ''}> ${esc(r)}</label>`).join('') || '<span class="fraco">Nada para escolher.</span>'}</div>`;
    else {
      const t = { numero: 'number', dinheiro: 'number', data: 'date', mes: 'month', texto: 'text' }[c.tipo || 'texto'];
      ctl = `<input type="${t}" ${base} value="${esc(v)}" ${c.tipo === 'dinheiro' ? 'step="0.01" min="0" inputmode="decimal"' : ''} ${c.tipo === 'numero' ? 'step="any" inputmode="decimal"' : ''}>`;
    }
    return `<div class="campo${c.meio ? ' meio' : ''}"><label for="f_${c.id}">${esc(c.rotulo)}${c.obrigatorio ? ' *' : ''}</label>${ctl}${c.dica ? `<small>${esc(c.dica)}</small>` : ''}</div>`;
  };
  const corpo = abrirJanela(titulo, `<form class="formulario" novalidate>${campos.map(campo).join('')}
    <div class="erro-form" role="alert"></div>
    <div class="acoes">${aoExcluir ? '<button type="button" class="botao perigo esquerda" data-excluir>Excluir</button>' : ''}
      <button type="button" class="botao" data-fechar>Cancelar</button><button type="submit" class="botao principal">${esc(rotuloSalvar)}</button></div></form>`);
  const form = corpo.querySelector('form'), erro = corpo.querySelector('.erro-form');
  form.onsubmit = async (ev) => {
    ev.preventDefault(); erro.textContent = '';
    const v = {};
    for (const c of campos) {
      const el = form.querySelector('#f_' + c.id);
      if (c.tipo === 'varios') v[c.id] = [...form.querySelectorAll(`input[name="${c.id}"]:checked`)].map((x) => x.value);
      else if (c.tipo === 'sim') v[c.id] = el.checked;
      else if (c.tipo === 'numero' || c.tipo === 'dinheiro') v[c.id] = el.value === '' ? null : Number(el.value);
      else v[c.id] = el.value.trim() === '' ? null : el.value.trim();
      if (c.obrigatorio && (v[c.id] === null || v[c.id] === '')) { erro.textContent = 'Preencha: ' + c.rotulo + '.'; el.focus(); return; }
      if ((c.tipo === 'numero' || c.tipo === 'dinheiro') && v[c.id] !== null && (!Number.isFinite(v[c.id]) || v[c.id] < 0)) { erro.textContent = c.rotulo + ': informe um número válido.'; el.focus(); return; }
    }
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try { await aoSalvar(v); fecharJanela(); } catch (e) { erro.textContent = e.message; b.disabled = false; }
  };
  const bx = corpo.querySelector('[data-excluir]');
  if (bx) bx.onclick = async () => { try { await aoExcluir(); } catch (e) { aviso(e.message, true); } };
  return form;
}

export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); aviso('Copiado.'); }
  catch { aviso('Não consegui copiar sozinho — selecione o texto e copie.', true); }
}
// Abre uma página pronta para imprimir / salvar em PDF.
export function imprimir(titulo, html) {
  const w = window.open('', '_blank');
  if (!w) { aviso('O navegador bloqueou a nova aba. Libere pop-ups para este site.', true); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>${html}</html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}

// O "casco" (app.js) registra aqui a função que redesenha a tela atual; os módulos só chamam redesenhar().
let _redesenhar = () => {};
export const definirRedesenho = (fn) => { _redesenhar = fn; };
export const redesenhar = () => _redesenhar();
