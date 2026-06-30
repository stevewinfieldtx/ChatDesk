// AI fallback reply via OpenRouter. Falls back to a safe canned line with no key.
export async function generateReply(tenant, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  const fallback = tenant.ai?.fallbackMessage || 'Thanks for reaching out. Our team will follow up shortly.';
  if (!key) return fallback;

  const sys = tenant.ai?.persona || 'You are a helpful website assistant. Be concise and honest.';
  const body = {
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
    messages: [
      { role: 'system', content: sys },
      ...messages.slice(-12).map(m => ({
        role: m.from === 'visitor' ? 'user' : 'assistant',
        content: m.text,
      })),
    ],
    max_tokens: 350,
    temperature: 0.4,
  };
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return fallback;
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}
