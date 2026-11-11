// ESCALA — grade do mês por serviço: quem atende, quantos pacientes, situação do turno.
import * as N from '../nucleo.js';
import * as C from '../calculo.js';
const { esc, dados } = N;

const st = { unidade: null, mes: N.hoje().slice(0, 7), pessoa: '' };
const STATUS = { realizado: 'Realizado', confirmado: 'Confirmado', cancelado: 'Cancelado' };
const lanc = (u, data, turno) => dados.escala.find((l) => l.unidade_id === u && l.data === data && l.turno === turno);

// Grava um turno preservando o que já existe nele.
async function gravar(u, data, turno, mudanca) {
  const a = lanc(u, data, turno) || {};
  await N.gravarVarios('escala', [{
    unidade_id: u, data, turno,
    pessoa_id: a.pessoa_id ?? null, pacientes: a.pacientes ?? 0, status: a.status || 'vago', obs: a.obs ?? null, ...mudanca,
  }], 'unidade_id,data,turno');
  N.redesenhar();
}

function faixaTeto(u) {
  if (!u.teto_qtd) return '';
  const t = C.consumoTeto(u, dados.escala, st.mes);
  const cls = t.pct >= 100 ? 'cheio' : t.pct >= 90 ? 'alerta' : '';
  return `<div class="cartao teto ${cls}">
    <div><small>Contrato</small><b>${esc(u.contrato_id ? N.rotuloContrato(u.contrato_id) : 'sem contrato')}</b></div>
    <div><small>Teto ${t.mensal ? 'do mês' : 'total'}</small><b>${t.teto}</b></div>
    <div><small>Executado ${t.mensal ? 'no mês' : 'acumulado'}</small><b>${t.exec}</b></div>
    <div><small>Saldo</small><b class="${t.saldo < 0 ? 'neg' : ''}">${t.saldo}</b></div>
    <div class="cresce"><small>Consumo do teto · ${t.pct}%</small><div class="barra"><i style="width:${Math.min(100, t.pct)}%"></i></div></div></div>`;
}

function celula(u, dia, t, pode) {
  const l = lanc(u.id, dia.iso, t.chave), status = l?.status || 'vago', k = `${u.id}|${dia.iso}|${t.chave}`;
  const apagado = st.pessoa && l?.pessoa_id !== st.pessoa;
  const v = l ? C.valores(l, t) : { rep: 0 };
  const d = `data-u="${u.id}" data-d="${dia.iso}" data-t="${esc(t.chave)}"`;
  return `<div class="turno ${status}${apagado ? ' apagado' : ''}">
    <div class="turno-nome">${esc(t.rotulo)}</div>
    <button class="turno-medico${l?.pessoa_id ? '' : ' vazio'}" data-acao="atribuir" ${d} ${pode ? '' : 'disabled'}>${l?.pessoa_id ? esc(N.nomePessoa(l.pessoa_id)) : 'atribuir médico'}</button>
    ${l?.pessoa_id ? `<label class="turno-pac"><input type="number" min="0" inputmode="numeric" value="${l.pacientes}" data-mudar="pacientes" data-foco="p${k}" ${d} ${pode ? '' : 'disabled'} aria-label="Pacientes"> pac.</label>
      <div class="turno-status">${Object.entries(STATUS).map(([s, r]) => `<button class="${status === s ? 'on ' + s : ''}" data-acao="status" data-s="${s}" ${d} ${pode ? '' : 'disabled'} title="${r}" aria-pressed="${status === s}">${r.slice(0, 4)}.</button>`).join('')}</div>
      ${v.rep ? `<div class="turno-rep">repasse ${C.dinheiro(v.rep)}</div>` : ''}` : ''}
  </div>`;
}

