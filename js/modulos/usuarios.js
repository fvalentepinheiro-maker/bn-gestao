// USUÁRIOS — só o gestor vê. Quem pede acesso na tela de entrada aparece aqui inativo, aguardando liberação.
import * as N from '../nucleo.js';
const { esc, dados } = N;
const PERFIS = [['gestor', 'Gestor — vê e altera tudo, libera usuários'], ['operador', 'Operador — lança e altera dados'], ['consulta', 'Consulta — só visualiza']];

function render() {
  const ls = dados.usuarios.slice().sort((a, b) => Number(a.ativo) - Number(b.ativo) || a.nome.localeCompare(b.nome));
  const eu = N.estado.usuario.id, aguardando = ls.filter((u) => !u.ativo).length;
  return `<p class="texto">Para incluir alguém: a pessoa abre o sistema, clica em <b>Solicitar acesso</b> e cria a própria conta. Ela aparece aqui como inativa e você libera, escolhendo o perfil.
      ${aguardando ? N.selo('parcial', aguardando + ' aguardando liberação') : ''}</p>
    <div class="rola"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>${ls.map((u) => `<tr>
      <td><b>${esc(u.nome)}</b>${u.id === eu ? ' <span class="fraco">(você)</span>' : ''}</td><td>${esc(u.email || '—')}</td>
      <td><select data-mudar="perfil" data-id="${u.id}" ${u.id === eu ? 'disabled' : ''} aria-label="Perfil de ${esc(u.nome)}">${PERFIS.map(([k, r]) => `<option value="${k}" ${u.perfil === k ? 'selected' : ''}>${r.split(' — ')[0]}</option>`).join('')}</select></td>
      <td>${u.ativo ? N.selo('ok', 'ativo') : N.selo('pendente', 'inativo')}</td>
      <td>${u.id === eu ? '' : `<button class="botao pequeno ${u.ativo ? '' : 'principal'}" data-acao="ativar" data-id="${u.id}">${u.ativo ? 'Desativar' : 'Liberar acesso'}</button>`}</td></tr>`).join('')}</tbody></table></div>
    <ul class="texto lista">${PERFIS.map(([, r]) => `<li>${r}</li>`).join('')}</ul>`;
}

const acoes = {
  async perfil(d, el) { await N.salvar('usuarios', { id: d.id, perfil: el.value }); N.aviso('Perfil alterado.'); N.redesenhar(); },
  async ativar(d) {
    const u = N.achar('usuarios', d.id);
    if (u.ativo && !(await N.confirmar(`Desativar ${u.nome}? Essa pessoa deixa de conseguir entrar.`, 'Desativar'))) return;
    await N.salvar('usuarios', { id: u.id, ativo: !u.ativo }); N.redesenhar();
  },
};

export default { id: 'usuarios', titulo: 'Usuários', soGestor: true, icone: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', render, acoes };
