// Sentinel Guard: one call between a trading agent and a buy.
//
//   const guard = createGuard({ pay });             // pay = any x402-paying fetch (see ./concordium)
//   const d = await guard.check(mint);              // { action: 'allow' | 'warn' | 'block', reason, … }
//   if (d.action === 'block') return;               // or: await guard.wrap(buy, mintOf)(…)
//
// Before trusting an answer the guard checks who gives it: the oracle's Agent Card must carry a
// Verified by Concordium badge that the Concordium Agent Registry confirms (owner, status, card hash),
// and the card must be the one served by the gateway being called. Then it screens the token for free,
// blocks on hard red flags without paying, and only pays for the full swarm verdict when the screen
// alone cannot clear the trade. It fails closed: anything unexpected is a block, never an allow.

export type Action = 'allow' | 'warn' | 'block';
export type Band = 'SAFE' | 'CAUTION' | 'DANGER' | 'RUGGED';

export interface Decision {
  action: Action;
  mint: string;
  /** one line a human or a log can act on */
  reason: string;
  /** what the decision rests on */
  source: 'quick' | 'full' | 'recent-full' | 'oracle' | 'mandate' | 'error';
  verdict: Band | null;
  riskScore: number | null;
  confidence: number | null;
  vetoes: string[];
  headline: string | null;
  /** the verdict's audit record: digest, Concordium transaction, public page */
  audit: { digest: string; concordiumTx: string | null; url: string } | null;
  /** x402 settlement transaction when this check paid for a verdict */
  paidTx: string | null;
  oracle: { badge: string | null; verified: boolean; owner: string | null };
  /** set when this check paid for a verdict the gateway's guarantee covers: refunded automatically if the token rugs */
  guarantee: { statement: string; horizonSec: number } | null;
  at: number;
}

export interface Policy {
  /** bands that always block */
  block: Band[];
  /** a full SAFE verdict needs at least this confidence to allow */
  minConfidence: number;
  /** and at most this risk score */
  maxRisk: number;
  /** what a clean free screen alone yields (it never reads snipers, funding or the creator) */
  quickSafe: 'warn' | 'allow';
  /** reuse a full verdict someone already paid for if it is younger than this (seconds); 0 disables */
  reuseFullSec: number;
}

/**
 * Spending limits enforced in code, outside the model: a prompt can be talked out of a limit, this cannot.
 * Amounts are in whatever unit the wrapped buy uses (SOL, USDC…), as long as it is the same everywhere.
 */
export interface Mandate {
  /** largest single buy */
  maxPerTrade?: number;
  /** total bought per rolling 24 h */
  maxPerDay?: number;
  /** only buy on a full verdict in these bands (default: whatever the policy allows) */
  onlyBands?: Band[];
  /** the mandate stops working after this time (unix seconds) */
  expiresAt?: number;
}

export const DEFAULT_POLICY: Policy = { block: ['DANGER', 'RUGGED'], minConfidence: 0.6, maxRisk: 40, quickSafe: 'warn', reuseFullSec: 3600 };

export interface GuardOptions {
  /** Sentinel gateway (default https://api.sentinelagent.pro) */
  gateway?: string;
  /** Concordium network the badge is checked on (default testnet) */
  network?: 'testnet' | 'mainnet';
  /** an x402-paying fetch; without it the guard only uses the free screen and never allows on it alone unless policy.quickSafe is 'allow' */
  pay?: typeof fetch;
  /** refuse to pay above this price in CCD (sent as X-Max-Price-CCD; the gateway answers 412 and charges nothing) */
  maxPriceCcd?: number;
  /** check the oracle's Verified by Concordium badge before trusting it (default true) */
  requireBadge?: boolean;
  policy?: Partial<Policy>;
  /** spending limits for wrap(); a buy over a limit is blocked before any check is paid for */
  mandate?: Mandate;
  /** plain fetch for free calls (default globalThis.fetch) */
  fetch?: typeof fetch;
  registryUrl?: string;
  siteUrl?: string;
  /** how long a decision is reused for the same mint, ms (default 60 s) */
  cacheMs?: number;
  /** timeout for the paid verdict, ms (default 8 min: the swarm reads the chain from scratch on old tokens) */
  verdictTimeoutMs?: number;
}