function render() {
  const unidades = N.unidadesAtivas();
  if (!unidades.length) return '<div class="vazio">Nenhum serviço cadastrado. Cadastre em <a href="#/contratos">Contratos e tetos → Serviços e valores</a>.</div>';
  if (!unidades.some((u) => u.id === st.unidade)) st.unidade = unidades[0].id;
  const u = N.achar('unidades', st.unidade), turnos = N.turnosDa(u.id), pode = N.podeEditar();
  const doMes = dados.escala.filter((l) => l.unidade_id === u.id && C.mesDe(l.data) === st.mes);
  const tot = C.totais(doMes, dados.turnos, dados.unidades);
  const medicos = [...new Set(doMes.map((l) => l.pessoa_id).filter(Boolean))].sort((a, b) => N.nomePessoa(a).localeCompare(N.nomePessoa(b)));

  const grade = !turnos.length
    ? '<div class="vazio">Este serviço ainda não tem turnos. Cadastre em Contratos e tetos → Serviços e valores → Turnos.</div>'
    : C.semanasDoMes(st.mes).map((sem) => {
      const fatSem = C.totais(doMes.filter((l) => l.data >= sem[0].iso && l.data <= sem.at(-1).iso), dados.turnos, dados.unidades);
      return `<section class="semana"><header><b>${N.diaMes(sem[0].iso)} a ${N.diaMes(sem.at(-1).iso)}</b><span>${fatSem.pacientes} pac. · ${C.dinheiro(fatSem.fat)}</span></header>
        <div class="dias">${sem.map((dia) => `<div class="dia${dia.iso === N.hoje() ? ' hoje' : ''}${dia.ds === 0 || dia.ds === 6 ? ' fds' : ''}" style="--cor:${esc(u.cor)}">
          <div class="dia-topo"><b>${dia.dia}</b> ${N.DIAS[dia.ds]}</div>${turnos.map((t) => celula(u, dia, t, pode)).join('')}</div>`).join('')}</div></section>`;
    }).join('');

  return `<div class="abas">${unidades.map((x) => `<button class="${x.id === u.id ? 'ativa' : ''}" data-acao="unidade" data-id="${x.id}">${esc(x.nome)}</button>`).join('')}</div>
    <div class="barra-acoes">
      <button class="icone-botao" data-acao="mes" data-passo="-1" aria-label="Mês anterior">‹</button>
      <input type="month" value="${st.mes}" data-mudar="mesDireto" aria-label="Mês">
      <button class="icone-botao" data-acao="mes" data-passo="1" aria-label="Mês seguinte">›</button>
      <select data-mudar="pessoa" aria-label="Filtrar por médico"><option value="">Todos os médicos</option>${medicos.map((id) => `<option value="${id}" ${id === st.pessoa ? 'selected' : ''}>${esc(N.nomePessoa(id))}</option>`).join('')}</select>
      <span class="empurra"></span>
      ${pode ? '<button class="botao" data-acao="periodo">Marcar período</button><button class="botao" data-acao="importar">Importar</button>' : ''}
      <button class="botao" data-acao="fatura">Fatura (PDF)</button>
    </div>
    <div class="indicadores">
      <div class="cartao"><small>Atendimentos no mês</small><b>${tot.pacientes}</b></div>
      <div class="cartao"><small>Faturamento previsto</small><b>${C.dinheiro(tot.fat)}</b></div>
      <div class="cartao"><small>Repasse aos médicos</small><b>${C.dinheiro(tot.rep)}</b></div>
      <div class="cartao"><small>Margem (fat − repasse − imposto)</small><b>${C.dinheiro(tot.margem)}</b></div>
    </div>${faixaTeto(u)}${grade}`;
}

