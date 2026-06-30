// Zoom Team Chat integration.
// Phase 1 outbound: post a notice into the team's channel via an Incoming Webhook
// chatbot (tenant.zoom.incomingWebhookUrl). This is the same one-way path the pilot used.
// Phase 2 (bidirectional): a published Zoom Chatbot app posts as the bot and receives
// rep replies via event webhooks at POST /api/zoom/events, which relays them to the widget.
export async function postToZoom(tenant, { sessionId, text, visitor }) {
  const z = tenant.zoom || {};
  const head = `New website chat (${tenant.name})`;
  const who = visitor?.name ? `${visitor.name}` : 'Website visitor';
  const line = `${who} [${sessionId}]: ${text}`;

  if (z.mode === 'webhook' && z.incomingWebhookUrl) {
    try {
      await fetch(z.incomingWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ head: { text: head }, body: [{ type: 'message', text: line }] }),
      });
      return true;
    } catch {
      return false;
    }
  }
  // No Zoom configured yet: log so it is visible in Railway logs during setup.
  console.log(`[zoom:${tenant.id}] (not configured) would post -> ${line}`);
  return false;
}

// Post a co-pilot coaching note into the team's Zoom channel (rep-only guidance).
export async function postCoachingToZoom(tenant, sessionId, co) {
  if (!co) return false;
  const z = tenant.zoom || {};
  const line =
    `[${sessionId}] Vertical: ${co.vertical} | Intent: ${co.intent} | Tone: ${co.tone}\n` +
    `Pains: ${(co.pains || []).join(', ')}\n` +
    `-> ${co.tip}`;
  if (z.mode === 'webhook' && z.incomingWebhookUrl) {
    try {
      await fetch(z.incomingWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ head: { text: `Co-pilot tip (${tenant.name})` }, body: [{ type: 'message', text: line }] }),
      });
      return true;
    } catch { return false; }
  }
  console.log(`[zoom:${tenant.id}] (not configured) co-pilot -> ${line.replace(/\n/g, ' | ')}`);
  return false;
}

// Verify an inbound Zoom event webhook. Real impl compares the Zoom signature/secret.
export function verifyZoomEvent(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode
  // Zoom sends an Authorization/x-zm-signature header; validate here in production.
  const sig = req.headers['authorization'] || req.headers['x-zm-signature'];
  return Boolean(sig);
}
