// Small, dependency-free protections at the HTTP edge. Real deployments put a
// reverse proxy in front as well; this is what the app guarantees on its own.
import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  perMinute: number;
  /** routes that never count (cards, health) */
  skip?: (c: Context) => boolean;
  /** how to identify the client; default: proxy headers, then socket address */
  key?: (c: Context) => string;
  now?: () => number;
}

/** Token bucket per client: `perMinute` requests sustained, same size burst. Memory-bounded by pruning idle clients. */
export function rateLimit(o: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const now = o.now ?? Date.now;
  const refillPerMs = o.perMinute / 60_000;
  const key = o.key ?? clientKey;
  let lastPrune = now();
  return async (c, next) => {
    if (o.skip?.(c)) return next();
    const t = now();
    if (t - lastPrune > 60_000) { for (const [k, b] of buckets) if (t - b.at > 120_000) buckets.delete(k); lastPrune = t; }
    const k = key(c);
    const b = buckets.get(k) ?? { tokens: o.perMinute, at: t };
    b.tokens = Math.min(o.perMinute, b.tokens + (t - b.at) * refillPerMs);
    b.at = t;
    if (b.tokens < 1) {
      buckets.set(k, b);
      const retry = Math.ceil((1 - b.tokens) / refillPerMs / 1000);
      return c.json({ error: 'rate limit exceeded', retryAfterSeconds: retry }, 429, { 'retry-after': String(retry) });
    }
    b.tokens -= 1;
    buckets.set(k, b);
    return next();
  };
}

export function clientKey(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const real = c.req.header('x-real-ip');
  const info = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return fwd || real || info || 'anonymous';
}
