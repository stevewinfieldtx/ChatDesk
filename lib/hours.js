// Business-hours check per tenant, timezone-aware (no deps; uses Intl).
export function withinBusinessHours(tenant, now = new Date()) {
  const h = tenant.hours || {};
  const tz = h.tz || 'America/Los_Angeles';
  const start = h.start ?? 8;
  const end = h.end ?? 17; // exclusive: end=17 means 5pm itself is after-hours
  const days = h.days || [1, 2, 3, 4, 5]; // 0=Sun..6=Sat

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(now);
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0';
  const wkStr = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0; // some envs render midnight as 24
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = map[wkStr] ?? 0;

  return days.includes(day) && hour >= start && hour < end;
}
