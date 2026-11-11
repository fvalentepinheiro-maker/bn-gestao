// INÍCIO — indicadores do mês e a lista do que precisa de atenção.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

function render() {
  const hoje = N.hoje(), mes = hoje.slice(0, 7);
  const t = C.totais(dados.escala.filter((l) => C.mesDe(l.data) === mes), dados.turnos, dados.unidades);
  const f = C.resumoFinanceiro(dados.lancamentos.filter((e) => C.mesDe(e.competencia) === mes));

  // Últimos 6 meses de atendimentos
  const meses = Array.from({ length: 6 }, (_, i) => C.mesSeguinte(mes, i - 5));
  const serie = meses.map((m) => ({ m, v: dados.escala.filter((l) => C.conta(l) && C.mesDe(l.data) === m).reduce((s, l) => s + l.pacientes, 0) }));
  const maior = Math.max(1, ...serie.map((x) => x.v));

  // O que pede atenção
  const alertas = [];
  for (const u of N.unidadesAtivas()) {
    if (!u.teto_qtd) continue;
    const c = C.consumoTeto(u, dados.escala, mes);
    if (c.pct >= 90) alertas.push([c.pct >= 100 ? 'pendente' : 'parcial', `Teto de ${u.nome}: ${c.exec} de ${c.teto} (${c.pct}%)${c.mensal ? ' neste mês' : ''}`, '#/contratos']);
  }
  for (const d of dados.documentos) {
    const s = C.situacaoDocumento(d.validade, hoje);
    if (s.dias !== null && s.dias <= 30) alertas.push([s.cls, `${d.titulo}${d.pessoa_id ? ' — ' + N.nomePessoa(d.pessoa_id) : ''}: ${s.txt}`, '#/qualidade']);
  }
  for (const p of dados.processos) {
    if (['contratado', 'encerrado'].includes(p.etapa)) continue;
    const prazos = [[p.prazo, p.titulo], ...dados.tarefas.filter((x) => x.processo_id === p.id && !x.feito).map((x) => [x.prazo, p.titulo + ' › ' + x.titulo])];
    for (const [prazo, nome] of prazos) {
      if (!prazo) continue;
      const s = C.situacaoDocumento(prazo, hoje);
      if (s.dias <= 7) alertas.push([s.dias < 0 ? 'pendente' : 'parcial', `${nome}: ${s.dias < 0 ? 'atrasado ' + -s.dias + ' dia(s)' : s.dias === 0 ? 'prazo hoje' : 'prazo em ' + s.dias + ' dia(s)'}`, '#/processos']);
    }
  }
  const anterior = C.mesSeguinte(mes, -1);
  const emAberto = C.porMedicoMes(dados.escala.filter((l) => C.mesDe(l.data) <= anterior), dados.turnos).reduce((s, a) => {
    const p = dados.repasses.find((r) => r.pessoa_id === a.pessoa_id && r.unidade_id === a.unidade_id && C.mesDe(r.competencia) === a.mes);
    return s + Math.max(0, a.rep - Number(p?.pago || 0));
  }, 0);
  if (emAberto > 0.005) alertas.push(['parcial', `Repasse a médicos em aberto até ${N.mesBR(anterior)}: ${C.dinheiro(emAberto)}`, '#/repasse']);
  if (N.ehGestor()) { const n = dados.usuarios.filter((u) => !u.ativo).length; if (n) alertas.push(['parcial', n + ' usuário(s) aguardando liberação', '#/usuarios']); }
  alertas.sort((a, b) => (a[0] === 'pendente' ? 0 : 1) - (b[0] === 'pendente' ? 0 : 1));

  const tetos = N.unidadesAtivas().filter((u) => u.teto_qtd).map((u) => {
    const c = C.consumoTeto(u, dados.escala, mes);
    return `<div class="teto linha ${c.pct >= 100 ? 'cheio' : c.pct >= 90 ? 'alerta' : ''}"><span>${esc(u.nome)}<small> · ${c.mensal ? 'mês' : 'total'}</small></span><div class="barra"><i style="width:${Math.min(100, c.pct)}%"></i></div><b>${c.exec}/${c.teto}</b></div>`;
  }).join('');

  return `<p class="texto">Olá, ${esc(N.estado.usuario.nome.split(' ')[0])}. Este é o retrato de <b>${N.mesBR(mes)}</b>.</p>
    <div class="indicadores">
      <div class="cartao"><small>Atendimentos no mês</small><b>${t.pacientes}</b></div>
      <div class="cartao"><small>Faturamento previsto</small><b>${C.dinheiro(t.fat)}</b></div>
      <div class="cartao"><small>Repasse aos médicos</small><b>${C.dinheiro(t.rep)}</b></div>
      <div class="cartao"><small>Margem da operação</small><b class="${t.margem < 0 ? 'neg' : 'pos'}">${C.dinheiro(t.margem)}</b><em>fat − repasse − imposto</em></div>
      <div class="cartao"><small>Entradas no caixa</small><b>${C.dinheiro(f.entradas)}</b></div>
      <div class="cartao"><small>Despesas</small><b>${C.dinheiro(f.despesas)}</b></div>
    </div>
    <div class="duas-colunas">
      <section class="cartao bloco"><h2>Precisa de atenção</h2>${alertas.length ? `<ul class="alertas">${alertas.slice(0, 12).map(([cls, txt, link]) => `<li><a href="${link}">${N.selo(cls, cls === 'pendente' ? 'urgente' : 'atenção')} ${esc(txt)}</a></li>`).join('')}</ul>${alertas.length > 12 ? `<p class="fraco">e mais ${alertas.length - 12}…</p>` : ''}` : '<p class="fraco">Nada pendente. 🎉</p>'}</section>
      <section class="cartao bloco"><h2>Atendimentos — últimos 6 meses</h2>
        <div class="colunas-graf" role="img" aria-label="Atendimentos por mês: ${serie.map((x) => N.mesBR(x.m) + ' ' + x.v).join(', ')}">${serie.map((x) => `<div><span>${x.v}</span><i style="height:${Math.round(x.v / maior * 100)}%"></i><small>${N.MESES[Number(x.m.slice(5)) - 1]}</small></div>`).join('')}</div>
        ${tetos ? `<h2>Tetos</h2>${tetos}` : ''}</section>
    </div>`;
}

export default { id: 'inicio', titulo: 'Início', icone: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', render, acoes: {} };
