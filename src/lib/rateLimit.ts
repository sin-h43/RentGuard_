// Tiny in-memory limiter for login attempts (per key, sliding window).
// For multiple server instances use a shared store such as Redis instead.
const hits = new Map<string, number[]>();

export function tooMany(key: string, max = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return recent.length > max;
}

export function resetLimit(key: string) {
  hits.delete(key);
}
