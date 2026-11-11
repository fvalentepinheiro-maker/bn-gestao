// PROCESSOS E PROJETOS — credenciamentos, licitações e projetos por etapa, com lista de tarefas.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { tipo: '', encerrados: false };
const ETAPAS = [['prospeccao', 'Prospecção'], ['documentacao', 'Documentação'], ['proposta', 'Proposta enviada'], ['analise', 'Em análise'], ['contratado', 'Contratado'], ['encerrado', 'Encerrado / perdido']];
const TIPOS = [['credenciamento', 'Credenciamento'], ['licitacao', 'Licitação'], ['projeto', 'Projeto'], ['interno', 'Interno']];
const rot = (lista, k) => (lista.find((x) => x[0] === k) || [k, k])[1];
const tarefasDe = (id) => dados.tarefas.filter((t) => t.processo_id === id).sort((a, b) => Number(a.feito) - Number(b.feito) || (a.prazo || '9999').localeCompare(b.prazo || '9999'));
function prazoSelo(prazo, hoje) {
  if (!prazo) return '';
  const s = C.situacaoDocumento(prazo, hoje);
  return N.selo(s.dias < 0 ? 'pendente' : s.dias <= 7 ? 'parcial' : 'neutro', s.dias < 0 ? 'atrasado ' + -s.dias + 'd' : s.dias === 0 ? 'hoje' : N.diaMes(prazo));
}

function render() {
  const pode = N.podeEditar(), hoje = N.hoje();
  const ls = dados.processos.filter((p) => !st.tipo || p.tipo === st.tipo);
  const colunas = ETAPAS.filter(([k]) => st.encerrados || k !== 'encerrado').map(([k, r]) => {
    const itens = ls.filter((p) => p.etapa === k).sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
    return `<section class="coluna"><header><b>${r}</b><span>${itens.length}</span></header>${itens.map((p) => {
      const ts = tarefasDe(p.id), feitas = ts.filter((t) => t.feito).length;
      return `<article class="ficha" data-acao="abrir" data-id="${p.id}" tabindex="0" role="button">
        <small>${rot(TIPOS, p.tipo)}${p.orgao ? ' · ' + esc(p.orgao) : ''}</small><b>${esc(p.titulo)}</b>
        <div class="ficha-pe">${k === 'contratado' || k === 'encerrado' ? '' : prazoSelo(p.prazo, hoje)}${ts.length ? `<span class="fraco">${feitas}/${ts.length} tarefas</span>` : ''}${p.responsavel ? `<span class="fraco">${esc(p.responsavel)}</span>` : ''}</div>
        ${p.valor_estimado ? `<div class="fraco">${C.dinheiro(p.valor_estimado)}</div>` : ''}</article>`;
    }).join('') || '<p class="fraco centro">—</p>'}</section>`;
  }).join('');
  const f = (k, r) => `<button class="${st.tipo === k ? 'ativa' : ''}" data-acao="tipo" data-k="${k}">${r}</button>`;
  return `<div class="barra-acoes"><div class="abas juntas">${f('', 'Todos')}${TIPOS.map(([k, r]) => f(k, r)).join('')}</div>
      <label class="marca"><input type="checkbox" data-mudar="encerrados" ${st.encerrados ? 'checked' : ''}> mostrar encerrados</label><span class="empurra"></span>
      ${pode ? '<button class="botao principal" data-acao="editar">+ Processo</button>' : ''}</div>
    ${dados.processos.length ? `<div class="quadro">${colunas}</div>` : '<div class="vazio">Nenhum processo cadastrado. Cadastre aqui os credenciamentos e licitações em andamento para acompanhar etapa, prazo e pendências.</div>'}`;
}

