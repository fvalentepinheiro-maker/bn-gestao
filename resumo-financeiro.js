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
      var r = await fetch(API + '/rest/v1/cm_fin_entries?select=kind,amount,competence,status_fin',
        { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } });
      if (!r.ok) return []; cache = await r.json(); cacheAt = Date.now(); return cache;
    } catch (e) { return []; }
  }

  function panelHTML(data) {
    var y = new Date().toISOString().slice(0, 4);
    var fat = 0, desp = 0, liqE = 0, liqD = 0, abE = 0, abD = 0;
    var rec = Array(12).fill(0), dsp = Array(12).fill(0);
    data.forEach(function (e) {
      if (!e.competence || e.competence.slice(0, 4) !== y) return;
      var m = parseInt(e.competence.slice(5, 7)) - 1, a = Number(e.amount) || 0, st = e.status_fin || 'liquidado';
      if (e.kind === 'entrada') { fat += a; rec[m] += a; if (st === 'liquidado') liqE += a; else if (st === 'aberto') abE += a; }
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
    } else { var ex = document.getElementById('bnfin'); if (ex) ex.remove(); }
  }

  new MutationObserver(function () { tick(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 3000);
})();