const acoes = {
  unidade: (d) => { st.unidade = d.id; st.pessoa = ''; N.redesenhar(); },
  mes: (d) => { st.mes = C.mesSeguinte(st.mes, Number(d.passo)); N.redesenhar(); },
  mesDireto: (d, el) => { if (el.value) { st.mes = el.value; N.redesenhar(); } },
  pessoa: (d, el) => { st.pessoa = el.value; N.redesenhar(); },
  pacientes: (d, el) => gravar(d.u, d.d, d.t, { pacientes: Math.max(0, parseInt(el.value, 10) || 0) }),
  status: (d) => gravar(d.u, d.d, d.t, { status: lanc(d.u, d.d, d.t)?.status === d.s ? 'realizado' : d.s }),

  atribuir(d) {
    const vinculados = dados.pessoa_unidades.filter((x) => x.unidade_id === d.u).map((x) => x.pessoa_id);
    const lista = dados.pessoas.filter((p) => p.ativo && p.tipo === 'medico' && vinculados.includes(p.id)).sort((a, b) => a.nome.localeCompare(b.nome));
    const t = N.turnosDa(d.u).find((x) => x.chave === d.t);
    const c = N.abrirJanela('Atribuir médico', `<p class="texto">${N.dataBR(d.d)} · ${esc(t?.rotulo || d.t)}</p>
      <div class="escolhas">${lista.map((p) => `<button class="botao" data-p="${p.id}">${esc(p.nome)}</button>`).join('') || '<p class="fraco">Nenhum médico ativo vinculado a este serviço. Vincule em Pessoas.</p>'}</div>
      <div class="acoes"><button class="botao" data-p="">Deixar vago</button><button class="botao" data-fechar>Fechar</button></div>`);
    c.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = async () => {
        N.fecharJanela();
        try { await gravar(d.u, d.d, d.t, b.dataset.p ? { pessoa_id: b.dataset.p, status: 'realizado' } : { pessoa_id: null, status: 'vago', pacientes: 0 }); }
        catch (e) { N.aviso(e.message, true); }
      };
    });
  },

  periodo() {
    const u = N.achar('unidades', st.unidade), ult = C.semanasDoMes(st.mes).at(-1).at(-1).iso;
    N.abrirFormulario({
      titulo: 'Marcar período — ' + u.nome, rotuloSalvar: 'Aplicar',
      campos: [{ id: 'de', rotulo: 'De', tipo: 'data', valor: st.mes + '-01', obrigatorio: true, meio: true }, { id: 'ate', rotulo: 'Até', tipo: 'data', valor: ult, obrigatorio: true, meio: true },
        { id: 'status', rotulo: 'Situação', tipo: 'escolha', opcoes: [['confirmado', 'Confirmado'], ['realizado', 'Realizado'], ['cancelado', 'Cancelado']], dica: 'Só altera turnos que já têm médico. Dias sem escala não são tocados.' }],
      aoSalvar: async (v) => {
        if (v.de > v.ate) throw new Error('A data inicial é maior que a final.');
        const alvo = dados.escala.filter((l) => l.unidade_id === u.id && l.pessoa_id && l.data >= v.de && l.data <= v.ate);
        await N.gravarVarios('escala', alvo.map(({ id, atualizado_em, ...l }) => ({ ...l, status: v.status })), 'unidade_id,data,turno');
        N.aviso(alvo.length + ' turnos marcados.'); N.redesenhar();
      },
    });
  },

  importar() {
    const u = N.achar('unidades', st.unidade);
    const form = N.abrirFormulario({
      titulo: 'Importar escala — ' + u.nome, rotuloSalvar: 'Importar',
      campos: [{ id: 'texto', rotulo: 'Cole as linhas (data ; turno ; médico ; pacientes ; situação)', tipo: 'area', obrigatorio: true,
        dica: 'Ex.: 25/08/2026; manha; Ana Caroline; 43; confirmado. Aceita ; , ou TAB. Cabeçalho é ignorado. Situação vazia = confirmado.' }],
      aoSalvar: async (v) => {
        const data = (s) => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
        const chaves = N.turnosDa(u.id);
        const turno = (s) => { const k = N.semAcento(s); return (chaves.find((t) => t.chave === k || N.semAcento(t.rotulo) === k || (k.length >= 3 && t.chave.startsWith(k.slice(0, 4)))) || {}).chave; };
        const status = (s) => { const k = N.semAcento(s); return k.startsWith('real') || k.startsWith('preen') ? 'realizado' : k.startsWith('canc') ? 'cancelado' : k.startsWith('vag') ? 'vago' : 'confirmado'; };
        const linhas = v.texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (/data/i.test(linhas[0] || '') && /(m[eé]dico|turno|paciente)/i.test(linhas[0])) linhas.shift();
        const ok = [], ruins = [];
        linhas.forEach((ln, i) => {
          const c = ln.split(/[\t;,]/).map((x) => x.trim()), dt = data(c[0] || ''), tn = turno(c[1] || '');
          if (!dt) return ruins.push(`linha ${i + 1}: data inválida`);
          if (!tn) return ruins.push(`linha ${i + 1}: turno "${c[1] || ''}" não existe neste serviço`);
          ok.push({ data: dt, turno: tn, medico: c[2] || '', pacientes: Math.max(0, parseInt(c[3], 10) || 0), status: status(c[4] || '') });
        });
        if (!ok.length) throw new Error('Nada válido para importar. ' + (ruins[0] || ''));
        for (const nome of new Set(ok.map((r) => r.medico).filter(Boolean))) {   // cria médico que ainda não existe e vincula
          const p = dados.pessoas.find((x) => N.semAcento(x.nome) === N.semAcento(nome)) || await N.salvar('pessoas', { nome, tipo: 'medico' });
          await N.gravarVarios('pessoa_unidades', [{ pessoa_id: p.id, unidade_id: u.id }], 'pessoa_id,unidade_id');
        }
        const unicos = new Map(ok.map((r) => [r.data + '|' + r.turno, r]));   // mesma data+turno repetida: vale a última
        await N.gravarVarios('escala', [...unicos.values()].map((r) => ({
          unidade_id: u.id, data: r.data, turno: r.turno, pacientes: r.pacientes, status: r.medico ? r.status : 'vago', obs: 'Importado',
          pessoa_id: r.medico ? dados.pessoas.find((x) => N.semAcento(x.nome) === N.semAcento(r.medico)).id : null,
        })), 'unidade_id,data,turno');
        N.aviso(`${unicos.size} lançamentos importados${ruins.length ? ` · ${ruins.length} linhas ignoradas (${ruins[0]})` : ''}.`, ruins.length > 0);
        N.redesenhar();
      },
    });
    form.querySelector('textarea').rows = 8;
  },

  fatura() {
    const u = N.achar('unidades', st.unidade), ult = C.semanasDoMes(st.mes).at(-1).at(-1).iso;
    N.abrirFormulario({
      titulo: 'Fatura — ' + u.nome, rotuloSalvar: 'Gerar PDF',
      campos: [{ id: 'de', rotulo: 'De', tipo: 'data', valor: st.mes + '-01', obrigatorio: true, meio: true }, { id: 'ate', rotulo: 'Até', tipo: 'data', valor: ult, obrigatorio: true, meio: true }],
      aoSalvar: async (v) => {
        // Produção por dia, sem nome de médico. Manhã separada; todos os outros turnos somam na tarde.
        const dias = {};
        for (const l of dados.escala) {
          if (l.unidade_id !== u.id || !C.conta(l) || l.data < v.de || l.data > v.ate) continue;
          const x = C.valores(l, C.turnoDe(dados.turnos, u.id, l.turno)), d = (dias[l.data] ||= { m: 0, t: 0, fat: 0 });
          if (l.turno === 'manha') d.m += x.pacientes; else d.t += x.pacientes;
          d.fat = C.r2(d.fat + x.fat);
        }
        const lista = Object.keys(dias).filter((d) => dias[d].m + dias[d].t > 0).sort();
        if (!lista.length) throw new Error('Nenhum atendimento realizado neste período.');
        const s = lista.reduce((a, d) => ({ m: a.m + dias[d].m, t: a.t + dias[d].t, fat: C.r2(a.fat + dias[d].fat) }), { m: 0, t: 0, fat: 0 });
        N.imprimir('Faturamento ' + u.nome, `<style>@page{margin:14mm}body{font:12px 'Segoe UI',Arial,sans-serif;color:#1f2a24;margin:0}
          .topo{display:flex;justify-content:space-between;border-bottom:3px solid #0e7c5a;padding-bottom:10px}.m{display:inline-block;background:#0e7c5a;color:#fff;font-weight:800;padding:10px 12px;border-radius:10px;margin-right:10px}
          .n{font-weight:800;color:#0e7c5a;font-size:16px}.s{color:#6b7a73;font-size:9px;text-transform:uppercase}.c{text-align:right;color:#4a5a52;font-size:10px;line-height:1.5}
          h1{font-size:15px;color:#0e7c5a;margin:16px 0 2px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#0e7c5a;color:#fff;padding:7px;text-align:center}
          td{padding:6px 7px;border-bottom:1px solid #e3e9e6;text-align:center}td:last-child,th:last-child{text-align:right}tfoot td{font-weight:800;background:#eef6f2;border-top:2px solid #0e7c5a}</style></head><body>
          <div class="topo"><div style="display:flex;align-items:center"><span class="m">BN</span><div><div class="n">BN Med Saúde</div><div class="s">Integramos Processos, Otimizamos Cuidado</div></div></div>
            <div class="c">licitacaobnsaude@gmail.com<br>(91) 99299-2424 · (91) 99248-3639</div></div>
          <h1>Demonstrativo de produção — ${esc(u.nome)}</h1><div>Período: ${N.dataBR(v.de)} a ${N.dataBR(v.ate)}${u.contrato_id ? ' · Contrato ' + esc(N.rotuloContrato(u.contrato_id)) : ''}</div>
          <table><thead><tr><th>Data</th><th>Manhã</th><th>Tarde</th><th>Total</th><th>Valor</th></tr></thead>
          <tbody>${lista.map((d) => `<tr><td>${N.dataBR(d)}</td><td>${dias[d].m}</td><td>${dias[d].t}</td><td><b>${dias[d].m + dias[d].t}</b></td><td>${C.dinheiro(dias[d].fat)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>TOTAL</td><td>${s.m}</td><td>${s.t}</td><td>${s.m + s.t}</td><td>${C.dinheiro(s.fat)}</td></tr></tfoot></table></body>`);
      },
    });
  },
};

export default { id: 'escala', titulo: 'Escala', icone: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', render, acoes };
