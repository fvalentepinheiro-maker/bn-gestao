// CONTRATOS E TETOS — contratos, serviços (com turnos e valores) e o painel teto × executado × recebido.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { aba: 'tetos', mes: N.hoje().slice(0, 7) };
const SITUACAO = { ativo: ['ok', 'ativo'], encerrado: ['neutro', 'encerrado'], sem_contrato: ['parcial', 'sem contrato'] };

function abaTetos() {
  const servicos = dados.unidades.slice().sort((a, b) => a.ordem - b.ordem);
  if (!servicos.length) return '<div class="vazio">Nenhum serviço cadastrado ainda.</div>';
  const porContrato = {};
  for (const e of dados.lancamentos) if (e.contrato_id && !e.aporte) { const a = (porContrato[e.contrato_id] ||= { rec: 0, desp: 0 }); a[e.tipo === 'entrada' ? 'rec' : 'desp'] += Number(e.valor); }
  const qtdServ = {}; for (const u of servicos) if (u.contrato_id) qtdServ[u.contrato_id] = (qtdServ[u.contrato_id] || 0) + 1;
  const linhas = servicos.map((u) => {
    const t = C.consumoTeto(u, dados.escala, st.mes), n = qtdServ[u.contrato_id] || 1, f = porContrato[u.contrato_id] || { rec: 0, desp: 0 };
    const rec = C.r2(f.rec / n), desp = C.r2(f.desp / n), norte = C.r2(t.teto * Number(u.valor_norte || 0));
    const cls = !t.teto ? '' : t.pct >= 100 ? 'cheio' : t.pct >= 90 ? 'alerta' : '';
    return `<tr><td><b>${esc(u.nome)}</b>${u.ativo ? '' : ' ' + N.selo('neutro', 'inativo')}<br><small>${esc(u.contrato_id ? N.rotuloContrato(u.contrato_id) : 'sem contrato')}${n > 1 ? ' · contrato dividido em ' + n + ' serviços' : ''}</small></td>
      <td class="n">${t.teto || '—'}<br><small>${t.teto ? (t.mensal ? 'por mês' : 'total') : ''}</small></td><td class="n">${t.exec}</td>
      <td class="n ${t.saldo < 0 ? 'neg' : ''}">${t.teto ? t.saldo : '—'}</td>
      <td class="teto ${cls}">${t.teto ? `<div class="barra"><i style="width:${Math.min(100, t.pct)}%"></i></div><small>${t.pct}%</small>` : '<small>sem teto</small>'}</td>
      <td class="n">${norte ? C.dinheiro(norte) : '—'}</td><td class="n">${C.dinheiro(rec)}${norte ? `<br><small>${Math.round(rec / norte * 100)}% do teto</small>` : ''}</td>
      <td class="n">${C.dinheiro(desp)}</td><td class="n ${rec - desp < 0 ? 'neg' : ''}"><b>${C.dinheiro(rec - desp)}</b></td></tr>`;
  }).join('');
  return `<p class="texto">Teto <b>total</b> compara com tudo que já foi executado; teto <b>por mês</b> compara só com ${N.mesBR(st.mes)}.
      <input type="month" value="${st.mes}" data-mudar="mes" aria-label="Mês de referência"> Recebido e despesas vêm do Financeiro (lançamentos ligados ao contrato).</p>
    <div class="rola"><table><thead><tr><th>Serviço</th><th class="n">Teto</th><th class="n">Executado</th><th class="n">Saldo</th><th>Consumo</th><th class="n">Valor do teto</th><th class="n">Recebido</th><th class="n">Despesas</th><th class="n">Líquido</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

function abaContratos(pode) {
  const ls = dados.contratos.slice().sort((a, b) => a.cliente.localeCompare(b.cliente));
  return `${pode ? '<div class="barra-acoes"><span class="empurra"></span><button class="botao principal" data-acao="contrato">+ Contrato</button></div>' : ''}
    ${ls.length ? `<div class="rola"><table><thead><tr><th>Número</th><th>Cliente</th><th>Tipo</th><th>Vigência</th><th class="n">Valor</th><th>Situação</th><th>Serviços</th><th></th></tr></thead><tbody>${ls.map((c) => `<tr>
      <td><b>${esc(c.numero)}</b></td><td>${esc(c.cliente)}${c.objeto ? `<br><small>${esc(c.objeto)}</small>` : ''}</td><td>${c.tipo === 'privado' ? 'Privado' : 'Público'}</td>
      <td>${N.dataBR(c.inicio)} a ${N.dataBR(c.fim)}</td><td class="n">${c.valor_total != null ? C.dinheiro(c.valor_total) : '—'}</td><td>${N.selo(...SITUACAO[c.situacao])}</td>
      <td>${dados.unidades.filter((u) => u.contrato_id === c.id).map((u) => esc(u.nome)).join(', ') || '—'}</td>
      <td>${pode ? `<button class="botao pequeno" data-acao="contrato" data-id="${c.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum contrato cadastrado.</div>'}`;
}

function abaServicos(pode) {
  const ls = dados.unidades.slice().sort((a, b) => a.ordem - b.ordem);
  return `${pode ? '<div class="barra-acoes"><span class="empurra"></span><button class="botao principal" data-acao="servico">+ Serviço</button></div>' : ''}
    ${ls.length ? `<div class="rola"><table><thead><tr><th>Serviço</th><th>Contrato</th><th class="n">Teto</th><th class="n">Valor-norte</th><th class="n">Imposto</th><th>Turnos — faturamento / repasse por paciente</th><th></th></tr></thead><tbody>${ls.map((u) => `<tr>
      <td><i class="bolinha" style="background:${esc(u.cor)}"></i> <b>${esc(u.nome)}</b>${u.ativo ? '' : ' ' + N.selo('neutro', 'inativo')}</td>
      <td>${esc(u.contrato_id ? N.rotuloContrato(u.contrato_id) : '—')}</td><td class="n">${u.teto_qtd ? u.teto_qtd + (u.teto_tipo === 'mensal' ? '/mês' : '') : '—'}</td>
      <td class="n">${u.valor_norte != null ? C.dinheiro(u.valor_norte) : '—'}</td><td class="n">${(u.aliquota * 100).toFixed(1).replace('.0', '')}%</td>
      <td>${N.turnosDa(u.id).map((t) => `${esc(t.rotulo)}: ${C.dinheiro(t.fat_paciente)} / ${C.dinheiro(t.rep_paciente)}`).join('<br>') || '<span class="fraco">sem turnos</span>'}</td>
      <td>${pode ? `<button class="botao pequeno" data-acao="servico" data-id="${u.id}">Editar</button> <button class="botao pequeno" data-acao="turnos" data-id="${u.id}">Turnos</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum serviço cadastrado.</div>'}`;
}

function render() {
  const pode = N.podeEditar(), aba = (k, r) => `<button class="${st.aba === k ? 'ativa' : ''}" data-acao="aba" data-k="${k}">${r}</button>`;
  return `<div class="abas">${aba('tetos', 'Tetos e resultado')}${aba('contratos', 'Contratos')}${aba('servicos', 'Serviços e valores')}</div>
    ${st.aba === 'tetos' ? abaTetos() : st.aba === 'contratos' ? abaContratos(pode) : abaServicos(pode)}`;
}

function janelaTurnos(unidadeId) {
  const u = N.achar('unidades', unidadeId);
  const c = N.abrirJanela('Turnos — ' + u.nome, `<p class="texto">Valor por paciente em cada turno. O faturamento é o que a BN cobra; o repasse é o que vai para o médico.</p>
    <div class="rola"><table><thead><tr><th>Turno</th><th class="n">Faturamento</th><th class="n">Repasse</th><th></th></tr></thead><tbody>${N.turnosDa(u.id).map((t) => `<tr><td><b>${esc(t.rotulo)}</b></td>
      <td class="n">${C.dinheiro(t.fat_paciente)}</td><td class="n">${C.dinheiro(t.rep_paciente)}</td><td><button class="botao pequeno" data-t="${t.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="4" class="fraco">Nenhum turno ainda.</td></tr>'}</tbody></table></div>
    <div class="acoes"><button class="botao" data-fechar>Fechar</button><button class="botao principal" data-t="">+ Turno</button></div>`, { larga: true });
  c.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => formTurno(u, b.dataset.t ? N.achar('turnos', b.dataset.t) : null); });
}
function formTurno(u, t) {
  const usado = t && dados.escala.some((l) => l.unidade_id === u.id && l.turno === t.chave);
  N.abrirFormulario({
    titulo: (t ? 'Editar turno — ' : 'Novo turno — ') + u.nome,
    campos: [{ id: 'rotulo', rotulo: 'Nome do turno (ex.: Manhã, Tarde, Extra)', valor: t?.rotulo, obrigatorio: true },
      { id: 'fat_paciente', rotulo: 'Faturamento por paciente (R$)', tipo: 'dinheiro', valor: t?.fat_paciente ?? 0, obrigatorio: true, meio: true },
      { id: 'rep_paciente', rotulo: 'Repasse por paciente (R$)', tipo: 'dinheiro', valor: t?.rep_paciente ?? 0, obrigatorio: true, meio: true },
      { id: 'ordem', rotulo: 'Ordem na tela', tipo: 'numero', valor: t?.ordem ?? N.turnosDa(u.id).length + 1, meio: true }],
    aoSalvar: async (v) => {
      const chave = t?.chave || N.slug(v.rotulo);
      if (!t && N.turnosDa(u.id).some((x) => x.chave === chave)) throw new Error('Já existe um turno com esse nome neste serviço.');
      await N.salvar('turnos', { ...v, id: t?.id, unidade_id: u.id, chave, ordem: v.ordem ?? 0 });
      N.redesenhar(); setTimeout(() => janelaTurnos(u.id));
    },
    aoExcluir: t && (async () => {
      if (usado) throw new Error('Este turno já tem lançamentos na escala e não pode ser excluído.');
      if (await N.confirmar('Excluir o turno "' + t.rotulo + '"?', 'Excluir')) { await N.excluir('turnos', t.id); N.redesenhar(); }
    }),
  });
}

const acoes = {
  aba: (d) => { st.aba = d.k; N.redesenhar(); },
  mes: (d, el) => { if (el.value) { st.mes = el.value; N.redesenhar(); } },
  contrato(d) {
    const c = d.id ? N.achar('contratos', d.id) : null;
    N.abrirFormulario({
      titulo: c ? 'Editar contrato' : 'Novo contrato',
      campos: [{ id: 'numero', rotulo: 'Número', valor: c?.numero, obrigatorio: true, meio: true },
        { id: 'tipo', rotulo: 'Tipo', tipo: 'escolha', valor: c?.tipo || 'publico', opcoes: [['publico', 'Público'], ['privado', 'Privado']], meio: true },
        { id: 'cliente', rotulo: 'Cliente / contratante', valor: c?.cliente, obrigatorio: true }, { id: 'objeto', rotulo: 'Objeto', valor: c?.objeto },
        { id: 'inicio', rotulo: 'Início', tipo: 'data', valor: c?.inicio, meio: true }, { id: 'fim', rotulo: 'Fim', tipo: 'data', valor: c?.fim, meio: true },
        { id: 'valor_total', rotulo: 'Valor total (R$)', tipo: 'dinheiro', valor: c?.valor_total, meio: true },
        { id: 'situacao', rotulo: 'Situação', tipo: 'escolha', valor: c?.situacao || 'ativo', opcoes: [['ativo', 'Ativo'], ['encerrado', 'Encerrado'], ['sem_contrato', 'Sem contrato (credenciado)']], meio: true },
        { id: 'obs', rotulo: 'Observações', tipo: 'area', valor: c?.obs }],
      aoSalvar: async (v) => { await N.salvar('contratos', { ...v, id: c?.id }); N.redesenhar(); },
      aoExcluir: c && (async () => {
        if (await N.confirmar(`Excluir o contrato ${c.numero}? Serviços e lançamentos ligados a ele ficam sem contrato.`, 'Excluir')) { await N.excluir('contratos', c.id); await N.carregarTudo(); N.redesenhar(); }
      }),
    });
  },
  servico(d) {
    const u = d.id ? N.achar('unidades', d.id) : null;
    N.abrirFormulario({
      titulo: u ? 'Editar serviço' : 'Novo serviço',
      campos: [{ id: 'nome', rotulo: 'Nome do serviço / unidade', valor: u?.nome, obrigatorio: true },
        { id: 'contrato_id', rotulo: 'Contrato', tipo: 'escolha', valor: u?.contrato_id || '', opcoes: [['', '— sem contrato —'], ...dados.contratos.map((c) => [c.id, N.rotuloContrato(c.id)])] },
        { id: 'teto_qtd', rotulo: 'Teto (nº de atendimentos)', tipo: 'numero', valor: u?.teto_qtd, meio: true },
        { id: 'teto_tipo', rotulo: 'O teto vale', tipo: 'escolha', valor: u?.teto_tipo || 'total', opcoes: [['total', 'Para o contrato todo'], ['mensal', 'Por mês']], meio: true },
        { id: 'valor_norte', rotulo: 'Valor-norte (R$ por atendimento)', tipo: 'dinheiro', valor: u?.valor_norte, meio: true },
        { id: 'aliquota', rotulo: 'Imposto sobre faturamento (%)', tipo: 'numero', valor: u ? C.r2(u.aliquota * 100) : 17, obrigatorio: true, meio: true },
        { id: 'cor', rotulo: 'Cor na escala', tipo: 'escolha', valor: u?.cor || '#0e7c5a', opcoes: [['#0e7c5a', 'Verde'], ['#1a4fa0', 'Azul'], ['#0a7fa8', 'Azul-petróleo'], ['#7c3aed', 'Roxo'], ['#b45309', 'Âmbar'], ['#be123c', 'Vinho']], meio: true },
        { id: 'ordem', rotulo: 'Ordem na tela', tipo: 'numero', valor: u?.ordem ?? dados.unidades.length + 1, meio: true },
        { id: 'ativo', rotulo: 'Serviço ativo (aparece na Escala)', tipo: 'sim', valor: u ? u.ativo : true }],
      aoSalvar: async (v) => {
        const s = u?.slug || N.slug(v.nome);
        if (!u && dados.unidades.some((x) => x.slug === s)) throw new Error('Já existe um serviço com esse nome.');
        const novo = await N.salvar('unidades', { ...v, id: u?.id, slug: s, aliquota: v.aliquota / 100, teto_qtd: v.teto_qtd ? Math.round(v.teto_qtd) : null, ordem: v.ordem ?? 0 });
        if (!u) await N.gravarVarios('turnos', [{ unidade_id: novo.id, chave: 'manha', rotulo: 'Manhã', fat_paciente: 0, rep_paciente: 0, ordem: 1 }, { unidade_id: novo.id, chave: 'tarde', rotulo: 'Tarde', fat_paciente: 0, rep_paciente: 0, ordem: 2 }], 'unidade_id,chave');
        N.redesenhar(); if (!u) { N.aviso('Serviço criado. Agora informe os valores dos turnos.'); setTimeout(() => janelaTurnos(novo.id)); }
      },
    });
  },
  turnos: (d) => janelaTurnos(d.id),
};

export default { id: 'contratos', titulo: 'Contratos e tetos', icone: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>', render, acoes };
