# ChatDesk

Multi-tenant live-chat widget that routes website chats to a team's **Zoom** channel, with a **45-second AI fallback** and **after-hours AI**. One embed line per customer site. Tenant #1 is Rain Networks.

## How it works

1. Visitor opens the widget on any page and sends a message.
2. **In business hours:** the message is posted into the tenant's Zoom channel and a timer starts. A rep can reply from Zoom and it appears live in the widget. If no rep replies within `humanWaitSeconds` (45), the AI takes over.
3. **After hours:** the AI answers from the first message.

Per-tenant config (Zoom channel, business hours + timezone, branding, AI persona) lives in `tenants/<id>.json`. Conversations are in-memory (ephemeral), so no database is needed to deploy.

## Run locally

```
npm install
OPENROUTER_API_KEY=sk-... npm start
# demo customer page:  http://localhost:3000/demo.html
# rep console (test):  http://localhost:3000/rep.html   (secret: changeme)
```

Without `OPENROUTER_API_KEY` the AI replies with the tenant's safe fallback line, everything else still works.

## Embed on a site (one line, same on every page)

```html
<script src="https://YOURHOST/widget.js" data-tenant="rainnetworks" defer></script>
```

## Deploy to Railway

Push to GitHub, deploy from repo. Railway runs `npm start` and injects `PORT`. Set env vars from `.env.example`.

## Zoom setup (bidirectional, the upgrade over the pilot)

The pilot only **posted** to Zoom (one-way). To let reps reply from Zoom back into the widget:

1. In the Zoom App Marketplace, build one **Team Chat Chatbot** app (scopes: `imchat:bot`, `team_chat:write`, plus event subscription for chatbot/channel messages).
2. Point its **Event notification endpoint** to `https://YOURHOST/api/zoom/events` (handles Zoom's URL-validation handshake automatically).
3. Each customer installs the app (OAuth) and picks the channel reps watch; store that per tenant in `tenants/<id>.json` under `zoom`.
4. For the fastest start (one-way ping, like the pilot), set `zoom.mode:"webhook"` and paste an Incoming Webhook URL into `zoom.incomingWebhookUrl`. The widget still gets the AI fallback; rep replies arrive once the Chatbot app (step 1-3) is live.

## Add a tenant

Drop a `tenants/<id>.json` (copy `rainnetworks.json`), set branding/hours/zoom/AI, redeploy. The embed becomes `data-tenant="<id>"`.

## Rain Networks embed

Add the one-line snippet to the bottom of `ws-Rain-Networks-v2/index.html` (and it propagates as you wish). Because the CMS strips `<script>` on ingest, keep this on the statically served site; re-add after any CMS round-trip.
# ChatDesk
