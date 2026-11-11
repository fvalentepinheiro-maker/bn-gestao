// FINANCEIRO — entradas e despesas por competência. Aporte de capital aparece, mas não conta como receita.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { mes: N.hoje().slice(0, 7) };
const CATEGORIAS = ['Médicos / Mão de obra', 'Impostos', 'Jurídico', 'Transporte', 'Alimentação', 'Marketing', 'Administrativo', 'Outros'];
const TIPOS_ENTRADA = ['Recebimento de cliente', 'Aporte de capital', 'Outros'];
const PAGAMENTO = ['Transferência', 'PIX', 'Dinheiro', 'Cheque', 'Boleto', 'Outro'];
const opc = (lista, vazio) => [...(vazio ? [['', vazio]] : []), ...lista.map((x) => [x, x])];

function formulario(tipo, e) {
  const entrada = tipo === 'entrada';
  const form = N.abrirFormulario({
    titulo: (e ? 'Editar ' : 'Nova ') + tipo,
    campos: [
      { id: 'data', rotulo: 'Data', tipo: 'data', valor: e?.data || (st.mes === N.hoje().slice(0, 7) ? N.hoje() : st.mes + '-01'), obrigatorio: true, meio: true },
      { id: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', valor: e?.valor, obrigatorio: true, meio: true },
      { id: 'competencia', rotulo: 'Competência', tipo: 'mes', valor: C.mesDe(e?.competencia) || st.mes, obrigatorio: true, meio: true },
      { id: 'situacao', rotulo: 'Situação', tipo: 'escolha', valor: e?.situacao || 'liquidado', opcoes: [['liquidado', 'Liquidado'], ['aberto', 'Em aberto'], ['dea', 'DEA (exercício anterior)']], meio: true },
      { id: 'categoria', rotulo: entrada ? 'Tipo' : 'Categoria', tipo: 'escolha', valor: e?.categoria, opcoes: opc([...new Set([...(entrada ? TIPOS_ENTRADA : CATEGORIAS), ...(e?.categoria ? [e.categoria] : [])])]) },
      ...(entrada ? [{ id: 'aporte', rotulo: 'É aporte de capital (não conta como receita)', tipo: 'sim', valor: e?.aporte }, { id: 'origem', rotulo: 'Origem (cliente ou quem aportou)', valor: e?.origem }] : []),
      { id: 'descricao', rotulo: 'Descrição', valor: e?.descricao },
      { id: 'unidade_id', rotulo: 'Serviço', tipo: 'escolha', valor: e?.unidade_id || '', opcoes: [['', '—'], ...dados.unidades.map((u) => [u.id, u.nome])], meio: true },
      { id: 'contrato_id', rotulo: 'Contrato', tipo: 'escolha', valor: e?.contrato_id || '', opcoes: [['', '—'], ...dados.contratos.map((c) => [c.id, N.rotuloContrato(c.id)])], meio: true },
      { id: 'periodo_ini', rotulo: 'Período da fatura — de', tipo: 'data', valor: e?.periodo_ini, meio: true },
      { id: 'periodo_fim', rotulo: 'até', tipo: 'data', valor: e?.periodo_fim, meio: true },
      { id: 'forma_pagamento', rotulo: 'Forma de pagamento', tipo: 'escolha', valor: e?.forma_pagamento || '', opcoes: opc(PAGAMENTO, '—'), meio: true },
      { id: 'nf_numero', rotulo: 'Nº da nota fiscal', valor: e?.nf_numero, meio: true },
    ],
    aoSalvar: async (v) => {
      await N.salvar('lancamentos', { ...v, id: e?.id, tipo, competencia: v.competencia + '-01', tem_nf: !!v.nf_numero || !!e?.tem_nf,
        aporte: entrada ? (v.aporte || v.categoria === 'Aporte de capital') : false, origem: entrada ? v.origem : null });
      st.mes = v.competencia; N.redesenhar();
    },
    aoExcluir: e && (async () => { if (await N.confirmar('Excluir este lançamento de ' + C.dinheiro(e.valor) + '? Não dá para desfazer.', 'Excluir')) { await N.excluir('lancamentos', e.id); N.redesenhar(); } }),
  });
  // Ao escolher o serviço, puxa o contrato dele.
  form.querySelector('#f_unidade_id').onchange = (ev) => { const u = N.achar('unidades', ev.target.value); if (u?.contrato_id) form.querySelector('#f_contrato_id').value = u.contrato_id; };
}

function tabela(lista, vazio, pode) {
  if (!lista.length) return `<div class="vazio">${vazio}</div>`;
  return `<div class="rola"><table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Vínculo</th><th>NF / Pgto</th><th class="n">Valor</th><th></th></tr></thead><tbody>${lista.map((e) => `<tr>
    <td>${N.diaMes(e.data)}</td>
    <td>${esc(e.categoria)} ${e.aporte ? N.selo('neutro', 'aporte') : ''}${e.situacao === 'aberto' ? N.selo('parcial', 'em aberto') : ''}${e.situacao === 'dea' ? N.selo('neutro', 'DEA') : ''}</td>
    <td>${esc(e.descricao || '')}${e.origem ? ' · ' + esc(e.origem) : ''}</td>
    <td>${esc(e.unidade_id ? N.nomeUnidade(e.unidade_id) : e.contrato_id ? N.rotuloContrato(e.contrato_id) : '—')}${e.periodo_ini || e.periodo_fim ? `<br><small>${N.diaMes(e.periodo_ini)} a ${N.diaMes(e.periodo_fim)}</small>` : ''}</td>
    <td>${e.tem_nf || e.nf_numero ? 'NF ' + esc(e.nf_numero || '') : '<span class="fraco">sem NF</span>'}${e.forma_pagamento ? '<br><small>' + esc(e.forma_pagamento) + '</small>' : ''}</td>
    <td class="n"><b>${C.dinheiro(e.valor)}</b></td>
    <td>${pode ? `<button class="botao pequeno" data-acao="editar" data-id="${e.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function render() {
  const pode = N.podeEditar(), ano = st.mes.slice(0, 4);
  const doMes = dados.lancamentos.filter((e) => C.mesDe(e.competencia) === st.mes).sort((a, b) => a.data.localeCompare(b.data));
  const doAno = dados.lancamentos.filter((e) => e.competencia.slice(0, 4) === ano);
  const m = C.resumoFinanceiro(doMes), a = C.resumoFinanceiro(doAno);
  const dea = C.r2(dados.lancamentos.filter((e) => e.tipo === 'despesa' && e.situacao === 'dea').reduce((s, e) => s + Number(e.valor), 0));
  const porMes = N.MESES.map((nome, i) => ({ nome, ...C.resumoFinanceiro(doAno.filter((e) => Number(e.competencia.slice(5, 7)) === i + 1)) })).filter((x) => x.entradas || x.despesas);
  const maior = Math.max(1, ...porMes.flatMap((x) => [x.entradas, x.despesas]));
  return `<div class="barra-acoes">
      <button class="icone-botao" data-acao="mes" data-passo="-1" aria-label="Mês anterior">‹</button>
      <input type="month" value="${st.mes}" data-mudar="mesDireto" aria-label="Competência">
      <button class="icone-botao" data-acao="mes" data-passo="1" aria-label="Mês seguinte">›</button><span class="empurra"></span>
      ${pode ? '<button class="botao principal" data-acao="nova" data-tipo="entrada">+ Entrada</button><button class="botao" data-acao="nova" data-tipo="despesa">+ Despesa</button>' : ''}
    </div>
    <div class="indicadores">
      <div class="cartao"><small>Entradas do mês</small><b class="pos">${C.dinheiro(m.entradas)}</b></div>
      <div class="cartao"><small>Despesas do mês</small><b class="neg">${C.dinheiro(m.despesas)}</b></div>
      <div class="cartao"><small>Saldo do mês</small><b class="${m.saldo < 0 ? 'neg' : 'pos'}">${C.dinheiro(m.saldo)}</b></div>
      <div class="cartao"><small>Aporte de capital no mês</small><b>${C.dinheiro(m.aportes)}</b><em>não entra na receita</em></div>
    </div>
    <h2>Entradas</h2>${tabela(doMes.filter((e) => e.tipo === 'entrada'), 'Sem entradas nesta competência.', pode)}
    <h2>Despesas</h2>${tabela(doMes.filter((e) => e.tipo === 'despesa'), 'Sem despesas nesta competência.', pode)}
    <h2>Visão do ano ${ano}</h2>
    <div class="indicadores">
      <div class="cartao"><small>Receita do ano</small><b class="pos">${C.dinheiro(a.entradas)}</b></div>
      <div class="cartao"><small>Despesas do ano</small><b class="neg">${C.dinheiro(a.despesas)}</b></div>
      <div class="cartao"><small>Liquidado (ano)</small><b>${C.dinheiro(a.liquidado)}</b></div>
      <div class="cartao"><small>Em aberto (ano)</small><b>${C.dinheiro(a.aberto)}</b></div>
      <div class="cartao"><small>Aportes (ano)</small><b>${C.dinheiro(a.aportes)}</b></div>
      <div class="cartao"><small>DEA — exercícios anteriores</small><b>${C.dinheiro(dea)}</b></div>
    </div>
    ${porMes.length ? `<div class="rola"><table><thead><tr><th>Mês</th><th class="n">Receita</th><th class="n">Despesa</th><th class="n">Saldo</th><th>Evolução</th></tr></thead><tbody>${porMes.map((x) => `<tr>
      <td>${x.nome}</td><td class="n pos">${C.dinheiro(x.entradas)}</td><td class="n neg">${C.dinheiro(x.despesas)}</td><td class="n ${x.saldo < 0 ? 'neg' : ''}"><b>${C.dinheiro(x.saldo)}</b></td>
      <td><div class="duas-barras"><i class="b-pos" style="width:${Math.round(x.entradas / maior * 100)}%"></i><i class="b-neg" style="width:${Math.round(x.despesas / maior * 100)}%"></i></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Sem lançamentos neste ano.</div>'}`;
}

const acoes = {
  mes: (d) => { st.mes = C.mesSeguinte(st.mes, Number(d.passo)); N.redesenhar(); },
  mesDireto: (d, el) => { if (el.value) { st.mes = el.value; N.redesenhar(); } },
  nova: (d) => formulario(d.tipo),
  editar: (d) => { const e = N.achar('lancamentos', d.id); formulario(e.tipo, e); },
};

export default { id: 'financeiro', titulo: 'Financeiro', icone: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>', render, acoes };