export interface CheckOptions {
  /** 'quick' never pays; 'full' always pays; 'auto' (default) pays only when the free screen cannot decide */
  mode?: 'auto' | 'quick' | 'full';
  /** idempotency key for the paid call; a retry with the same key is never charged twice */
  idempotencyKey?: string;
}

export interface WrapOptions<A extends unknown[]> extends CheckOptions {
  /** decide on a warn: true buys anyway (default: proceed) */
  onWarn?: (d: Decision) => boolean | Promise<boolean>;
  /** the size of this buy, for the mandate's limits */
  amountOf?: (...args: A) => number;
}

export class GuardBlockedError extends Error {
  constructor(readonly decision: Decision) { super(`Sentinel Guard blocked ${decision.mint}: ${decision.reason}`); this.name = 'GuardBlockedError'; }
}

export interface Guard {
  check(mint: string, opts?: CheckOptions): Promise<Decision>;
  /** the oracle's badge status, checked once and cached for 10 minutes */
  oracle(): Promise<Decision['oracle'] & { issues: string[] }>;
  /** wrap a buy: blocks throw GuardBlockedError, warns go to onWarn (default: proceed) */
  wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>, mintOf: (...args: A) => string, opts?: WrapOptions<A>): (...args: A) => Promise<R>;
  /** what the mandate has left to spend in the current 24 h window */
  spent(): { last24h: number; remaining: number | null };
  readonly policy: Policy;
}

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BANDS: readonly string[] = ['SAFE', 'CAUTION', 'DANGER', 'RUGGED'];
const isBand = (b: unknown): b is Band => typeof b === 'string' && BANDS.includes(b);

interface Quick { verdict: string; riskScore: number; vetoes?: string[]; flags?: Array<{ code: string; severity: string; message: string }>; notChecked?: string[]; market?: { symbol: string | null } | null; full?: { verdict: string; riskScore: number; at: number; digest: string; concordiumTx: string | null } | null }
interface Full { verdict: string; riskScore: number; confidence: number; headline?: string; decisive?: string; topReasons?: string[]; attestation?: { digest: string; concordiumTx: string | null } }

