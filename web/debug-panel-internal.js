(function () {
  'use strict';

  var t0 = Date.now();
  var marks = {};
  var errors = [];
  var net = { health: ['idle', 'не проверено'], session: ['idle', 'не проверено'] };
  var ui = {};
  var timer = 0;

  function ms() { return Math.max(0, Date.now() - t0); }
  function text(value, max) {
    var result = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return result.length > max ? result.slice(0, max - 1) + '…' : result;
  }
  function file(value) {
    if (!value) return '';
    try {
      var u = new URL(String(value), location.origin);
      return u.origin === location.origin ? u.pathname : u.origin + u.pathname;
    } catch (_) { return text(value, 160).split('?')[0].split('#')[0]; }
  }
  function mark(name, status, detail) {
    marks[name] = { status: status || 'idle', detail: text(detail, 220), ms: ms() };
    drawSoon();
  }
  function fail(kind, message, source, line, column) {
    errors.push({ kind: kind, message: text(message || 'Unknown error', 260), file: file(source), line: line || 0, column: column || 0, ms: ms() });
    if (errors.length > 20) errors.shift();
    mark('JS errors', 'error', errors[errors.length - 1].message);
  }

  window.addEventListener('error', function (event) {
    fail('error', event.message || 'Script error', event.filename, event.lineno, event.colno);
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    fail('promise', event.reason && event.reason.message ? event.reason.message : event.reason, '', 0, 0);
  });

  mark('Debug bootstrap', 'ok', 'ранний диагностический скрипт запущен');
  mark('Telegram SDK', window.Telegram && Telegram.WebApp ? 'ok' : 'warn', window.Telegram && Telegram.WebApp ? 'WebApp доступен' : 'WebApp пока отсутствует');
  mark('Network', navigator.onLine === false ? 'warn' : 'ok', navigator.onLine === false ? 'offline' : 'online');

  document.addEventListener('readystatechange', function () { mark('Document state', 'ok', document.readyState); });
  document.addEventListener('DOMContentLoaded', function () {
    mark('DOMContentLoaded', 'ok', 'DOM готов');
    build();
    refresh();
    setTimeout(refresh, 400);
    setTimeout(refresh, 1400);
    setTimeout(refresh, 3600);
  }, { once: true });
  window.addEventListener('load', function () { mark('Window load', 'ok', 'ресурсы загружены'); refresh(); }, { once: true });
  window.addEventListener('online', function () { mark('Network', 'ok', 'online'); });
  window.addEventListener('offline', function () { mark('Network', 'warn', 'offline'); });

  function resource(path) {
    try {
      var list = performance.getEntriesByType('resource');
      for (var i = list.length - 1; i >= 0; i -= 1) {
        var u = new URL(list[i].name, location.href);
        if (u.origin === location.origin && u.pathname === path) return 'fetched · ' + Math.round(list[i].duration || 0) + 'ms';
      }
    } catch (_) { /* optional */ }
    return 'resource not seen';
  }
  function check(name, ok, yes, no) { mark(name, ok ? 'ok' : 'warn', ok ? yes : no); }
  function refresh() {
    var camera = document.getElementById('cameraView');
    var core = !!(camera && camera.style.getPropertyValue('--panel-alpha'));
    check('Telegram bridge', !!window.PromptCamTelegram, 'ready', 'global missing');
    check('Core app', core, 'app.js controls bound', 'not initialized · ' + resource('/app.js'));
    check('Live AI', !!window.PromptCamLiveAI, 'ready', 'missing · ' + resource('/live-ai.js'));
    check('Temporal AI', !!window.PromptCamTemporalAI, 'ready', 'missing · ' + resource('/live-ai-temporal.js'));
    check('AI styles', !!window.PromptCamLiveAIStyles, 'ready', 'missing · ' + resource('/live-ai-styles.js'));
    check('Speech Context', !!window.PromptCamSpeechContext, 'ready', 'missing · ' + resource('/live-ai-speech.js'));
    check('Script AI', !!window.PromptCamScriptAI, 'ready', 'missing · ' + resource('/script-ai.js'));
    check('Creator Library', !!window.PromptCamCreatorLibrary, 'ready', 'missing · ' + resource('/creator-library.js'));
    check('Take Director', !!window.PromptCamTakeDirector, 'ready', 'missing · ' + resource('/take-director.js'));
    check('Take beats', !!window.PromptCamTakeBeats, 'ready', 'missing · ' + resource('/take-director-beats.js'));
    check('Editor tabs', !!window.PromptCamEditorTabs, 'ready', 'missing · ' + resource('/editor-tabs.js'));

    var input = document.getElementById('scriptInput');
    var open = document.getElementById('openCameraButton');
    var tabCount = document.querySelectorAll ? document.querySelectorAll('.editor-tab').length : 0;
    mark('Editor DOM', input && open ? 'ok' : 'error', 'script=' + !!input + ' · cameraButton=' + !!open + ' · tabs=' + tabCount + ' · cameraView=' + !!camera);

    var tg = window.Telegram && Telegram.WebApp;
    mark('Telegram runtime', tg ? 'ok' : 'warn', tg ? ('platform=' + text(tg.platform || '?', 24) + ' · v=' + text(tg.version || '?', 16) + ' · initData=' + (tg.initData ? 'yes(' + tg.initData.length + ')' : 'no')) : 'WebApp unavailable');
    if (!errors.length) mark('JS errors', 'ok', 'ошибок не поймано');
    drawSoon();
  }

  function style() {
    if (document.getElementById('pcdbgStyle')) return;
    var s = document.createElement('style');
    s.id = 'pcdbgStyle';
    s.textContent = '#pcdbgBtn{position:fixed;z-index:2147483645;left:max(10px,env(safe-area-inset-left,0px));bottom:calc(76px + env(safe-area-inset-bottom,0px));height:28px;padding:0 9px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(6,7,12,.9);color:#ddd;font:800 10px -apple-system,sans-serif;box-shadow:0 5px 20px #0008}#pcdbgBtn[data-tone=error]{color:#ff8393;border-color:#ff4b5f99}#pcdbgBtn[data-tone=warn]{color:#ffd189;border-color:#ffbe5077}#pcdbgBtn[data-tone=ok]{color:#9fe3bd;border-color:#5adc9666}#pcdbg{position:fixed;z-index:2147483646;inset:max(8px,env(safe-area-inset-top,0px)) 8px max(8px,env(safe-area-inset-bottom,0px));display:grid;grid-template-rows:auto 1fr auto;border:1px solid #ffffff26;border-radius:18px;background:#07080dfc;color:#f2eff8;box-shadow:0 30px 90px #000b;font-family:-apple-system,sans-serif;overflow:hidden}#pcdbg[hidden]{display:none!important}.dbgHead{display:flex;align-items:center;gap:9px;padding:11px;border-bottom:1px solid #ffffff14}.dbgHead span:first-child{display:grid;gap:2px}.dbgHead b{font-size:13px}.dbgHead small{font-size:8px;color:#888291}.dbgSummary{margin-left:auto;padding:5px 7px;border-radius:999px;background:#ffffff0d;font-size:8px;font-weight:800}.dbgSummary[data-tone=error]{color:#ff8797}.dbgSummary[data-tone=warn]{color:#ffd18a}.dbgSummary[data-tone=ok]{color:#9ee1bb}.dbgClose{width:31px;height:31px;border:0;border-radius:10px;background:#ffffff10;color:#ddd;font-size:18px}.dbgBody{overflow:auto;padding:10px;-webkit-overflow-scrolling:touch}.dbgSec{display:grid;gap:6px;margin-bottom:13px}.dbgSec>strong{padding:0 3px;color:#77717f;font-size:8px;letter-spacing:.1em}.dbgRow{display:grid;grid-template-columns:13px 1fr auto;gap:7px;padding:8px;border:1px solid #ffffff0f;border-radius:10px;background:#ffffff06}.dbgRow i{font-style:normal;font-size:10px}.dbgRow[data-s=ok] i{color:#65d795}.dbgRow[data-s=warn] i{color:#f2bf69}.dbgRow[data-s=error] i{color:#ff687c}.dbgCopy{display:grid;gap:2px;min-width:0}.dbgCopy b{font-size:9px}.dbgCopy small{font-size:8px;color:#918a9a;line-height:1.35;overflow-wrap:anywhere}.dbgRow time{font-size:7px;color:#666}.dbgErr{display:grid;gap:4px;padding:8px;border:1px solid #ff5f6e2b;border-radius:10px;background:#ff465a0c}.dbgErr b{font-size:8px;color:#ff8392}.dbgErr span{font-size:9px;overflow-wrap:anywhere}.dbgErr small,.dbgEmpty{font-size:8px;color:#77717f;overflow-wrap:anywhere}.dbgActions{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:10px;border-top:1px solid #ffffff14}.dbgActions button{min-height:40px;border:1px solid #ffffff17;border-radius:11px;background:#ffffff0d;color:#ddd;font-size:9px;font-weight:780}.dbgActions button:first-child{border-color:#8262ff47;background:#6e4beb1f;color:#eee9ff}';
    document.head.appendChild(s);
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function icon(status) { return status === 'idle' ? '○' : '●'; }
  function row(name, item) {
    return '<div class="dbgRow" data-s="' + esc(item.status) + '"><i>' + icon(item.status) + '</i><span class="dbgCopy"><b>' + esc(name) + '</b><small>' + esc(item.detail) + '</small></span><time>' + (item.ms == null ? '' : '+' + item.ms + 'ms') + '</time></div>';
  }
  function draw() {
    if (!ui.body) return;
    var keys = Object.keys(marks).sort(function (a, b) { return marks[a].ms - marks[b].ms; });
    var ok = 0, warn = 0, bad = 0, html = '<section class="dbgSec"><strong>BOOT / MODULES</strong>';
    keys.forEach(function (key) {
      var item = marks[key];
      if (item.status === 'ok') ok += 1; else if (item.status === 'error') bad += 1; else if (item.status === 'warn') warn += 1;
      html += row(key, item);
    });
    html += '</section><section class="dbgSec"><strong>NETWORK</strong>' + row('Health', { status: net.health[0], detail: net.health[1] }) + row('Telegram session', { status: net.session[0], detail: net.session[1] }) + '</section><section class="dbgSec"><strong>ERRORS</strong>';
    if (!errors.length) html += '<div class="dbgEmpty">Ошибок пока нет.</div>';
    for (var i = errors.length - 1; i >= 0; i -= 1) {
      var e = errors[i];
      html += '<div class="dbgErr"><b>' + esc(e.kind) + '</b><span>' + esc(e.message) + '</span><small>' + esc(e.file || 'inline/unknown') + (e.line ? ':' + e.line + ':' + e.column : '') + ' · +' + e.ms + 'ms</small></div>';
    }
    html += '</section>';
    ui.body.innerHTML = html;
    var tone = bad ? 'error' : warn ? 'warn' : 'ok';
    ui.summary.textContent = bad ? ('ERROR ' + bad + ' · WARN ' + warn) : ('OK ' + ok + ' · WARN ' + warn);
    ui.summary.dataset.tone = tone;
    ui.button.dataset.tone = tone;
    ui.button.textContent = bad ? 'DBG ' + bad : 'DBG';
  }
  function drawSoon() {
    if (!ui.body || timer) return;
    timer = setTimeout(function () { timer = 0; draw(); }, 40);
  }

  function build() {
    if (ui.button || !document.body) return;
    style();
    var btn = document.createElement('button');
    btn.id = 'pcdbgBtn'; btn.type = 'button'; btn.textContent = 'DBG'; btn.setAttribute('aria-label', 'Открыть диагностику');
    var panel = document.createElement('section');
    panel.id = 'pcdbg'; panel.hidden = true;
    var head = document.createElement('div'); head.className = 'dbgHead';
    var title = document.createElement('span'); title.innerHTML = '<b>PromptCam Debug</b><small>boot / modules / network</small>';
    var summary = document.createElement('span'); summary.className = 'dbgSummary'; summary.textContent = '…';
    var close = document.createElement('button'); close.type = 'button'; close.className = 'dbgClose'; close.textContent = '×';
    head.append(title, summary, close);
    var body = document.createElement('div'); body.className = 'dbgBody';
    var actions = document.createElement('div'); actions.className = 'dbgActions';
    var refreshBtn = document.createElement('button'); refreshBtn.type = 'button'; refreshBtn.textContent = 'Обновить проверки';
    var copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.textContent = 'Копировать отчёт';
    actions.append(refreshBtn, copyBtn); panel.append(head, body, actions); document.body.append(btn, panel);
    ui = { button: btn, panel: panel, body: body, summary: summary };
    btn.addEventListener('click', open); close.addEventListener('click', closePanel);
    refreshBtn.addEventListener('click', function () { refresh(); networkChecks(); });
    copyBtn.addEventListener('click', copy);
    draw();
  }
  function open() { if (!ui.panel) build(); if (!ui.panel) return; ui.panel.hidden = false; refresh(); networkChecks(); }
  function closePanel() { if (ui.panel) ui.panel.hidden = true; }

  function timedFetch(url, init) {
    var c = typeof AbortController === 'function' ? new AbortController() : null;
    var id = c ? setTimeout(function () { c.abort(); }, 6000) : 0;
    var options = init || {}; if (c) options.signal = c.signal;
    return fetch(url, options).finally(function () { if (id) clearTimeout(id); });
  }
  function networkChecks() {
    net.health = ['idle', 'проверяю…']; net.session = ['idle', 'проверяю…']; draw();
    timedFetch('/api/health', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        net.health = [r.ok && d.ok ? 'ok' : 'error', 'HTTP ' + r.status + ' · service=' + text(d.service || '?', 40) + ' · ai=' + !!d.aiProviderConfigured + ' · db=' + !!d.billingDatabaseConfigured]; draw();
      });
    }).catch(function (e) { net.health = ['error', text(e && e.message || e, 150)]; draw(); });
    var tg = window.Telegram && Telegram.WebApp;
    if (!tg || !tg.initData) { net.session = ['warn', 'нет Telegram initData']; draw(); return; }
    timedFetch('/api/telegram/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData }), cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { net.session = [r.ok && d.ok ? 'ok' : 'error', 'HTTP ' + r.status + ' · session=' + !!d.ok + ' · user=' + (d.user ? 'present' : 'none')]; draw(); });
    }).catch(function (e) { net.session = ['error', text(e && e.message || e, 150)]; draw(); });
  }

  function snapshot() {
    var tg = window.Telegram && Telegram.WebApp;
    return { generatedAt: new Date().toISOString(), page: location.origin + location.pathname, readyState: document.readyState, online: navigator.onLine !== false, viewport: { width: innerWidth || 0, height: innerHeight || 0, dpr: devicePixelRatio || 1 }, telegram: { sdk: !!tg, platform: tg ? text(tg.platform || '', 24) : '', version: tg ? text(tg.version || '', 16) : '', initDataPresent: !!(tg && tg.initData), initDataLength: tg && tg.initData ? tg.initData.length : 0, isExpanded: !!(tg && tg.isExpanded), isFullscreen: !!(tg && tg.isFullscreen) }, marks: marks, network: net, errors: errors.slice() };
  }
  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(value);
    return new Promise(function (resolve, reject) {
      try { var a = document.createElement('textarea'); a.value = value; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); var ok = document.execCommand('copy'); a.remove(); ok ? resolve() : reject(new Error('copy_failed')); } catch (e) { reject(e); }
    });
  }
  function copy() {
    copyText(JSON.stringify(snapshot(), null, 2)).then(function () { mark('Debug report', 'ok', 'отчёт скопирован'); }).catch(function () { mark('Debug report', 'warn', 'clipboard недоступен · сделай скриншот'); });
  }

  window.PromptCamDebug = { mark: mark, open: open, close: closePanel, refresh: function () { refresh(); networkChecks(); }, snapshot: snapshot, copy: copy };
})();
