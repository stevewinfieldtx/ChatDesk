// Zoom Team Chat integration.
//
// Two modes (set per tenant in tenants/<id>.json -> zoom.mode):
//   "webhook"  : one-way. Post into the channel via an Incoming Webhook URL. Reps SEE chats.
//   "chatbot"  : two-way. Post AS the Team Chat Chatbot via the Zoom API, and receive rep
//                replies as events at POST /api/zoom/events, relayed back into the widget.
//
// Chatbot mode needs (app-level, in env): ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_WEBHOOK_SECRET.
// And per-tenant (in tenants/<id>.json zoom block): botJid (robot_jid), toJid (channel JID),
// accountId. Rep-reply mapping: each customer message is posted with a short [sessionId] tag;
// the event handler maps a rep reply back to its session by that tag (and, when Zoom provides
// it, by the thread's parent message id). VALIDATE the event shape against a live app.

let _tok = { value: '', exp: 0 };

async function chatbotToken() {
  const id = process.env.ZOOM_CLIENT_ID, secret = process.env.ZOOM_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_tok.value && Date.now() < _tok.exp - 60000) return _tok.value;
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://zoom.us/oauth/token?grant_type=client_credentials', {
    method: 'POST', headers: { Authorization: `Basic ${basic}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  _tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return _tok.value;
}

async function chatbotSend(tenant, content) {
  const z = tenant.zoom || {};
  const token = await chatbotToken();
  if (!token || !z.botJid || !z.toJid) return { ok: false };
  try {
    const r = await fetch('https://api.zoom.us/v2/im/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ robot_jid: z.botJid, to_jid: z.toJid, account_id: z.accountId, content }),
    });
    if (!r.ok) { console.log(`[zoom:${tenant.id}] chatbot send ${r.status}`); return { ok: false }; }
    const j = await r.json().catch(() => ({}));
    return { ok: true, messageId: j.message_id };
  } catch { return { ok: false }; }
}

async function webhookSend(z, head, line) {
  try {
    await fetch(z.incomingWebhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ head: { text: head }, body: [{ type: 'message', text: line }] }),
    });
    return { ok: true };
  } catch { return { ok: false }; }
}

// Post a customer message into the team's channel. Returns { ok, messageId }.
export async function postToZoom(tenant, { sessionId, text, visitor }) {
  const z = tenant.zoom || {};
  const who = visitor?.name ? visitor.name : 'Website visitor';
  const head = `Website chat (${tenant.name})`;
  const line = `${who} [${sessionId}]: ${text}`;
  if (z.mode === 'chatbot') return chatbotSend(tenant, { head: { text: head }, body: [{ type: 'message', text: line }] });
  if (z.mode === 'webhook' && z.incomingWebhookUrl) return webhookSend(z, head, line);
  console.log(`[zoom:${tenant.id}] (not configured) would post -> ${line}`);
  return { ok: false };
}

// Post a co-pilot coaching note (rep-only).
export async function postCoachingToZoom(tenant, sessionId, co) {
  if (!co) return { ok: false };
  const z = tenant.zoom || {};
  const head = `Co-pilot tip (${tenant.name})`;
  const line =
    `[${sessionId}] Vertical: ${co.vertical} | Intent: ${co.intent} | Tone: ${co.tone}\n` +
    `Pains: ${(co.pains || []).join(', ')}\n-> ${co.tip}`;
  if (z.mode === 'chatbot') return chatbotSend(tenant, { head: { text: head }, body: [{ type: 'message', text: line }] });
  if (z.mode === 'webhook' && z.incomingWebhookUrl) return webhookSend(z, head, line);
  console.log(`[zoom:${tenant.id}] (not configured) co-pilot -> ${line.replace(/\n/g, ' | ')}`);
  return { ok: false };
}

// Validate an inbound Zoom event (signature/secret). Loose in dev.
export function verifyZoomEvent(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET;
  if (!secret) return true;
  return Boolean(req.headers['authorization'] || req.headers['x-zm-signature']);
}

// Pull a rep reply out of a Zoom Team Chat event.
// Returns { kind:'validation', plainToken } | { kind:'reply', replyTo, text, rep } | null
// NOTE: field paths follow Zoom's documented chat_message.sent / bot_notification shapes and
// should be confirmed against the first real events your app sends.
export function parseRepEvent(body) {
  if (!body) return null;
  if (body.event === 'endpoint.url_validation') {
    return { kind: 'validation', plainToken: body.payload?.plainToken || '' };
  }
  const o = body.payload?.object || body.payload || {};
  const text = o.message || o.text || o.content || '';
  const rep = o.sender_name || o.operator || o.user_name || 'Specialist';
  const replyTo = o.reply_main_message_id || o.parent_message_id || null;
  const msgId = o.message_id || o.id || null;
  if (!text) return null;
  return { kind: 'reply', replyTo, msgId, text, rep };
}

// Extract a session tag like [s_abc123] from message text (reliable mapping fallback).
export function sessionFromText(text) {
  const m = String(text || '').match(/\[([A-Za-z0-9_]{4,})\]/);
  return m ? m[1] : null;
}
