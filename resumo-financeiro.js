// Injeta um "Resumo financeiro" no topo da aba Painel gerencial do GSER,
// lendo cm_fin_entries pelo mesmo Supabase/sessão. Não altera o app compilado.
(function () {
  var cfg = window.GSER_CONFIG || {};
  var API = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  var KEY = cfg.supabasePublishableKey || '';
  var SK = cfg.sessionKey || 'gser.session.v1';
  function sess() { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } }
  function money(x) { return Number(x || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  var cache = null, cacheAt = 0, busy = false;

  async function getData() {
    if (cache && Date.now() - cacheAt < 20000) return cache;
    var s = sess(); if (!s) return [];
    try {
      var r = await fetch(API + '/rest/v1/cm_fin_entries?select=kind,amount,competence,status_fin,is_aporte',
        { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } });
      if (!r.ok) return []; cache = await r.json(); cacheAt = Date.now(); return cache;
    } catch (e) { return []; }
  }

  // Produção (executado) × teto por contrato — vem da Escala (serviços + slots)
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var prodCache = null, prodAt = 0;
  var EMPTY = { services: [], byContract: {}, total: { teto: 0, exec: 0 }, unitResults: [], mesAmes: [] };
  async function getProd() {
    if (prodCache && Date.now() - prodAt < 12000) return prodCache;
    var s = sess(); if (!s) return EMPTY;
    var h = { apikey: KEY, Authorization: 'Bearer ' + s.access_token };
    try {
      var res = await Promise.all([
        fetch(API + '/rest/v1/cm_contracts?select=id,contract_number,supplier_name', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_units?select=id,name,contract_id,teto_qtd,tax_rate,display_order', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_slots?select=unit_id,contract_id,slot_date,period_key,patients,status', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_period_rates?select=unit_id,period_key,billing_per_patient,transfer_per_patient', { headers: h }).then(function (r) { return r.json(); }),
      ]);
      var cs = Array.isArray(res[0]) ? res[0] : [], us = Array.isArray(res[1]) ? res[1] : [], sl = Array.isArray(res[2]) ? res[2] : [], rt = Array.isArray(res[3]) ? res[3] : [];
      var num = {}, sup = {}; cs.forEach(function (c) { num[c.id] = c.contract_number; sup[c.id] = c.supplier_name; });
      var rate = {}; rt.forEach(function (r) { rate[r.unit_id + '|' + r.period_key] = r; });
      var rfor = function (uid, pk) { return rate[uid + '|' + pk] || { billing_per_patient: 0, transfer_per_patient: 0 }; };
      var execU = {}, execC = {}, tetoC = {};
      var resU = {}, mm = {};
      sl.forEach(function (x) {
        if (x.status !== 'preenchido' && x.status !== 'confirmado') return;
        var q = Number(x.patients || 0), r = rfor(x.unit_id, x.period_key);
        var fat = q * Number(r.billing_per_patient || 0), rep = q * Number(r.transfer_per_patient || 0);
        if (x.unit_id) { execU[x.unit_id] = (execU[x.unit_id] || 0) + q; var o = resU[x.unit_id] || { pac: 0, fat: 0, rep: 0 }; o.pac += q; o.fat += fat; o.rep += rep; resU[x.unit_id] = o; }
        if (x.contract_id) execC[x.contract_id] = (execC[x.contract_id] || 0) + q;
        var comp = (x.slot_date || '').slice(0, 7); if (comp) { var m = mm[comp] || { pac: 0, fat: 0, rep: 0 }; m.pac += q; m.fat += fat; m.rep += rep; mm[comp] = m; }
      });
      us.forEach(function (u) { if (u.contract_id && u.teto_qtd) tetoC[u.contract_id] = (tetoC[u.contract_id] || 0) + Number(u.teto_qtd); });
      var services = us.filter(function (u) { return u.teto_qtd; }).map(function (u) { return { name: u.name, teto: Number(u.teto_qtd), exec: execU[u.id] || 0, contr: num[u.contract_id] || '' }; });
      var unitResults = us.slice().sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); }).filter(function (u) { return resU[u.id]; }).map(function (u) {
        var o = resU[u.id], tax = Number(u.tax_rate || 0), imp = o.fat * tax;
        return { name: u.name, pac: o.pac, fat: o.fat, rep: o.rep, tax: tax, imp: imp, res: o.fat - o.rep - imp };
      });
      var mesAmes = Object.keys(mm).sort().map(function (c) { var o = mm[c]; return { comp: c, pac: o.pac, fat: o.fat, rep: o.rep, liq: o.fat - o.rep }; });
      var byContract = {}, totT = 0, totE = 0;
      Object.keys(tetoC).forEach(function (id) {
        var o = { teto: tetoC[id], exec: execC[id] || 0 };
        totT += o.teto; totE += o.exec;
        if (num[id]) byContract[norm(num[id])] = o;
        if (sup[id]) byContract[norm(sup[id])] = o;
      });
      prodCache = { services: services, byContract: byContract, total: { teto: totT, exec: totE }, unitResults: unitResults, mesAmes: mesAmes };
      prodAt = Date.now(); return prodCache;
    } catch (e) { return EMPTY; }
  }

  var MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function trackInner(unitResults, mesAmes) {
    if ((!unitResults || !unitResults.length) && (!mesAmes || !mesAmes.length)) return '';
    var cores = ['#1a4fa0', '#0e7c5a', '#14688b', '#6b46c1', '#b45309', '#be185d'];
    var cards = (unitResults || []).map(function (u, i) {
      var cor = cores[i % cores.length];
      var lin = function (k, v, c) { return '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:.86rem"><span style="color:#667">' + k + '</span><b' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b></div>'; };
      return '<div style="flex:1;min-width:230px;background:#fff;border:1px solid #dde1e8;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)"><div style="background:' + cor + ';color:#fff;padding:10px 14px;font-weight:700">' + esc(u.name) + '</div><div style="padding:12px 14px">'
        + lin('Pacientes', u.pac) + lin('Faturamento', brl(u.fat), '#1a4fa0') + lin('Repasse', brl(u.rep), '#c62828') + lin('Imposto (' + (u.tax * 100).toFixed(0) + '%)', brl(u.imp), '#ea580c')
        + '<div style="border-top:1px solid #eef2f7;margin-top:5px;padding-top:5px">' + lin('Resultado', brl(u.res), '#0e7c5a') + '</div></div></div>';
    }).join('');
    var mmRows = (mesAmes || []).map(function (m) { var p = m.comp.split('-'); return '<tr><td>' + MES[parseInt(p[1]) - 1] + '/' + p[0] + '</td><td class="amount">' + m.pac + '</td><td class="amount">' + brl(m.fat) + '</td><td class="amount" style="color:#c62828">' + brl(m.rep) + '</td><td class="amount" style="color:#0e7c5a">' + brl(m.liq) + '</td></tr>'; }).join('');
    return '<div style="font-family:Inter,system-ui,sans-serif">'
      + '<h3 style="font-size:1.05rem;color:#1a4fa0;margin:0 0 12px">Resultado por unidade de negócio <small style="color:#667;font-weight:400">(acumulado)</small></h3>'
      + '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px">' + (cards || '<div style="color:#667">Sem produção lançada.</div>') + '</div>'
      + '<h3 style="font-size:1.05rem;color:#1a4fa0;margin:0 0 12px">Produção mês a mês</h3>'
      + '<div style="background:#fff;border:1px solid #dde1e8;border-radius:12px;overflow:auto;box-shadow:0 2px 8px rgba(0,0,0,.05)"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f3f6f9">'
      + '<th style="text-align:left;padding:9px 12px;font-size:.78rem;color:#667">Mês</th><th style="text-align:right;padding:9px 12px;font-size:.78rem;color:#667">Atendimentos</th><th style="text-align:right;padding:9px 12px;font-size:.78rem;color:#667">Faturamento</th><th style="text-align:right;padding:9px 12px;font-size:.78rem;color:#667">Repasse</th><th style="text-align:right;padding:9px 12px;font-size:.78rem;color:#667">Líquido</th></tr></thead>'
      + '<tbody>' + (mmRows || '<tr><td colspan="5" style="padding:12px;color:#667">Sem produção lançada.</td></tr>') + '</tbody></table></div></div>';
  }

  // Sobrepõe a coluna "Uso do contrato" com produção/teto (tabelas que mostram inativos também)
  function augmentUsage(byC) {
    if (!byC) return;
    document.querySelectorAll('table').forEach(function (tbl) {
      var ths = tbl.querySelectorAll('thead th');
      if (!ths.length) return;
      var heads = [].map.call(ths, function (th) { return th.textContent.trim(); });
      var ui = heads.indexOf('Uso do contrato'); if (ui < 0) ui = heads.indexOf('Produção × teto'); if (ui < 0) ui = heads.indexOf('Uso');
      if (ui < 0) return;
      if (ths[ui] && ths[ui].textContent.trim() !== 'Produção × teto') ths[ui].textContent = 'Produção × teto';
      tbl.querySelectorAll('tbody tr').forEach(function (tr) {
        var cell = tr.children[ui]; if (!cell || cell.dataset.bnprod) return;
        var strong = tr.querySelector('td strong'); var small = tr.querySelector('td small');
        var p = (strong && byC[norm(strong.textContent)]) || (small && byC[norm(small.textContent)]);
        if (!p || !p.teto) return;
        var pct = Math.min(100, Math.round(p.exec / p.teto * 100));
        var col = pct >= 100 ? '#0e7c5a' : pct >= 90 ? '#ea580c' : '#14688b';
        cell.dataset.bnprod = '1';
        cell.innerHTML = '<div style="font-weight:700;color:' + col + '">' + pct + '% <small style="color:#6b7280;font-weight:400">(' + p.exec + '/' + p.teto + ')</small></div><div style="height:6px;background:#eef2f7;border-radius:4px;margin-top:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + col + '"></div></div>';
      });
    });
  }

  // Troca o KPI "Uso financeiro dos contratos" por produção/teto total
  function augmentKPI(total) {
    var pct = total.teto ? Math.round(total.exec / total.teto * 100) : 0;
    var alvo = pct + '%';
    document.querySelectorAll('.metric').forEach(function (mdiv) {
      var sp = mdiv.querySelector('span'); if (!sp) return;
      var t = sp.textContent.trim();
      if (t !== 'Uso financeiro dos contratos' && t !== 'Uso dos contratos (produção)') return;
      if (sp.textContent.trim() !== 'Uso dos contratos (produção)') sp.textContent = 'Uso dos contratos (produção)';
      var b = mdiv.querySelector('b'); if (b && b.textContent.trim() !== alvo) b.textContent = alvo;
      var sm = mdiv.querySelector('small'); if (sm && sm.textContent.indexOf('atend') < 0) sm.textContent = 'Executado ÷ teto (' + total.exec + '/' + total.teto + ' atend.)';
    });
  }

  function prodPanelInner(services) {
    if (!services || !services.length) return '';
    var totT = 0, totE = 0;
    services.forEach(function (s) { totT += s.teto; totE += s.exec; });
    var totPct = totT ? Math.round(totE / totT * 100) : 0;
    var bars = services.slice().sort(function (a, b) { return b.teto - a.teto; }).map(function (s) {
      var pct = s.teto ? Math.min(100, Math.round(s.exec / s.teto * 100)) : 0;
      var col = pct >= 100 ? '#0e7c5a' : pct >= 90 ? '#ea580c' : '#14688b';
      return '<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:.84rem"><span><b>' + esc(s.name) + '</b> <small style="color:#6b7280">' + esc(s.contr) + '</small></span><span style="font-weight:700;color:' + col + '">' + pct + '% <small style="color:#6b7280;font-weight:400">(' + s.exec + '/' + s.teto + ')</small></span></div><div style="height:8px;background:#eef2f7;border-radius:5px;overflow:hidden;margin-top:3px"><div style="height:100%;width:' + pct + '%;background:' + col + '"></div></div></div>';
    }).join('');
    var tcol = totPct >= 100 ? '#0e7c5a' : '#1a4fa0';
    return '<div style="background:#fff;border:1px solid #dde1e8;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><h3 style="font-size:1rem;margin:0;color:#1a4fa0">Uso dos contratos — produção × teto</h3><div style="font-size:1.15rem;font-weight:800;color:' + tcol + '">' + totPct + '% <small style="font-size:.7rem;color:#6b7280;font-weight:400">de uso (' + totE + '/' + totT + ' atend.)</small></div></div>'
      + bars + '</div>';
  }

  function panelHTML(data) {
    var y = new Date().toISOString().slice(0, 4);
    var fat = 0, desp = 0, liqE = 0, liqD = 0, abE = 0, abD = 0;
    var rec = Array(12).fill(0), dsp = Array(12).fill(0);
    data.forEach(function (e) {
      if (!e.competence || e.competence.slice(0, 4) !== y) return;
      var m = parseInt(e.competence.slice(5, 7)) - 1, a = Number(e.amount) || 0, st = e.status_fin || 'liquidado';
      if (e.kind === 'entrada') { if (e.is_aporte) return; fat += a; rec[m] += a; if (st === 'liquidado') liqE += a; else if (st === 'aberto') abE += a; }
      else { desp += a; dsp[m] += a; if (st === 'liquidado') liqD += a; else if (st === 'aberto') abD += a; }
    });
    var liq = fat - desp, liquidado = liqE - liqD, aberto = abE - abD;
    var M = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    var mx = Math.max(1, Math.max.apply(null, rec), Math.max.apply(null, dsp)), bars = '';
    for (var i = 0; i < 12; i++) {
      if (!rec[i] && !dsp[i]) continue;
      bars += '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:34px">'
        + '<div style="display:flex;gap:2px;align-items:flex-end;height:46px">'
        + '<div title="Receita ' + money(rec[i]) + '" style="width:9px;border-radius:2px;background:#0e7c5a;height:' + Math.max(2, Math.round(rec[i] / mx * 46)) + 'px"></div>'
        + '<div title="Despesa ' + money(dsp[i]) + '" style="width:9px;border-radius:2px;background:#c62828;height:' + Math.max(2, Math.round(dsp[i] / mx * 46)) + 'px"></div>'
        + '</div><small style="color:#6b7280;font-size:.7rem">' + M[i] + '</small></div>';
    }
    function card(lbl, val, color) {
      return '<div style="background:#fff;border:1px solid #dde1e8;border-top:3px solid ' + color + ';border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
        + '<div style="font-size:.76rem;color:#6b7280">' + lbl + '</div>'
        + '<div style="font-size:1.35rem;font-weight:700;margin-top:4px;color:' + (val < 0 ? '#c62828' : '#111827') + '">' + money(val) + '</div></div>';
    }
    return '<div id="bnfin" style="margin:0 0 22px;font-family:Inter,system-ui,sans-serif">'
      + '<h3 style="font-size:1rem;margin:0 0 12px;color:#1a4fa0">Resumo financeiro — ano ' + y + '</h3>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">'
      + card('Faturamento', fat, '#0e7c5a') + card('Despesas', desp, '#c62828') + card('Resultado líquido', liq, '#1a4fa0')
      + card('Liquidado', liquidado, '#0e7c5a') + card('Em aberto', aberto, '#ea580c') + '</div>'
      + (bars ? '<div style="background:#fff;border:1px solid #dde1e8;border-radius:12px;padding:14px 16px;margin-top:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
        + '<div style="font-size:.78rem;color:#6b7280;margin-bottom:8px">Evolução mês a mês (receita / despesa)</div>'
        + '<div style="display:flex;gap:10px;align-items:flex-end;overflow-x:auto">' + bars + '</div></div>' : '')
      + '</div>';
  }

  function dashActive() { var b = document.querySelector('[data-nav="dashboard"]'); return b && b.classList.contains('active'); }
  function trackActive() { var b = document.querySelector('[data-nav="tracking"]'); return b && b.classList.contains('active'); }

  async function tick() {
    var view = document.getElementById('view');
    if (!view) return;
    var onDash = dashActive();
    // bnfin (resumo financeiro) só no painel
    if (onDash) {
      if (!document.getElementById('bnfin') && !busy) {
        busy = true;
        try {
          var data = await getData();
          if (!document.getElementById('bnfin') && view.parentNode) {
            var div = document.createElement('div'); div.innerHTML = panelHTML(data);
            view.parentNode.insertBefore(div.firstChild, view);
          }
        } finally { busy = false; }
      }
    } else { var exf = document.getElementById('bnfin'); if (exf) exf.remove(); }
    var onTrack = trackActive();
    try {
      getProd().then(function (p) {
        augmentUsage(p.byContract);
        // Painel gerencial: KPI de produção + painel de uso
        if (onDash) {
          augmentKPI(p.total);
          var content = prodPanelInner(p.services);
          var w = document.getElementById('bnprod');
          if (!content) { if (w) w.remove(); }
          else {
            if (!w) {
              w = document.createElement('div'); w.id = 'bnprod';
              w.style.cssText = 'margin:0 0 22px;font-family:Inter,system-ui,sans-serif';
              var anchor = document.getElementById('bnfin');
              if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(w, anchor.nextSibling);
              else if (view.parentNode) view.parentNode.insertBefore(w, view);
            }
            if (w.__bnsig !== content) { w.__bnsig = content; w.innerHTML = content; }
          }
        } else { var exp = document.getElementById('bnprod'); if (exp) exp.remove(); }
        // Acompanhamento mensal: resultado por unidade + produção mês a mês (esconde a grade GSER)
        if (onTrack) {
          view.querySelectorAll('.monthly-grid, .trackingtools').forEach(function (e) { e.style.display = 'none'; });
          var tc = trackInner(p.unitResults, p.mesAmes);
          var wt = document.getElementById('bntrack');
          if (!tc) { if (wt) wt.remove(); }
          else {
            if (!wt) { wt = document.createElement('div'); wt.id = 'bntrack'; wt.style.cssText = 'margin:0 0 16px'; view.insertBefore(wt, view.firstChild); }
            if (wt.__bnsig !== tc) { wt.__bnsig = tc; wt.innerHTML = tc; }
          }
        } else { var ext = document.getElementById('bntrack'); if (ext) ext.remove(); }
      });
    } catch (e) { }
  }

  new MutationObserver(function () { tick(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 3000);
})();
