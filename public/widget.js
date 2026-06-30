/* ChatDesk embeddable widget. One line to install:
   <script src="https://YOURHOST/widget.js" data-tenant="rainnetworks" defer></script>
   Renders in a shadow root so host-site CSS cannot interfere (and vice versa). */
(function () {
  var me = document.currentScript || (function () {
    var s = document.querySelectorAll('script[data-tenant]'); return s[s.length - 1];
  })();
  if (!me) return;
  var TENANT = me.getAttribute('data-tenant');
  var BASE = new URL(me.src).origin;
  if (!TENANT) return;

  var SKEY = 'chatdesk_sid_' + TENANT;
  var sid = localStorage.getItem(SKEY);
  if (!sid) { sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(SKEY, sid); }

  var cfg = { name: 'Chat', brand: { accent: '#2563eb', launcherText: 'Chat now', headerTitle: 'Chat', greeting: 'Hi! How can we help?' } };
  var rendered = 0, polling = null, open = false;

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483000';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  function css(accent) {
    return '*{box-sizing:border-box;font-family:system-ui,Segoe UI,Roboto,sans-serif}' +
      '.launch{display:flex;align-items:center;gap:8px;background:' + accent + ';color:#fff;border:0;border-radius:999px;padding:13px 20px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}' +
      '.launch svg{width:18px;height:18px;fill:#fff}' +
      '.panel{display:none;flex-direction:column;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.32);border:1px solid #e6e9ef}' +
      '.panel.show{display:flex}' +
      '.hd{background:' + accent + ';color:#fff;padding:15px 16px;display:flex;align-items:center;justify-content:space-between}' +
      '.hd b{font-size:15px}.hd .st{font-size:12px;opacity:.9;margin-top:2px}' +
      '.x{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}' +
      '.body{flex:1;overflow-y:auto;padding:16px;background:#f7f9fc;display:flex;flex-direction:column;gap:10px}' +
      '.m{max-width:80%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
      '.m.you{align-self:flex-end;background:' + accent + ';color:#fff;border-bottom-right-radius:4px}' +
      '.m.them{align-self:flex-start;background:#fff;color:#16202b;border:1px solid #e6e9ef;border-bottom-left-radius:4px}' +
      '.who{font-size:11px;color:#6b7c92;margin:0 4px -2px}' +
      '.foot{display:flex;gap:8px;padding:12px;border-top:1px solid #eef1f5;background:#fff}' +
      '.foot input{flex:1;border:1px solid #d7dde6;border-radius:10px;padding:11px 12px;font-size:14px;outline:none}' +
      '.foot input:focus{border-color:' + accent + '}' +
      '.foot button{background:' + accent + ';color:#fff;border:0;border-radius:10px;padding:0 16px;font-weight:600;cursor:pointer}';
  }

  root.innerHTML =
    '<style id="s"></style>' +
    '<button class="launch" id="launch"><svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg><span id="lt">Chat now</span></button>' +
    '<div class="panel" id="panel">' +
      '<div class="hd"><div><b id="ht">Chat</b><div class="st" id="st">Online</div></div><button class="x" id="x">×</button></div>' +
      '<div class="body" id="body"></div>' +
      '<div class="foot"><input id="in" placeholder="Type a message…" autocomplete="off"/><button id="send">Send</button></div>' +
    '</div>';

  var $ = function (id) { return root.getElementById(id); };

  function statusText(s) {
    if (s === 'waiting') return 'Connecting you to a specialist…';
    if (s === 'human') return 'Specialist';
    if (s === 'ai') return 'Assistant';
    return 'Online';
  }
  function addMsg(from, text, who) {
    var wrap = document.createElement('div');
    if (who) { var w = document.createElement('div'); w.className = 'who'; w.textContent = who; wrap.appendChild(w); }
    var m = document.createElement('div');
    m.className = 'm ' + (from === 'visitor' ? 'you' : 'them');
    m.textContent = text;
    wrap.appendChild(m);
    $('body').appendChild(wrap);
    $('body').scrollTop = $('body').scrollHeight;
  }
  function applyMessages(msgs, status) {
    msgs.forEach(function (m) {
      var who = m.from === 'human' ? (m.rep || 'Specialist') : (m.from === 'ai' ? 'Assistant' : null);
      addMsg(m.from, m.text, who);
    });
    rendered += msgs.length;
    $('st').textContent = statusText(status);
  }
  function poll() {
    fetch(BASE + '/api/' + TENANT + '/poll?sessionId=' + encodeURIComponent(sid) + '&after=' + rendered)
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.messages && d.messages.length) applyMessages(d.messages, d.status); else if (d.status) $('st').textContent = statusText(d.status); })
      .catch(function () {});
  }
  function startPolling() { if (!polling) polling = setInterval(poll, 2500); }

  function send() {
    var v = $('in').value.trim(); if (!v) return;
    $('in').value = '';
    addMsg('visitor', v); rendered += 1;
    fetch(BASE + '/api/' + TENANT + '/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, text: v }),
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (d.status) $('st').textContent = statusText(d.status); setTimeout(poll, 600); })
      .catch(function () {});
  }

  function openPanel() {
    open = true; $('panel').classList.add('show'); $('launch').style.display = 'none';
    if (rendered === 0 && cfg.brand.greeting) { addMsg('ai', cfg.brand.greeting, 'Assistant'); }
    startPolling(); poll(); $('in').focus();
  }
  function closePanel() { open = false; $('panel').classList.remove('show'); $('launch').style.display = 'flex'; }

  // load tenant branding, then wire up
  fetch(BASE + '/api/' + TENANT + '/config').then(function (r) { return r.json(); }).then(function (c) {
    if (c && c.brand) cfg = c;
    var a = cfg.brand.accent || '#2563eb';
    $('s').textContent = css(a);
    $('lt').textContent = cfg.brand.launcherText || 'Chat now';
    $('ht').textContent = cfg.brand.headerTitle || cfg.name || 'Chat';
  }).catch(function () { $('s').textContent = css('#2563eb'); });

  $('launch').onclick = openPanel;
  $('x').onclick = closePanel;
  $('send').onclick = send;
  $('in').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
})();
