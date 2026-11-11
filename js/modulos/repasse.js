// REPASSE MÉDICO — uma linha por médico × serviço × mês: devido, pago ao médico e recebido do cliente.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { modo: 'mensal', mes: N.hoje().slice(0, 7), de: '', ate: '', unidade: '' };

function noPeriodo(data) {
  if (st.modo === 'mensal') return C.mesDe(data) === st.mes;
  if (st.modo === 'personalizado') return (!st.de || data >= st.de) && (!st.ate || data <= st.ate);
  return true;
}
const linhas = () => C.porMedicoMes(dados.escala.filter((l) => noPeriodo(l.data) && (!st.unidade || l.unidade_id === st.unidade)), dados.turnos)
  .filter((a) => a.pacientes > 0)
  .sort((a, b) => N.nomePessoa(a.pessoa_id).localeCompare(N.nomePessoa(b.pessoa_id)) || a.mes.localeCompare(b.mes) || N.nomeUnidade(a.unidade_id).localeCompare(N.nomeUnidade(b.unidade_id)));
const pagamento = (a) => dados.repasses.find((r) => r.pessoa_id === a.pessoa_id && r.unidade_id === a.unidade_id && C.mesDe(r.competencia) === a.mes) || {};

// Texto para enviar ao médico: produção por dia e total.
function mensagem(pessoaId) {
  const ls = dados.escala.filter((l) => l.pessoa_id === pessoaId && C.conta(l) && l.pacientes > 0 && noPeriodo(l.data) && (!st.unidade || l.unidade_id === st.unidade))
    .sort((a, b) => a.data.localeCompare(b.data));
  if (!ls.length) return 'Sem produção neste período.';
  const meses = [...new Set(ls.map((l) => C.mesDe(l.data)))].map(N.mesBR).join(', ');
  let tp = 0, tr = 0;
  const corpo = ls.map((l) => {
    const t = C.turnoDe(dados.turnos, l.unidade_id, l.turno), v = C.valores(l, t);
    tp += v.pacientes; tr = C.r2(tr + v.rep);
    const sem = new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
    return `• ${N.diaMes(l.data)} (${sem}) — ${N.nomeUnidade(l.unidade_id)} — ${t.rotulo} — ${v.pacientes} pac. — ${C.dinheiro(v.rep)}`;
  }).join('\n');
  return `📊 PRODUÇÃO — ${N.nomePessoa(pessoaId)}\nCompetência: ${meses}\n\n${corpo}\n\nTOTAL: ${tp} pacientes — ${C.dinheiro(tr)}`;
}

