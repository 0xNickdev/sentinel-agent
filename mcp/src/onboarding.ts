// What a calling agent needs to pay safely and to find its way in:
//   · Idempotency-Key: a retried paid call returns the verdict already paid for, it is never charged twice.
//   · max price: the agent states the most it will pay; above that the call stops before any payment.
//   · /llms.txt: one plain-text page an agent (or the human wiring it up) reads to use Sentinel correctly.
import type { Context, MiddlewareHandler } from 'hono';
import type { StoredVerdict, VerdictService } from '@sentinel/concordium';

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface Entry { mint: string; digest: string | null; state: 'running' | 'done'; at: number }

/** Keys seen in the last `ttlMs` (default 24 h), bounded in size. In memory: a server restart forgets them. */
export class IdempotencyStore {
  private readonly m = new Map<string, Entry>();
  constructor(private readonly ttlMs = 24 * 3600_000, private readonly max = 20_000, private readonly now: () => number = Date.now) {}
  get(k: string): Entry | null {
    const e = this.m.get(k);
    if (!e) return null;
    if (this.now() - e.at > this.ttlMs || (e.state === 'running' && this.now() - e.at > 10 * 60_000)) { this.m.delete(k); return null; }
    return e;
  }
  begin(k: string, mint: string) {
    if (this.m.size >= this.max) { const oldest = this.m.keys().next().value; if (oldest !== undefined) this.m.delete(oldest); }
    this.m.set(k, { mint, digest: null, state: 'running', at: this.now() });
  }
  finish(k: string, digest: string | null) {
    const e = this.m.get(k);
    if (!e) return;
    if (digest) this.m.set(k, { ...e, digest, state: 'done', at: this.now() });
    else this.m.delete(k); // failed: the agent was not served, a retry must run (and pay) again
  }
}

export interface PaidCallOptions {
  service: VerdictService;
  store: IdempotencyStore;
  /** current price in microCCD, null when the deployment is free */
  priceMicroCcd: string | null;
  /** how a stored verdict is rendered on replay over MCP */
  view: (v: StoredVerdict) => unknown;
}

interface PaidRequest { kind: 'rest' | 'mcp'; mint: string; key: string | null; maxCcd: number | null; rpcId: unknown }

async function readPaid(c: Context): Promise<PaidRequest | null> {
  if (c.req.method !== 'POST') return null;
  const body = await c.req.raw.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return null;
  const header = c.req.header('idempotency-key') ?? null;
  const headerMax = c.req.header('x-max-price-ccd');
  if (c.req.path === '/mcp') {
    const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (body.method !== 'tools/call' || params?.name !== 'sentinel_verdict') return null;
    const a = params.arguments ?? {};
    return { kind: 'mcp', mint: String(a.mint ?? ''), key: (typeof a.idempotency_key === 'string' ? a.idempotency_key : null) ?? header, maxCcd: num(a.max_price_ccd ?? headerMax), rpcId: body.id ?? null };
  }
  return { kind: 'rest', mint: String(body.mint ?? (body.snapshot as { mint?: string } | undefined)?.mint ?? ''), key: header ?? (typeof body.idempotency_key === 'string' ? body.idempotency_key : null), maxCcd: num(body.max_price_ccd ?? headerMax), rpcId: null };
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Runs before the x402 gate on the two paid doors (POST /x402/verdict, MCP tools/call sentinel_verdict). */
export function paidCallGuard(o: PaidCallOptions): MiddlewareHandler {
  return async (c, next) => {
    const r = await readPaid(c);
    if (!r) return next();
    const fail = (status: 400 | 409 | 412, error: string, extra: Record<string, unknown> = {}) =>
      r.kind === 'mcp'
        ? c.json({ jsonrpc: '2.0', id: r.rpcId, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error, ...extra }) }] } }, 200)
        : c.json({ error, ...extra }, status);
    const priceCcd = o.priceMicroCcd ? Number(o.priceMicroCcd) / 1e6 : 0;
    c.header('x-sentinel-price-ccd', String(priceCcd));

    if (r.maxCcd !== null && Number.isNaN(r.maxCcd)) return fail(400, 'max_price_ccd must be a number of CCD');
    if (r.maxCcd !== null && priceCcd > r.maxCcd) return fail(412, 'price_above_max', { price_ccd: priceCcd, max_price_ccd: r.maxCcd, charged: false });
    if (r.key === null) return next();
    if (!KEY_RE.test(r.key)) return fail(400, 'idempotency key must be 8-128 chars of A-Z a-z 0-9 _ . : -');
    c.header('idempotency-key', r.key);

    const seen = o.store.get(r.key);
    if (seen) {
      if (seen.mint !== r.mint) return fail(409, 'idempotency key already used for another mint', { mint: seen.mint });
      if (seen.state === 'running') return fail(409, 'a call with this idempotency key is still running; retry in a few seconds', { charged: false, retry_after_seconds: 10 });
      const v = seen.digest ? o.service.lookup({ digest: seen.digest }) : null;
      if (v) {
        c.header('idempotent-replay', 'true');
        if (r.kind === 'rest') return c.json(v);
        const view = o.view(v);
        return c.json({ jsonrpc: '2.0', id: r.rpcId, result: { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }], structuredContent: view } });
      }
    }
    if (!MINT_RE.test(r.mint)) return next(); // the handler answers the bad mint; nothing to remember
    o.store.begin(r.key, r.mint);
    // A 200 means the verdict served is now the latest one stored for this mint (fresh or the 5-minute cache).
    const settle = () => o.store.finish(r.key!, o.service.lookup({ mint: r.mint })?.attestation.digest ?? null);
    try { await next(); } catch (e) { o.store.finish(r.key, null); throw e; }
    const res = c.res;
    // Only a paid, successful call is remembered. A 402 (no payment yet) or an error leaves the key free.
    if (res.status !== 200) { o.store.finish(r.key, null); return; }
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) { settle(); return; }
    // MCP over SSE: the tool finishes after the headers went out, so record once the stream ends.
    c.res = new Response(res.body.pipeThrough(new TransformStream({ flush: settle })), { status: res.status, headers: res.headers });
  };
}

