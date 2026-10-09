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
  var prodCache = null, prodAt = 0;
  async function getProd() {
    if (prodCache && Date.now() - prodAt < 20000) return prodCache;
    var s = sess(); if (!s) return {};
    var h = { apikey: KEY, Authorization: 'Bearer ' + s.access_token };
    try {
      var res = await Promise.all([
        fetch(API + '/rest/v1/cm_contracts?select=id,contract_number,supplier_name', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_units?select=contract_id,teto_qtd', { headers: h }).then(function (r) { return r.json(); }),
        fetch(API + '/rest/v1/cm_schedule_slots?select=contract_id,patients,status&contract_id=not.is.null', { headers: h }).then(function (r) { return r.json(); }),
      ]);
      var cs = Array.isArray(res[0]) ? res[0] : [], us = Array.isArray(res[1]) ? res[1] : [], sl = Array.isArray(res[2]) ? res[2] : [];
      try { console.log('[BN] contratos:', cs.length, '| serviços:', us.length, '| slots:', sl.length, '| erros:', [res[0], res[1], res[2]].filter(function (r) { return !Array.isArray(r); })); } catch (e) { }
      var num = {}; cs.forEach(function (c) { num[c.id] = c.contract_number; });
      var teto = {}, exec = {};
      us.forEach(function (u) { if (u.contract_id && u.teto_qtd) teto[u.contract_id] = (teto[u.contract_id] || 0) + Number(u.teto_qtd); });
      sl.forEach(function (x) { if (x.status === 'preenchido' || x.status === 'confirmado') exec[x.contract_id] = (exec[x.contract_id] || 0) + Number(x.patients || 0); });
      var sup = {}; cs.forEach(function (c) { sup[c.id] = c.supplier_name; });
      var out = {};
      Object.keys(teto).forEach(function (id) {
        var o = { teto: teto[id], exec: exec[id] || 0 };
        if (num[id]) out[norm(num[id])] = o;
        if (sup[id]) out[norm(sup[id])] = o;
      });
      try { console.log('[BN] produção por contrato:', out); } catch (e) { }
      prodCache = out; prodAt = Date.now(); return out;
    } catch (e) { try { console.log('[BN] erro getProd:', e.message); } catch (_) { } return {}; }
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
      try { getProd().then(augmentUsage); } catch (e) { }
    } else { var ex = document.getElementById('bnfin'); if (ex) ex.remove(); }
  }

  new MutationObserver(function () { tick(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 3000);
})();
