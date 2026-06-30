// ChatDesk: multi-tenant live chat -> Zoom channel, with 45s AI fallback + after-hours AI.
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withinBusinessHours } from './lib/hours.js';
import { generateReply } from './lib/ai.js';
import { postToZoom, postCoachingToZoom, verifyZoomEvent } from './lib/zoom.js';
import { generateCoaching } from './lib/coach.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));

// Open CORS: the widget is embedded on customer sites (cross-origin by design).
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Rep-Secret');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- tenants ----
const tenants = new Map();
for (const f of readdirSync(join(__dirname, 'tenants')).filter(f => f.endsWith('.json'))) {
  const t = JSON.parse(readFileSync(join(__dirname, 'tenants', f), 'utf8'));
  tenants.set(t.id, t);
}
console.log(`Loaded ${tenants.size} tenant(s): ${[...tenants.keys()].join(', ')}`);

// ---- in-memory conversations (ephemeral; fine for live chat MVP) ----
const convos = new Map(); // key `${tenantId}:${sessionId}`
const key = (t, s) => `${t}:${s}`;
function getConvo(tenantId, sessionId) {
  const k = key(tenantId, sessionId);
  if (!convos.has(k)) {
    convos.set(k, { tenantId, sessionId, messages: [], status: 'new', humanJoined: false, aiTimer: null, createdAt: Date.now() });
  }
  return convos.get(k);
}
function push(c, from, text, meta = {}) {
  c.messages.push({ from, text, ts: Date.now(), ...meta });
}

// Fire-and-forget rep co-pilot: refresh coaching for the rep after a customer turn.
function runCoaching(tenant, c) {
  generateCoaching(tenant, c.messages).then(co => {
    if (!co) return;
    c.coaching = co;
    postCoachingToZoom(tenant, c.sessionId, co); // surface coaching in the rep's Zoom channel
  }).catch(() => {});
}

async function aiRespond(tenant, c) {
  const reply = await generateReply(tenant, c.messages);
  push(c, 'ai', reply);
  c.status = 'ai';
}

// ---- widget config (tenant branding for the embed) ----
app.get('/api/:tenant/config', (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  res.json({ id: t.id, name: t.name, brand: t.brand || {} });
});

// ---- visitor sends a message ----
app.post('/api/:tenant/send', async (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  const { sessionId, text, visitor } = req.body || {};
  if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text required' });

  const c = getConvo(t.id, sessionId);
  c.visitor = visitor || c.visitor;
  push(c, 'visitor', text);

  if (c.humanJoined) {
    // A rep is handling it; mirror the new message into Zoom so they see it.
    postToZoom(t, { sessionId, text, visitor: c.visitor });
    runCoaching(t, c); // co-pilot: coach the rep on this turn
    return res.json({ ok: true, status: 'human' });
  }

  const open = withinBusinessHours(t);
  if (!open) {
    // After hours: AI answers from the first message.
    await aiRespond(t, c);
    return res.json({ ok: true, status: c.status });
  }

  // In hours: notify the team's Zoom channel and start the human-wait timer once.
  postToZoom(t, { sessionId, text, visitor: c.visitor });
  runCoaching(t, c); // co-pilot ready for whichever rep picks this up
  if (!c.aiTimer && c.status !== 'ai') {
    c.status = 'waiting';
    const waitMs = (t.humanWaitSeconds ?? 45) * 1000;
    c.aiTimer = setTimeout(async () => {
      c.aiTimer = null;
      if (!c.humanJoined) await aiRespond(t, c);
    }, waitMs);
  }
  res.json({ ok: true, status: c.status });
});

// ---- widget polls for new messages + status ----
app.get('/api/:tenant/poll', (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  const c = getConvo(t.id, req.query.sessionId);
  const after = parseInt(req.query.after || '0', 10);
  res.json({ status: c.status, messages: c.messages.slice(after), total: c.messages.length });
});

// ---- a rep replies (manual/dashboard path; Zoom events use the same handler) ----
function repReply(t, sessionId, text, repName) {
  const c = getConvo(t.id, sessionId);
  if (c.aiTimer) { clearTimeout(c.aiTimer); c.aiTimer = null; }
  c.humanJoined = true;
  c.status = 'human';
  push(c, 'human', text, { rep: repName || 'Specialist' });
  return c;
}
app.post('/api/:tenant/rep-reply', (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  if ((process.env.REP_SHARED_SECRET || 'changeme') !== (req.headers['x-rep-secret'] || '')) {
    return res.status(401).json({ error: 'bad rep secret' });
  }
  const { sessionId, text, rep } = req.body || {};
  if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text required' });
  repReply(t, sessionId, text, rep);
  res.json({ ok: true });
});

// ---- rep console: list active sessions for a tenant ----
app.get('/api/:tenant/sessions', (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  if ((process.env.REP_SHARED_SECRET || 'changeme') !== (req.headers['x-rep-secret'] || '')) {
    return res.status(401).json({ error: 'bad rep secret' });
  }
  const list = [];
  for (const c of convos.values()) {
    if (c.tenantId !== t.id) continue;
    const lastVisitor = [...c.messages].reverse().find(m => m.from === 'visitor');
    list.push({ sessionId: c.sessionId, status: c.status, humanJoined: c.humanJoined, lastMessage: lastVisitor?.text || '', count: c.messages.length, updated: c.messages.at(-1)?.ts || c.createdAt, coaching: c.coaching || null });
  }
  list.sort((a, b) => b.updated - a.updated);
  res.json({ sessions: list });
});

// ---- rep co-pilot: latest coaching for one session ----
app.get('/api/:tenant/coach', (req, res) => {
  const t = tenants.get(req.params.tenant);
  if (!t) return res.status(404).json({ error: 'unknown tenant' });
  if ((process.env.REP_SHARED_SECRET || 'changeme') !== (req.headers['x-rep-secret'] || '')) {
    return res.status(401).json({ error: 'bad rep secret' });
  }
  const c = getConvo(t.id, req.query.sessionId);
  res.json({ coaching: c.coaching || null });
});

// ---- Zoom event webhook (bidirectional: rep reply in channel -> widget) ----
app.post('/api/zoom/events', (req, res) => {
  // Zoom URL validation handshake.
  if (req.body?.event === 'endpoint.url_validation') {
    const token = req.body.payload?.plainToken || '';
    return res.json({ plainToken: token, encryptedToken: token });
  }
  if (!verifyZoomEvent(req)) return res.sendStatus(401);
  // A rep replied in the channel. Expected to reference the session code [sessionId]
  // and identify the tenant + reply text. Mapping is wired when the Zoom app is published.
  const { tenant: tenantId, sessionId, text, rep } = req.body?.payload || {};
  const t = tenants.get(tenantId);
  if (t && sessionId && text) repReply(t, sessionId, text, rep);
  res.sendStatus(200);
});

app.get('/health', (_req, res) => res.json({ ok: true, tenants: [...tenants.keys()] }));
app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => console.log(`ChatDesk on :${PORT}`));
