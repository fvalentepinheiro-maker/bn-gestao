// =====================================================================
// GERENCIAL BN — Casco do sistema: login, menu lateral e troca de telas.
// Cada tela é um módulo em js/modulos/ com { id, titulo, icone, render(), acoes }.
// =====================================================================
import * as N from './nucleo.js';
import inicio from './modulos/inicio.js';
import escala from './modulos/escala.js';
import repasse from './modulos/repasse.js';
import financeiro from './modulos/financeiro.js';
import contratos from './modulos/contratos.js';
import pessoas from './modulos/pessoas.js';
import qualidade from './modulos/qualidade.js';
import processos from './modulos/processos.js';
import usuarios from './modulos/usuarios.js';

const { esc } = N;
const MODULOS = [inicio, escala, repasse, financeiro, contratos, pessoas, qualidade, processos, usuarios];
const GRUPOS = [['', ['inicio']], ['Operação', ['escala', 'repasse']], ['Gestão', ['financeiro', 'contratos', 'processos']], ['Cadastros', ['pessoas', 'qualidade', 'usuarios']]];
const app = document.getElementById('app');
const PERFIL = { gestor: 'Gestor', operador: 'Operador', consulta: 'Consulta' };
let atual = null, menuAberto = false;

const icone = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const MARCA = `<div class="marca"><span class="marca-sinal">BN</span><div><b>Gerencial BN</b><small>Integramos Processos, Otimizamos Cuidado</small></div></div>`;

// ---------------- telas de entrada ----------------
function telaEntrada(modo = 'entrar', msg = '', erro = '') {
  const titulos = { entrar: 'Entrar no sistema', criar: 'Solicitar acesso', esqueci: 'Recuperar senha', nova: 'Definir nova senha' };
  app.innerHTML = `<div class="entrada"><form class="entrada-cartao" novalidate>${MARCA}
    <h1>${titulos[modo]}</h1>
    ${msg ? `<p class="nota">${esc(msg)}</p>` : ''}
    ${modo === 'criar' ? '<div class="campo"><label for="e_nome">Seu nome</label><input id="e_nome" autocomplete="name"></div>' : ''}
    ${modo !== 'nova' ? '<div class="campo"><label for="e_email">E-mail</label><input id="e_email" type="email" autocomplete="username"></div>' : ''}
    ${modo !== 'esqueci' ? `<div class="campo"><label for="e_senha">${modo === 'nova' ? 'Nova senha' : 'Senha'}</label><input id="e_senha" type="password" autocomplete="${modo === 'entrar' ? 'current-password' : 'new-password'}"></div>` : ''}
    <div class="erro-form" role="alert">${esc(erro)}</div>
    <button class="botao principal cheio" type="submit">${{ entrar: 'Entrar', criar: 'Criar conta', esqueci: 'Enviar link', nova: 'Salvar senha' }[modo]}</button>
    <div class="entrada-links">
      ${modo === 'entrar' ? '<button type="button" data-ir="criar">Solicitar acesso</button><button type="button" data-ir="esqueci">Esqueci a senha</button>' : ''}
      ${modo === 'criar' || modo === 'esqueci' ? '<button type="button" data-ir="entrar">Já tenho conta</button>' : ''}
    </div></form></div>`;
  const form = app.querySelector('form'), v = (id) => form.querySelector('#' + id)?.value.trim() || '';
  form.querySelectorAll('[data-ir]').forEach((b) => { b.onclick = () => telaEntrada(b.dataset.ir); });
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try {
      if (modo === 'entrar') { await N.entrar(v('e_email'), form.querySelector('#e_senha').value); await iniciar(); }
      else if (modo === 'criar') {
        if (!v('e_nome')) throw new Error('Informe seu nome.');
        const r = await N.criarConta(v('e_nome'), v('e_email'), form.querySelector('#e_senha').value);
        if (r?.access_token) await iniciar();
        else telaEntrada('entrar', 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois peça ao gestor para liberar seu acesso.');
      } else if (modo === 'esqueci') { await N.recuperarSenha(v('e_email')); telaEntrada('entrar', 'Se o e-mail tiver conta, o link de recuperação foi enviado.'); }
      else { await N.trocarSenha(form.querySelector('#e_senha').value); N.aviso('Senha alterada.'); await iniciar(); }
    } catch (e) { telaEntrada(modo, msg, e.message); }
  };
}

function telaEspera(titulo, texto) {
  app.innerHTML = `<div class="entrada"><div class="entrada-cartao">${MARCA}<h1>${esc(titulo)}</h1><p class="nota">${esc(texto)}</p>
    <button class="botao cheio" id="tentar">Tentar de novo</button><div class="entrada-links"><button id="sairEspera">Sair</button></div></div></div>`;
  app.querySelector('#tentar').onclick = iniciar;
  app.querySelector('#sairEspera').onclick = async () => { await N.sair(); telaEntrada(); };
}