export function createGuard(o: GuardOptions = {}): Guard {
  const gateway = (o.gateway ?? 'https://api.sentinelagent.pro').replace(/\/$/, '');
  const network = o.network ?? 'testnet';
  const registry = (o.registryUrl ?? 'https://agent-registry-mcp.concordium.com/v1').replace(/\/$/, '');
  const site = (o.siteUrl ?? 'https://sentinelagent.pro').replace(/\/$/, '');
  const http = o.fetch ?? globalThis.fetch;
  const policy: Policy = { ...DEFAULT_POLICY, ...o.policy };
  const cacheMs = o.cacheMs ?? 60_000;
  const cache = new Map<string, { d: Decision; until: number }>();
  let oracleCache: { v: Awaited<ReturnType<Guard['oracle']>>; until: number } | null = null;

  async function json<T>(url: string, init?: RequestInit, f: typeof fetch = http, timeoutMs = 20_000): Promise<{ status: number; body: T; headers: Headers }> {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 200) }; }
    return { status: res.status, body: body as T, headers: res.headers };
  }

  async function oracle(): Promise<Decision['oracle'] & { issues: string[] }> {
    if (oracleCache && oracleCache.until > Date.now()) return oracleCache.v;
    const issues: string[] = [];
    let badge: string | null = null, owner: string | null = null, verified = false;
    try {
      const card = (await json<{ capabilities?: { extensions?: Array<{ uri: string; params?: Record<string, unknown> }> } }>(`${gateway}/.well-known/agent-card.json`)).body;
      const ext = card?.capabilities?.extensions?.find(e => e.uri.includes('concordium-badge'));
      // The card carries a CAIP-19 id (ccd:<genesis>/cis-2:<token address>); the registry takes the bare address.
      badge = String(ext?.params?.tokenAddress ?? '').split(':').pop() || null;
      if (!badge) issues.push('agent card has no Verified by Concordium badge');
      else {
        const r = (await json<{ badge_valid?: boolean; issues?: unknown[]; agent_uri?: string; on_chain?: { owner_account?: string } }>(`${registry}/check-badge/${encodeURIComponent(badge)}?network=${network}`)).body;
        owner = r?.on_chain?.owner_account ?? null;
        if (!r?.badge_valid) issues.push(`registry does not confirm badge ${badge}${r?.issues?.length ? `: ${JSON.stringify(r.issues)}` : ''}`);
        // A valid badge only vouches for the card at its registered URI. Make sure that is the gateway we are about to pay.
        else if (!r.agent_uri || new URL(r.agent_uri).origin !== new URL(gateway).origin) issues.push(`badge ${badge} belongs to ${r.agent_uri ?? 'another agent'}, not ${gateway}`);
        else verified = true;
      }
    } catch (e) { issues.push(`badge check failed: ${e instanceof Error ? e.message : String(e)}`); }
    const v = { badge, verified, owner, issues };
    // Cache failures briefly so a registry hiccup does not pin every trade to 'block' for ten minutes.
    oracleCache = { v, until: Date.now() + (verified ? 600_000 : 30_000) };
    return v;
  }

  const base = (mint: string, or: Decision['oracle']): Decision => ({ action: 'block', mint, reason: '', source: 'error', verdict: null, riskScore: null, confidence: null, vetoes: [], headline: null, audit: null, paidTx: null, oracle: or, guarantee: null, at: Math.floor(Date.now() / 1000) });
  const auditOf = (a?: { digest: string; concordiumTx: string | null } | null) => (a?.digest ? { digest: a.digest, concordiumTx: a.concordiumTx ?? null, url: `${site}/audit/${a.digest}` } : null);

  function fromFull(d: Decision, v: Full, source: Decision['source']): Decision {
    const band = isBand(v.verdict) ? v.verdict : null;
    const out: Decision = { ...d, source, verdict: band, riskScore: v.riskScore, confidence: v.confidence ?? null, headline: v.headline ?? null, audit: auditOf(v.attestation) };
    const why = v.decisive ?? v.topReasons?.[0] ?? v.headline ?? '';
    if (!band) return { ...out, action: 'block', reason: `unreadable verdict ${JSON.stringify(v.verdict)}` };
    if (policy.block.includes(band)) return { ...out, action: 'block', reason: `${band} · risk ${v.riskScore}${why ? ` · ${why}` : ''}` };
    if (band === 'SAFE' && (v.confidence ?? 0) >= policy.minConfidence && v.riskScore <= policy.maxRisk) return { ...out, action: 'allow', reason: `SAFE · risk ${v.riskScore} · confidence ${v.confidence}` };
    return { ...out, action: 'warn', reason: band === 'SAFE' ? `SAFE but below policy (risk ${v.riskScore}, confidence ${v.confidence})` : `${band} · risk ${v.riskScore}${why ? ` · ${why}` : ''}` };
  }

  async function decide(mint: string, opts: CheckOptions): Promise<Decision> {
    const mode = opts.mode ?? 'auto';
    const or = o.requireBadge === false ? { badge: null, verified: false, owner: null, issues: [] } : await oracle();
    const d = base(mint, { badge: or.badge, verified: or.verified, owner: or.owner });
    if (o.requireBadge !== false && !or.verified) return { ...d, source: 'oracle', reason: `oracle not verified: ${or.issues.join('; ')}` };

    // 1. Free screen: authorities, holders, liquidity, market shape. Hard red flags block here without paying.
    let q: Quick | null = null;
    if (mode !== 'full') {
      const r = await json<Quick & { error?: string }>(`${gateway}/quick/${mint}`);
      if (r.status !== 200 || !r.body) return { ...d, reason: `screen failed: HTTP ${r.status} ${r.body?.error ?? ''}`.trim() };
      q = r.body;
      const vetoes = q.vetoes ?? [];
      const top = q.flags?.find(f => f.severity === 'critical' || f.severity === 'high')?.message;
      if (vetoes.length || q.verdict === 'DANGER') return { ...d, source: 'quick', verdict: isBand(q.verdict) ? q.verdict : 'DANGER', riskScore: q.riskScore, vetoes, reason: `DANGER on the free screen · ${vetoes.length ? vetoes.join(', ') : top ?? `risk ${q.riskScore}`}` };
      // 2. Someone already paid for a full verdict on this mint recently: decide on it.
      const f = q.full;
      if (f && policy.reuseFullSec > 0 && Date.now() / 1000 - f.at < policy.reuseFullSec && isBand(f.verdict)) {
        const stored = await json<Full>(`${gateway}/verdicts/${f.digest}`).catch(() => null);
        if (stored?.status === 200 && stored.body?.verdict) return fromFull({ ...d, vetoes }, stored.body, 'recent-full');
      }
      if (mode === 'quick' || !o.pay) {
        const band = isBand(q.verdict) ? q.verdict : 'CAUTION';
        const scr = { ...d, source: 'quick' as const, verdict: band, riskScore: q.riskScore, vetoes };
        const unread = q.notChecked?.length ? ` (not read: ${q.notChecked.slice(0, 3).join(', ')})` : '';
        if (band === 'SAFE') return { ...scr, action: policy.quickSafe, reason: `free screen is clean${unread}; ${o.pay ? 'run a full check before size' : 'no payer configured for the full check'}` };
        return { ...scr, action: 'warn', reason: `${band} on the free screen · risk ${q.riskScore}${top ? ` · ${top}` : ''}` };
      }
    }
    if (!o.pay) return { ...d, reason: 'mode "full" needs a paying fetch (pay option)' };

    // 3. Pay for the full swarm verdict over x402. Idempotent and price-capped, so a retry or a price change never costs twice.
    const headers: Record<string, string> = { 'content-type': 'application/json', 'idempotency-key': opts.idempotencyKey ?? `guard-${mint.slice(0, 16)}-${Date.now().toString(36)}` };
    if (o.maxPriceCcd !== undefined) headers['x-max-price-ccd'] = String(o.maxPriceCcd);
    const r = await json<Full & { error?: string }>(`${gateway}/x402/verdict`, { method: 'POST', headers, body: JSON.stringify({ mint }) }, o.pay, o.verdictTimeoutMs ?? 480_000);
    const paidTx = settlement(r.headers.get('payment-response'));
    if (r.status === 412) return { ...d, paidTx, reason: `verdict price is above your ceiling of ${o.maxPriceCcd} CCD; nothing paid` };
    if (r.status !== 200 || !r.body?.verdict) return { ...d, paidTx, reason: `verdict failed: HTTP ${r.status} ${r.body?.error ?? ''}`.trim() };
    const out: Decision = { ...fromFull(d, r.body, 'full'), paidTx, vetoes: q?.vetoes ?? [] };
    // Is this payment on the gateway's guarantee book? Free to ask; a missing book just means no guarantee.
    if (paidTx && out.audit) {
      const g = await json<{ terms?: { bands: string[]; horizon: number; statement?: string }; buyers?: Array<{ paymentTx: string }> }>(`${gateway}/guarantee/${out.audit.digest}`).catch(() => null);
      const t = g?.status === 200 ? g.body?.terms : undefined;
      if (t && out.verdict && t.bands.includes(out.verdict)) out.guarantee = { statement: t.statement ?? `refunded if it rugs within ${t.horizon}s`, horizonSec: t.horizon };
    }
    return out;
  }

  async function check(mint: string, opts: CheckOptions = {}): Promise<Decision> {
    mint = mint.trim();
    if (!MINT_RE.test(mint)) return { ...base(mint, { badge: null, verified: false, owner: null }), reason: 'not a Solana mint address' };
    const key = `${mint}:${opts.mode ?? 'auto'}`;
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.d;
    let d: Decision;
    try { d = await decide(mint, opts); }
    catch (e) { d = { ...base(mint, { badge: null, verified: false, owner: null }), reason: `guard error, failing closed: ${e instanceof Error ? e.message : String(e)}` }; }
    // Never cache errors: the next attempt should try again.
    if (d.source !== 'error' && d.source !== 'oracle') cache.set(key, { d, until: Date.now() + cacheMs });
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    return d;
  }

  const ledger: Array<{ at: number; amount: number }> = [];
  const m = o.mandate;
  function spent() {
    const cutoff = Date.now() - 86_400_000;
    while (ledger.length && ledger[0]!.at < cutoff) ledger.shift();
    const last24h = ledger.reduce((s, x) => s + x.amount, 0);
    return { last24h, remaining: m?.maxPerDay !== undefined ? Math.max(0, m.maxPerDay - last24h) : null };
  }
  // Limits are checked before the token is, so an over-limit buy never costs a paid verdict.
  function overLimit(amount: number | null): string | null {
    if (!m) return null;
    if (m.expiresAt !== undefined && Date.now() / 1000 > m.expiresAt) return 'mandate expired';
    if (amount === null) return m.maxPerTrade !== undefined || m.maxPerDay !== undefined ? 'mandate has limits but the buy size is unknown (pass amountOf)' : null;
    if (!(amount > 0)) return `invalid buy size ${amount}`;
    if (m.maxPerTrade !== undefined && amount > m.maxPerTrade) return `buy of ${amount} is over the per-trade limit of ${m.maxPerTrade}`;
    const left = spent().remaining;
    if (left !== null && amount > left) return `buy of ${amount} is over what is left today (${left} of ${m.maxPerDay})`;
    return null;
  }

  function wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>, mintOf: (...args: A) => string, opts: WrapOptions<A> = {}) {
    return async (...args: A): Promise<R> => {
      const mint = mintOf(...args);
      const amount = opts.amountOf ? opts.amountOf(...args) : null;
      const limit = overLimit(amount);
      if (limit) throw new GuardBlockedError({ ...base(mint, { badge: null, verified: false, owner: null }), source: 'mandate', reason: limit });
      // Reserve the amount now, so concurrent buys cannot all fit under the same remaining limit; release it on any stop.
      const entry = { at: Date.now(), amount: amount ?? 0 };
      if (amount !== null) ledger.push(entry);
      const release = () => { const i = ledger.indexOf(entry); if (i >= 0) ledger.splice(i, 1); };
      try {
        const d = await check(mint, opts);
        if (d.action === 'block') throw new GuardBlockedError(d);
        if (m?.onlyBands && !(d.verdict && d.source !== 'quick' && m.onlyBands.includes(d.verdict))) throw new GuardBlockedError({ ...d, action: 'block', source: 'mandate', reason: `mandate buys only on a full ${m.onlyBands.join('/')} verdict; got ${d.verdict ?? 'none'} from the ${d.source} check` });
        if (d.action === 'warn' && opts.onWarn && !(await opts.onWarn(d))) throw new GuardBlockedError(d);
        return await fn(...args);
      } catch (e) { release(); throw e; }
    };
  }

  return { check, oracle, wrap, spent, policy };
}

/** The x402 PAYMENT-RESPONSE header is base64 JSON; return its transaction hash. */
export function settlement(header: string | null): string | null {
  if (!header) return null;
  try { return (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { transaction?: string }).transaction ?? null; } catch { return null; }
}

/** One line for logs and chat replies. */
export function describe(d: Decision): string {
  const icon = d.action === 'allow' ? 'ALLOW' : d.action === 'warn' ? 'WARN' : 'BLOCK';
  const tail = [d.guarantee ? `guaranteed: refund if it rugs within ${d.guarantee.horizonSec % 3600 === 0 ? `${d.guarantee.horizonSec / 3600} h` : `${Math.round(d.guarantee.horizonSec / 60)} min`}` : '', d.audit ? `audit ${d.audit.url}` : '', d.oracle.verified ? `oracle verified by Concordium (badge ${d.oracle.badge})` : ''].filter(Boolean).join(' · ');
  return `${icon} ${d.mint.slice(0, 6)}… ${d.reason}${tail ? ` · ${tail}` : ''}`;
}
