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
  async function getProd() {
    if (prodCache && Date.now() - prodAt < 15000) return prodCache;
    var empty = { byKey: {}, services: [] };
    var s = sess(); if (!s) return empty;
    var h = { apikey: KEY, Authorization: 'Bearer ' + s.access_token };
    try {
      var res = await Promise.all([
        fetch(API + '/rest/v1/cm_contracts?select=id,contract_number,supplier_name', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_units?select=id,name,contract_id,teto_qtd', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_slots?select=unit_id,contract_id,patients,status', { headers: h }).then(function (r) { return r.json(); }),
      ]);
      var cs = Array.isArray(res[0]) ? res[0] : [], us = Array.isArray(res[1]) ? res[1] : [], sl = Array.isArray(res[2]) ? res[2] : [];
      try { console.log('[BN] contratos:', cs.length, '| serviços:', us.length, '| slots:', sl.length); } catch (e) { }
      var num = {}, sup = {}; cs.forEach(function (c) { num[c.id] = c.contract_number; sup[c.id] = c.supplier_name; });
      var execU = {}, execC = {}, tetoC = {};
      sl.forEach(function (x) {
        if (x.status !== 'preenchido' && x.status !== 'confirmado') return;
        if (x.unit_id) execU[x.unit_id] = (execU[x.unit_id] || 0) + Number(x.patients || 0);
        if (x.contract_id) execC[x.contract_id] = (execC[x.contract_id] || 0) + Number(x.patients || 0);
      });
      us.forEach(function (u) { if (u.contract_id && u.teto_qtd) tetoC[u.contract_id] = (tetoC[u.contract_id] || 0) + Number(u.teto_qtd); });
      var byKey = {};
      Object.keys(tetoC).forEach(function (id) { var o = { teto: tetoC[id], exec: execC[id] || 0 }; if (num[id]) byKey[norm(num[id])] = o; if (sup[id]) byKey[norm(sup[id])] = o; });
      var services = us.filter(function (u) { return u.teto_qtd; }).map(function (u) { return { name: u.name, teto: Number(u.teto_qtd), exec: execU[u.id] || 0, contr: num[u.contract_id] || '' }; });
      try { console.log('[BN] serviços com teto:', services); } catch (e) { }
      var out = { byKey: byKey, services: services };
      prodCache = out; prodAt = Date.now(); return out;
    } catch (e) { try { console.log('[BN] erro getProd:', e.message); } catch (_) { } return empty; }
  }

  function prodPanelHTML(services) {
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
    return '<div id="bnprod" style="margin:0 0 22px;font-family:Inter,system-ui,sans-serif"><div style="background:#fff;border:1px solid #dde1e8;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><h3 style="font-size:1rem;margin:0;color:#1a4fa0">Uso dos contratos — produção × teto</h3><div style="font-size:1.15rem;font-weight:800;color:' + tcol + '">' + totPct + '% <small style="font-size:.7rem;color:#6b7280;font-weight:400">de uso (' + totE + '/' + totT + ' atend.)</small></div></div>'
      + bars + '</div></div>';
  }

  function augmentUsage(prod) {
    if (!prod || !Object.keys(prod).length) return;
    var tabs = document.querySelectorAll('#view table'), hit = false;
    tabs.forEach(function (tbl) {
      var ths = tbl.querySelectorAll('thead th');
      var heads = [].map.call(ths, function (th) { return th.textContent.trim(); });
      var ui = heads.indexOf('Uso do contrato'); if (ui < 0) ui = heads.indexOf('Produção × teto');
      if (ui < 0) return;
      if (ths[ui] && !ths[ui].dataset.bnprod) { ths[ui].dataset.bnprod = '1'; ths[ui].textContent = 'Produção × teto'; }
      tbl.querySelectorAll('tbody tr').forEach(function (tr) {
        var cell = tr.children[ui]; if (!cell || cell.dataset.bnprod) return;
        var strong = tr.querySelector('td strong'); var small = tr.querySelector('td small');
        var p = (strong && prod[norm(strong.textContent)]) || (small && prod[norm(small.textContent)]);
        if (!p || !p.teto) return;
        var pct = Math.min(100, Math.round(p.exec / p.teto * 100));
        var col = pct >= 100 ? '#0e7c5a' : pct >= 90 ? '#ea580c' : '#14688b';
        cell.dataset.bnprod = '1'; hit = true;
        cell.innerHTML = '<div style="font-weight:700;color:' + col + '">' + pct + '% <small style="color:#6b7280;font-weight:400">(' + p.exec + '/' + p.teto + ')</small></div><div style="height:6px;background:#eef2f7;border-radius:4px;margin-top:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + col + '"></div></div>';
      });
    });
    try { if (!hit) console.log('[BN] nenhuma linha casada. tabelas:', tabs.length, 'chaves prod:', Object.keys(prod)); } catch (e) { }
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

  async function tick() {
    var view = document.getElementById('view');
    if (dashActive() && view) {
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
      try {
        getProd().then(function (p) {
          augmentUsage(p.byKey);
          var fin = document.getElementById('bnfin');
          if (document.getElementById('bnprod') || !fin) return;
          var html = prodPanelHTML(p.services);
          if (!html) return;
          var d = document.createElement('div'); d.innerHTML = html;
          fin.parentNode.insertBefore(d.firstChild, fin.nextSibling);
        });
      } catch (e) { }
    } else { ['bnfin', 'bnprod'].forEach(function (id) { var ex = document.getElementById(id); if (ex) ex.remove(); }); }
  }

  new MutationObserver(function () { tick(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 3000);
})();
