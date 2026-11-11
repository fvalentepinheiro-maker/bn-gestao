// QUALIDADE E COMPLIANCE — certidões e documentos com validade, da empresa e das pessoas.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { filtro: 'todos', de: '' };
const CATEGORIAS = ['Certidão', 'Alvará / Licença', 'Registro em conselho', 'Atestado de capacidade técnica', 'Contrato social / Societário', 'Balanço / Contábil', 'Plano / Programa (PGRSS, PCMSO…)', 'Documento pessoal', 'Outro'];
const linkSeguro = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

function render() {
  const pode = N.podeEditar(), hoje = N.hoje();
  const todos = dados.documentos.map((d) => ({ d, s: C.situacaoDocumento(d.validade, hoje) }));
  const conta = { vencidos: todos.filter((x) => x.s.dias !== null && x.s.dias < 0).length, vencendo: todos.filter((x) => x.s.dias !== null && x.s.dias >= 0 && x.s.dias <= 30).length, vigentes: todos.filter((x) => x.s.cls === 'ok').length };
  const ls = todos.filter(({ d, s }) => (st.filtro === 'todos' || (st.filtro === 'vencidos' && s.dias !== null && s.dias < 0) || (st.filtro === 'vencendo' && s.dias !== null && s.dias >= 0 && s.dias <= 30))
      && (!st.de || (st.de === 'empresa' ? !d.pessoa_id : !!d.pessoa_id)))
    .sort((a, b) => (a.s.dias ?? 99999) - (b.s.dias ?? 99999) || a.d.titulo.localeCompare(b.d.titulo));
  const f = (k, r) => `<button class="${st.filtro === k ? 'ativa' : ''}" data-acao="filtro" data-k="${k}">${r}</button>`;
  return `<div class="indicadores">
      <div class="cartao"><small>Vencidos</small><b class="${conta.vencidos ? 'neg' : ''}">${conta.vencidos}</b></div>
      <div class="cartao"><small>Vencem em até 30 dias</small><b>${conta.vencendo}</b></div>
      <div class="cartao"><small>Vigentes</small><b class="pos">${conta.vigentes}</b></div>
      <div class="cartao"><small>Total cadastrado</small><b>${todos.length}</b></div></div>
    <div class="barra-acoes"><div class="abas juntas">${f('todos', 'Todos')}${f('vencidos', 'Vencidos')}${f('vencendo', 'A vencer')}</div>
      <select data-mudar="de" aria-label="De quem"><option value="">Empresa e pessoas</option><option value="empresa" ${st.de === 'empresa' ? 'selected' : ''}>Só da empresa</option><option value="pessoas" ${st.de === 'pessoas' ? 'selected' : ''}>Só de pessoas</option></select>
      <span class="empurra"></span>${pode ? '<button class="botao principal" data-acao="editar">+ Documento</button>' : ''}</div>
    ${ls.length ? `<div class="rola"><table><thead><tr><th>Documento</th><th>De quem</th><th>Órgão / Nº</th><th>Emissão</th><th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>${ls.map(({ d, s }) => `<tr>
      <td><b>${esc(d.titulo)}</b><br><small>${esc(d.categoria)}</small></td><td>${d.pessoa_id ? esc(N.nomePessoa(d.pessoa_id)) : 'BN Med'}</td>
      <td>${esc(d.orgao || '—')}${d.numero ? '<br><small>' + esc(d.numero) + '</small>' : ''}</td><td>${N.dataBR(d.emissao)}</td><td>${N.dataBR(d.validade)}</td><td>${N.selo(s.cls, s.txt)}</td>
      <td>${linkSeguro(d.link) ? `<a class="botao pequeno" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Abrir</a> ` : ''}${pode ? `<button class="botao pequeno" data-acao="editar" data-id="${d.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="vazio">${todos.length ? 'Nenhum documento neste filtro.' : 'Nenhum documento cadastrado. Comece pelas certidões que os editais mais pedem: CND federal, FGTS, trabalhista, estadual e municipal.'}</div>`}`;
}

const acoes = {
  filtro: (d) => { st.filtro = d.k; N.redesenhar(); },
  de: (d, el) => { st.de = el.value; N.redesenhar(); },
  editar(d) {
    const x = d.id ? N.achar('documentos', d.id) : null;
    N.abrirFormulario({
      titulo: x ? 'Editar documento' : 'Novo documento',
      campos: [{ id: 'titulo', rotulo: 'Documento (ex.: CND Federal, Alvará sanitário)', valor: x?.titulo, obrigatorio: true },
        { id: 'categoria', rotulo: 'Categoria', tipo: 'escolha', valor: x?.categoria || 'Certidão', opcoes: [...new Set([...CATEGORIAS, ...(x?.categoria ? [x.categoria] : [])])].map((c) => [c, c]), meio: true },
        { id: 'pessoa_id', rotulo: 'De quem é', tipo: 'escolha', valor: x?.pessoa_id || '', opcoes: [['', 'BN Med (empresa)'], ...dados.pessoas.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((p) => [p.id, p.nome])], meio: true },
        { id: 'orgao', rotulo: 'Órgão emissor', valor: x?.orgao, meio: true }, { id: 'numero', rotulo: 'Número', valor: x?.numero, meio: true },
        { id: 'emissao', rotulo: 'Emissão', tipo: 'data', valor: x?.emissao, meio: true }, { id: 'validade', rotulo: 'Validade', tipo: 'data', valor: x?.validade, meio: true, dica: 'Vazio = não vence.' },
        { id: 'link', rotulo: 'Link do arquivo (Google Drive etc.)', valor: x?.link, dica: 'Cole o link de onde o PDF está guardado. O sistema guarda o link, não o arquivo.' },
        { id: 'obs', rotulo: 'Observações', tipo: 'area', valor: x?.obs }],
      aoSalvar: async (v) => {
        if (v.link && !linkSeguro(v.link)) throw new Error('O link precisa começar com http:// ou https://');
        if (v.emissao && v.validade && v.validade < v.emissao) throw new Error('A validade está antes da emissão.');
        await N.salvar('documentos', { ...v, id: x?.id }); N.redesenhar();
      },
      aoExcluir: x && (async () => { if (await N.confirmar(`Excluir o documento "${x.titulo}"?`, 'Excluir')) { await N.excluir('documentos', x.id); N.redesenhar(); } }),
    });
  },
};

export default { id: 'qualidade', titulo: 'Qualidade e Compliance', icone: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>', render, acoes };
