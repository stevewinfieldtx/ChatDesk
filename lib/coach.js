// Live sales co-pilot: short coaching for the human rep during a chat.
// Returns { vertical, intent, tone, pains:[...], tip }. Rep-only, never shown to the customer.
export async function generateCoaching(tenant, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null; // no key -> no coaching (rep just chats normally)
  const ctx = tenant.ai?.persona || '';
  const convo = messages.slice(-10).map(m => `${m.from === 'visitor' ? 'CUSTOMER' : (m.from === 'human' ? 'REP' : 'AI')}: ${m.text}`).join('\n');

  const sys = `You are a real-time sales co-pilot for ${tenant.name}. A human rep is chatting with a website customer. Business context: ${ctx}
Listen to the conversation and coach the REP (the customer never sees this). Be extremely concise and glanceable.
Infer the customer's likely industry/vertical and the pains typical of that buyer. Read the tone and intent of the latest customer message.
Respond ONLY with compact JSON, no prose, in this exact shape:
{"vertical":"<short>","intent":"<short, e.g. comparing options / ready to buy / just researching>","tone":"<short, e.g. skeptical / urgent / friendly>","pains":["<short>","<short>"],"tip":"<one short coaching sentence, the next move>"}`;

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: convo }],
        max_tokens: 220, temperature: 0.3,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    let txt = j.choices?.[0]?.message?.content?.trim() || '';
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a === -1 || b === -1) return null;
    const obj = JSON.parse(txt.slice(a, b + 1));
    obj.ts = Date.now();
    return obj;
  } catch {
    return null;
  }
}