function detalhe(id) {
  const p = N.achar('processos', id), pode = N.podeEditar(), hoje = N.hoje(), ts = tarefasDe(id);
  const c = N.abrirJanela(p.titulo, `<div class="resumo">
      <div><small>Tipo</small><b>${rot(TIPOS, p.tipo)}</b></div><div><small>Órgão</small><b>${esc(p.orgao || '—')}</b></div>
      <div><small>Prazo</small><b>${N.dataBR(p.prazo)}</b></div><div><small>Responsável</small><b>${esc(p.responsavel || '—')}</b></div>
      <div><small>Valor estimado</small><b>${p.valor_estimado ? C.dinheiro(p.valor_estimado) : '—'}</b></div>
      <div><small>Etapa</small><select data-etapa ${pode ? '' : 'disabled'}>${ETAPAS.map(([k, r]) => `<option value="${k}" ${p.etapa === k ? 'selected' : ''}>${r}</option>`).join('')}</select></div></div>
    ${p.obs ? `<p class="texto">${esc(p.obs)}</p>` : ''}
    <h4>Tarefas e pendências</h4>
    <ul class="tarefas">${ts.map((t) => `<li class="${t.feito ? 'feita' : ''}"><label><input type="checkbox" data-feito="${t.id}" ${t.feito ? 'checked' : ''} ${pode ? '' : 'disabled'}> <span>${esc(t.titulo)}</span></label>
      ${t.feito ? '' : prazoSelo(t.prazo, hoje)}${t.responsavel ? `<span class="fraco">${esc(t.responsavel)}</span>` : ''}${pode ? `<button class="x" data-apagar="${t.id}" aria-label="Excluir tarefa">×</button>` : ''}</li>`).join('') || '<li class="fraco">Nenhuma tarefa.</li>'}</ul>
    ${pode ? `<form class="nova-tarefa"><input name="titulo" placeholder="Nova tarefa (ex.: emitir CND estadual)" aria-label="Nova tarefa" required><input name="prazo" type="date" aria-label="Prazo"><button class="botao">Adicionar</button></form>` : ''}
    <div class="acoes">${pode ? '<button class="botao esquerda" data-editar>Editar processo</button>' : ''}<button class="botao principal" data-fechar>Fechar</button></div>`, { larga: true });
  const tenta = async (fn) => { try { await fn(); N.redesenhar(); detalhe(id); } catch (e) { N.aviso(e.message, true); } };
  c.querySelector('[data-etapa]').onchange = (ev) => tenta(() => N.salvar('processos', { id, etapa: ev.target.value }));
  c.querySelectorAll('[data-feito]').forEach((b) => { b.onchange = () => tenta(() => N.salvar('tarefas', { id: b.dataset.feito, feito: b.checked })); });
  c.querySelectorAll('[data-apagar]').forEach((b) => { b.onclick = () => tenta(() => N.excluir('tarefas', b.dataset.apagar)); });
  const nova = c.querySelector('.nova-tarefa');
  if (nova) nova.onsubmit = (ev) => { ev.preventDefault(); const t = nova.titulo.value.trim(); if (t) tenta(() => N.salvar('tarefas', { processo_id: id, titulo: t, prazo: nova.prazo.value || null })); };
  c.querySelector('[data-editar]')?.addEventListener('click', () => acoes.editar({ id }));
}

const acoes = {
  tipo: (d) => { st.tipo = d.k; N.redesenhar(); },
  encerrados: (d, el) => { st.encerrados = el.checked; N.redesenhar(); },
  abrir: (d) => detalhe(d.id),
  editar(d) {
    const p = d.id ? N.achar('processos', d.id) : null;
    N.abrirFormulario({
      titulo: p ? 'Editar processo' : 'Novo processo',
      campos: [{ id: 'titulo', rotulo: 'Título (ex.: Credenciamento Ponta de Pedras — FMS 002/2025)', valor: p?.titulo, obrigatorio: true },
        { id: 'tipo', rotulo: 'Tipo', tipo: 'escolha', valor: p?.tipo || st.tipo || 'credenciamento', opcoes: TIPOS, meio: true },
        { id: 'etapa', rotulo: 'Etapa', tipo: 'escolha', valor: p?.etapa || 'prospeccao', opcoes: ETAPAS, meio: true },
        { id: 'orgao', rotulo: 'Órgão / município / cliente', valor: p?.orgao, meio: true }, { id: 'responsavel', rotulo: 'Responsável', valor: p?.responsavel, meio: true },
        { id: 'prazo', rotulo: 'Próximo prazo', tipo: 'data', valor: p?.prazo, meio: true }, { id: 'valor_estimado', rotulo: 'Valor estimado (R$)', tipo: 'dinheiro', valor: p?.valor_estimado, meio: true },
        { id: 'contrato_id', rotulo: 'Contrato gerado (se já virou contrato)', tipo: 'escolha', valor: p?.contrato_id || '', opcoes: [['', '—'], ...dados.contratos.map((c) => [c.id, N.rotuloContrato(c.id)])] },
        { id: 'obs', rotulo: 'Observações', tipo: 'area', valor: p?.obs }],
      aoSalvar: async (v) => { await N.salvar('processos', { ...v, id: p?.id }); N.redesenhar(); },
      aoExcluir: p && (async () => {
        if (await N.confirmar(`Excluir "${p.titulo}" e todas as tarefas dele?`, 'Excluir')) { await N.excluir('processos', p.id); dados.tarefas = dados.tarefas.filter((t) => t.processo_id !== p.id); N.redesenhar(); }
      }),
    });
  },
};

export default { id: 'processos', titulo: 'Processos e Projetos', icone: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>', render, acoes };
