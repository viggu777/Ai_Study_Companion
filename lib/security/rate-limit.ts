import { NextResponse } from "next/server";

/**
 * Minimal in-memory fixed-window rate limiter for AI-heavy endpoints.
 *
 * Prototype scope: single Node instance. On multi-instance deploys (Vercel)
 * each instance tracks its own counters, so this is a cost guard, not a
 * security boundary. Service-layer ownership checks remain authoritative.
 */

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    buckets.set(key, hits);
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  buckets.set(key, hits);
  // Bound memory: drop keys that went quiet (checked lazily on access)
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || v[v.length - 1] <= cutoff) buckets.delete(k);
      if (buckets.size <= 5000) break;
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function rateLimitedResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: `Rate limit exceeded — retry in ${retryAfterSec}s` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}