// ---------------- casco com menu ----------------
const visiveis = () => MODULOS.filter((m) => !m.soGestor || N.ehGestor());
function moldura() {
  const u = N.estado.usuario, mods = visiveis();
  const item = (m) => `<a href="#/${m.id}" class="${m === atual ? 'ativo' : ''}" ${m === atual ? 'aria-current="page"' : ''}>${icone(m.icone)}<span>${esc(m.titulo)}</span></a>`;
  app.innerHTML = `<div class="casco${menuAberto ? ' menu-aberto' : ''}">
    <aside class="lateral">${MARCA}
      <nav aria-label="Menu principal">${GRUPOS.map(([g, ids]) => {
        const itens = ids.map((id) => mods.find((m) => m.id === id)).filter(Boolean);
        return itens.length ? `${g ? `<div class="grupo">${g}</div>` : ''}${itens.map(item).join('')}` : '';
      }).join('')}</nav>
      <div class="quem"><b>${esc(u.nome)}</b><small>${PERFIL[u.perfil]}</small>
        <div><button data-casco="senha">Trocar senha</button><button data-casco="sair">Sair</button></div></div>
    </aside>
    <div class="veu" data-casco="menu"></div>
    <div class="palco">
      <header class="topo"><button class="so-celular icone-botao" data-casco="menu" aria-label="Abrir menu">${icone('<path d="M4 7h16M4 12h16M4 17h16"/>')}</button>
        <h1>${esc(atual.titulo)}</h1>
        ${N.podeEditar() ? '' : '<span class="selo parcial">somente consulta</span>'}</header>
      <main id="tela" tabindex="-1"></main>
    </div></div>`;
  desenhar();
}
function desenhar() {
  const tela = document.getElementById('tela');
  if (!tela) return;
  const foco = document.activeElement?.dataset?.foco, rolagem = tela.parentElement.scrollTop;
  try { tela.innerHTML = atual.render(); }
  catch (e) { console.error(e); tela.innerHTML = `<div class="vazio">Não consegui montar esta tela: ${esc(e.message)}</div>`; }
  tela.parentElement.scrollTop = rolagem;
  if (foco) tela.querySelector(`[data-foco="${CSS.escape(foco)}"]`)?.focus();
}
N.definirRedesenho(desenhar);

function navegar() {
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
  const alvo = visiveis().find((m) => m.id === id) || inicio;
  if (alvo !== atual) { atual = alvo; menuAberto = false; moldura(); document.querySelector('.palco')?.scrollTo(0, 0); }
}

async function executar(nome, el, ev) {
  const acao = atual?.acoes?.[nome];
  if (!acao) return;
  try { await acao(el.dataset, el, ev); } catch (e) { console.error(e); N.aviso(e.message, true); }
}
app.addEventListener('click', async (ev) => {
  const c = ev.target.closest('[data-casco]');
  if (c) {
    if (c.dataset.casco === 'menu') { menuAberto = !menuAberto; app.querySelector('.casco').classList.toggle('menu-aberto', menuAberto); }
    if (c.dataset.casco === 'sair') { await N.sair(); atual = null; telaEntrada(); }
    if (c.dataset.casco === 'senha') N.abrirFormulario({ titulo: 'Trocar senha', campos: [{ id: 'senha', rotulo: 'Nova senha (mínimo 6 caracteres)', obrigatorio: true }],
      aoSalvar: async (v) => { await N.trocarSenha(v.senha); N.aviso('Senha alterada.'); } });
    return;
  }
  const el = ev.target.closest('[data-acao]');
  if (el && !el.disabled) executar(el.dataset.acao, el, ev);
});
app.addEventListener('change', (ev) => { const el = ev.target.closest('[data-mudar]'); if (el) executar(el.dataset.mudar, el, ev); });
window.addEventListener('hashchange', () => { if (N.estado.usuario?.ativo) navegar(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') N.fecharJanela();
  if (ev.key === 'Enter' && ev.target.matches?.('[role=button][data-acao]')) ev.target.click();
});

// ---------------- partida ----------------
async function iniciar() {
  // Link de "recuperar senha" chega com o acesso no endereço (#access_token=...&type=recovery)
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('access_token')) {
    N.guardarSessao({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600) });
    const recuperacao = h.get('type') === 'recovery';
    history.replaceState(null, '', location.pathname);
    if (recuperacao) return telaEntrada('nova', 'Escolha sua nova senha.');
  }
  if (!N.estado.sessao) return telaEntrada();
  app.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    if (!N.estado.sessao.user) N.estado.sessao.user = await N.pedir('/auth/v1/user');
    const u = await N.carregarUsuario();
    if (!u) return telaEspera('Cadastro não encontrado', 'Sua conta existe, mas não há ficha de usuário. Peça ao gestor para verificar.');
    if (!u.ativo) return telaEspera('Aguardando liberação', 'Sua conta foi criada, mas ainda não foi liberada. Peça ao gestor para ativar seu acesso em Usuários.');
    await N.carregarTudo();
    atual = null; navegar();
  } catch (e) {
    if (e.status === 401 || /JWT|token/i.test(e.message)) { N.guardarSessao(null); return telaEntrada('entrar', 'Sua sessão expirou. Entre de novo.'); }
    telaEspera('Não foi possível abrir', e.message);
  }
}
iniciar();