export interface LlmsOptions { baseUrl: string; siteUrl: string; network: string; priceMicroCcd: string | null; payTo: string | null }

export function llmsTxt(o: LlmsOptions): string {
  const price = o.priceMicroCcd ? `${Number(o.priceMicroCcd) / 1e6} CCD` : 'free';
  return `# Sentinel

> Is this Solana token a rug? A swarm of seven specialist agents and a judge reads on-chain evidence and returns SAFE, CAUTION, DANGER or RUGGED with a risk score, a confidence and the reasons. Every verdict is signed (ML-DSA-65), hashed into an audit contract on Concordium ${o.network} before the outcome is known, and later graded against what the token actually did. The agents are registered in the Concordium Agent Registry with a Verified by Concordium badge.

## Use it in one minute
- MCP (Streamable HTTP, stateless): ${o.baseUrl}/mcp
- A2A v1.0: ${o.baseUrl}/a2a · Agent Card: ${o.baseUrl}/.well-known/agent-card.json
- HTTP: POST ${o.baseUrl}/x402/verdict {"mint":"<mint>"} · price ${price} over x402${o.payTo ? `, paid to ${o.payTo}` : ''}
- Free first look, no models: GET ${o.baseUrl}/quick/<mint>

## Which call to make
1. sentinel_quick (free, about 1 s): authorities, holders, liquidity, market shape. Use it to screen. Its SAFE only means none of those rules fired; it does not read snipers, bundles, funding or the creator.
2. sentinel_verdict (${price}, 20 s to a few minutes): the full swarm. Use it before money moves.
3. sentinel_track (free): how well calibrated the judge has been (Brier, skill vs base rate, per specialist). Read it once per session and weigh Sentinel by it.
4. sentinel_audit (free): any past verdict and its on-chain record.

## Paying safely
- Send an Idempotency-Key header (or idempotency_key argument over MCP), 8-128 chars, unique per decision. A retry with the same key returns the verdict already paid for and is not charged again. The key is bound to one mint for 24 h.
- Send max_price_ccd (body or MCP argument) or an X-Max-Price-CCD header. If the price is higher, the call stops with price_above_max and nothing is charged.
- The paying agent needs CCD only for the price; the facilitator sponsors the transaction fee.

## Reading a verdict
- verdict: SAFE | CAUTION | DANGER | RUGGED. Treat DANGER and RUGGED as a hard stop.
- riskScore 0-100 is read as P(rug) x 100 when the verdict is graded.
- vetoes are deterministic facts (for example a live mint authority) that override the vote.
- attestation.digest is the sha256 anchored on Concordium; attestation.concordiumTx is the transaction.
- Verify offline: public key at ${o.baseUrl}/.well-known/sentinel-keys.json, context sentinel.verdict/1.
- A creator with a Concordium ID proof (verified human, 18+, no personal data) shows the flag verified_creator.

## Prompt for your agent
Before buying or recommending any Solana token, call sentinel_quick with its mint. If it is not SAFE, or before any trade above a trivial size, call sentinel_verdict with an Idempotency-Key and max_price_ccd set. Treat DANGER or RUGGED as a hard stop. Tell the user the verdict, the risk score, the confidence and the top reason, and link the audit record. Never treat sentinel_quick SAFE as clearance for a trade.

## Links
- Docs: ${o.siteUrl}/docs
- Agents and badges: ${o.siteUrl}/agents
- Track record: ${o.siteUrl}/track
- Audit explorer: ${o.siteUrl}/audit
- Verified creators: ${o.siteUrl}/verify
- Source: https://github.com/0xNickdev/sentinel-agent
`;
}