function render() {
  const ls = linhas(), pode = N.podeEditar();
  let devido = 0, pago = 0, fat = 0, recebido = 0;
  const corpo = ls.map((a) => {
    const p = pagamento(a), k = `${a.pessoa_id}|${a.unidade_id}|${a.mes}`;
    devido += a.rep; pago += Number(p.pago || 0); fat += a.fat; recebido += Number(p.recebido || 0);
    const sp = C.situacaoValor(p.pago, a.rep), sr = C.situacaoValor(p.recebido, a.fat);
    const d = `data-p="${a.pessoa_id}" data-u="${a.unidade_id}" data-m="${a.mes}"`;
    const ent = (campo, valor, tipo = 'number') => `<input type="${tipo}" ${tipo === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''} value="${esc(valor ?? (tipo === 'number' ? 0 : ''))}" data-mudar="pagar" data-campo="${campo}" data-foco="${campo}${k}" ${d} ${pode ? '' : 'disabled'} aria-label="${campo}">`;
    return `<tr><td><b>${esc(N.nomePessoa(a.pessoa_id))}</b></td><td>${esc(N.nomeUnidade(a.unidade_id))}</td><td>${N.mesBR(a.mes)}</td>
      <td class="n">${a.pacientes}</td><td class="n">${C.dinheiro(a.rep)}</td>
      <td>${ent('pago', p.pago)} ${N.selo(sp.cls, sp.txt)}</td><td>${ent('pago_em', p.pago_em, 'date')}</td>
      <td class="n">${C.dinheiro(a.fat)}</td><td>${ent('recebido', p.recebido)} ${N.selo(sr.cls, sr.txt)}</td>
      <td><button class="botao pequeno" data-acao="mensagem" data-p="${a.pessoa_id}" title="Mensagem de produção para o médico">Enviar</button></td></tr>`;
  }).join('');
  const modo = (k, r) => `<button class="${st.modo === k ? 'ativa' : ''}" data-acao="modo" data-k="${k}">${r}</button>`;
  return `<div class="barra-acoes">
      <div class="abas juntas">${modo('mensal', 'Mensal')}${modo('todo', 'Período todo')}${modo('personalizado', 'Personalizado')}</div>
      ${st.modo === 'mensal' ? `<input type="month" value="${st.mes}" data-mudar="filtro" data-k="mes" aria-label="Mês">` : ''}
      ${st.modo === 'personalizado' ? `<input type="date" value="${st.de}" data-mudar="filtro" data-k="de" aria-label="De"><input type="date" value="${st.ate}" data-mudar="filtro" data-k="ate" aria-label="Até">` : ''}
      <select data-mudar="filtro" data-k="unidade" aria-label="Serviço"><option value="">Todos os serviços</option>${N.unidadesAtivas().map((u) => `<option value="${u.id}" ${u.id === st.unidade ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>
    </div>
    <div class="indicadores">
      <div class="cartao"><small>Repasse devido</small><b>${C.dinheiro(devido)}</b></div>
      <div class="cartao"><small>Pago aos médicos</small><b>${C.dinheiro(pago)}</b><em>falta ${C.dinheiro(Math.max(0, devido - pago))}</em></div>
      <div class="cartao"><small>Faturamento devido</small><b>${C.dinheiro(fat)}</b></div>
      <div class="cartao"><small>Recebido do cliente</small><b>${C.dinheiro(recebido)}</b><em>falta ${C.dinheiro(Math.max(0, fat - recebido))}</em></div>
    </div>
    ${ls.length ? `<div class="rola"><table><thead><tr><th>Médico</th><th>Serviço</th><th>Mês</th><th class="n">Pac.</th><th class="n">Repasse devido</th><th>Pago ao médico</th><th>Data do pgto</th><th class="n">Faturamento</th><th>Recebido do cliente</th><th></th></tr></thead><tbody>${corpo}</tbody></table></div>`
      : '<div class="vazio">Nenhuma produção realizada neste período.</div>'}`;
}

const acoes = {
  modo: (d) => { st.modo = d.k; N.redesenhar(); },
  filtro: (d, el) => { st[d.k] = el.value; N.redesenhar(); },
  async pagar(d, el) {
    const comp = d.m + '-01';
    const a = dados.repasses.find((r) => r.pessoa_id === d.p && r.unidade_id === d.u && r.competencia === comp) || {};
    const valor = d.campo === 'pago_em' ? (el.value || null) : Math.max(0, C.r2(el.value));
    await N.gravarVarios('repasses', [{
      pessoa_id: d.p, unidade_id: d.u, competencia: comp, pago: a.pago ?? 0, pago_pacientes: a.pago_pacientes ?? 0, pago_em: a.pago_em ?? null,
      recebido: a.recebido ?? 0, recebido_pacientes: a.recebido_pacientes ?? 0, recebido_em: a.recebido_em ?? null, [d.campo]: valor,
    }], 'pessoa_id,unidade_id,competencia');
    N.redesenhar();
  },
  mensagem(d) {
    const c = N.abrirJanela('Produção do médico', `<p class="texto">Mensagem com a produção por dia do período filtrado na tela, pronta para enviar.</p>
      <textarea class="mensagem" rows="12" readonly>${esc(mensagem(d.p))}</textarea>
      <div class="acoes"><button class="botao" data-fechar>Fechar</button><button class="botao principal" data-copiar>Copiar mensagem</button></div>`);
    c.querySelector('[data-copiar]').onclick = () => N.copiar(c.querySelector('textarea').value);
  },
};

export default { id: 'repasse', titulo: 'Repasse médico', icone: '<path d="M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8"/>', render, acoes };
