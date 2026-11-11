// PESSOAS — médicos e equipe: cadastro, serviços onde atuam e pendência de documentos.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { tipo: '', busca: '', inativos: false };

function render() {
  const pode = N.podeEditar(), hoje = N.hoje(), mes = hoje.slice(0, 7), b = N.semAcento(st.busca);
  const ls = dados.pessoas.filter((p) => (!st.tipo || p.tipo === st.tipo) && (st.inativos || p.ativo) && (!b || N.semAcento([p.nome, p.crm, p.especialidade, p.funcao].join(' ')).includes(b)))
    .sort((a, c) => a.nome.localeCompare(c.nome));
  const linhas = ls.map((p) => {
    const servicos = dados.pessoa_unidades.filter((x) => x.pessoa_id === p.id).map((x) => N.nomeUnidade(x.unidade_id));
    const docs = dados.documentos.filter((d) => d.pessoa_id === p.id).map((d) => C.situacaoDocumento(d.validade, hoje));
    const vencidos = docs.filter((d) => d.dias !== null && d.dias < 0).length, aVencer = docs.filter((d) => d.dias !== null && d.dias >= 0 && d.dias <= 30).length;
    const prod = dados.escala.filter((l) => l.pessoa_id === p.id && C.conta(l) && C.mesDe(l.data) === mes).reduce((s, l) => s + l.pacientes, 0);
    return `<tr><td><b>${esc(p.nome)}</b>${p.ativo ? '' : ' ' + N.selo('neutro', 'inativo')}<br><small>${p.tipo === 'medico' ? esc([p.crm && 'CRM ' + p.crm, p.especialidade].filter(Boolean).join(' · ') || 'Médico') : esc(p.funcao || 'Equipe')}</small></td>
      <td>${esc(p.telefone || '—')}${p.email ? '<br><small>' + esc(p.email) + '</small>' : ''}</td><td>${servicos.map(esc).join(', ') || '—'}</td>
      <td class="n">${p.tipo === 'medico' ? prod : '—'}</td>
      <td>${docs.length ? `${docs.length} doc.` : '<span class="fraco">nenhum</span>'} ${vencidos ? N.selo('pendente', vencidos + ' vencido' + (vencidos > 1 ? 's' : '')) : ''} ${aVencer ? N.selo('parcial', aVencer + ' a vencer') : ''}</td>
      <td>${pode ? `<button class="botao pequeno" data-acao="editar" data-id="${p.id}">Editar</button>` : ''}</td></tr>`;
  }).join('');
  const f = (k, r) => `<button class="${st.tipo === k ? 'ativa' : ''}" data-acao="tipo" data-k="${k}">${r}</button>`;
  return `<div class="barra-acoes"><div class="abas juntas">${f('', 'Todos')}${f('medico', 'Médicos')}${f('equipe', 'Equipe')}</div>
      <input type="search" placeholder="Buscar por nome, CRM, especialidade…" value="${esc(st.busca)}" data-mudar="busca" data-foco="busca" aria-label="Buscar">
      <label class="marca"><input type="checkbox" data-mudar="inativos" ${st.inativos ? 'checked' : ''}> mostrar inativos</label><span class="empurra"></span>
      ${pode ? '<button class="botao principal" data-acao="editar">+ Pessoa</button>' : ''}</div>
    ${ls.length ? `<div class="rola"><table><thead><tr><th>Nome</th><th>Contato</th><th>Serviços</th><th class="n">Pac. em ${N.mesBR(mes)}</th><th>Documentos</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
      : '<div class="vazio">Ninguém encontrado com esse filtro.</div>'}`;
}

const acoes = {
  tipo: (d) => { st.tipo = d.k; N.redesenhar(); },
  busca: (d, el) => { st.busca = el.value; N.redesenhar(); },
  inativos: (d, el) => { st.inativos = el.checked; N.redesenhar(); },
  editar(d) {
    const p = d.id ? N.achar('pessoas', d.id) : null;
    const vinc = p ? dados.pessoa_unidades.filter((x) => x.pessoa_id === p.id) : [];
    N.abrirFormulario({
      titulo: p ? 'Editar pessoa' : 'Nova pessoa',
      campos: [{ id: 'nome', rotulo: 'Nome completo', valor: p?.nome, obrigatorio: true },
        { id: 'tipo', rotulo: 'Tipo', tipo: 'escolha', valor: p?.tipo || st.tipo || 'medico', opcoes: [['medico', 'Médico'], ['equipe', 'Equipe']], meio: true },
        { id: 'ativo', rotulo: 'Ativo', tipo: 'sim', valor: p ? p.ativo : true, meio: true },
        { id: 'crm', rotulo: 'CRM', valor: p?.crm, meio: true }, { id: 'especialidade', rotulo: 'Especialidade', valor: p?.especialidade, meio: true },
        { id: 'funcao', rotulo: 'Função (equipe)', valor: p?.funcao, meio: true }, { id: 'telefone', rotulo: 'Telefone', valor: p?.telefone, meio: true },
        { id: 'email', rotulo: 'E-mail', valor: p?.email },
        { id: 'servicos', rotulo: 'Serviços onde atua (aparece na Escala desses serviços)', tipo: 'varios', valor: vinc.map((x) => x.unidade_id), opcoes: dados.unidades.map((u) => [u.id, u.nome]) },
        { id: 'obs', rotulo: 'Observações', tipo: 'area', valor: p?.obs }],
      aoSalvar: async ({ servicos, ...v }) => {
        const nova = await N.salvar('pessoas', { ...v, id: p?.id });
        for (const x of vinc.filter((x) => !servicos.includes(x.unidade_id))) await N.excluir('pessoa_unidades', x.id);
        await N.gravarVarios('pessoa_unidades', servicos.filter((u) => !vinc.some((x) => x.unidade_id === u)).map((u) => ({ pessoa_id: nova.id, unidade_id: u })), 'pessoa_id,unidade_id');
        N.redesenhar();
      },
      // Pessoa com histórico não é apagada (perderia a escala): fica inativa.
      aoExcluir: p && (async () => {
        if (dados.escala.some((l) => l.pessoa_id === p.id)) throw new Error('Esta pessoa tem lançamentos na escala. Em vez de excluir, desmarque "Ativo".');
        if (await N.confirmar(`Excluir ${p.nome}? Os documentos dela também serão apagados.`, 'Excluir')) { await N.excluir('pessoas', p.id); await N.carregarTudo(); N.redesenhar(); }
      }),
    });
  },
};

export default { id: 'pessoas', titulo: 'Pessoas', icone: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>', render, acoes };
