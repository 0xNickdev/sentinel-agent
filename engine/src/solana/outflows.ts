// Where the money went. After a traced wallet's last sell, read the plain SOL
// transfers out of it (Helius Enhanced Transactions API: parsed native
// transfers, filtered by type and time, so a busy wallet costs no more than a
// quiet one), follow the largest nameless destination up to three hops, and
// name each stop: an exchange, the wallet that funded the creator, the creator
// itself, a hub several traced wallets paid into, or a wallet with no record.
// Ported from aiagentzoo X-Ray (apps/node/src/chain/outflows.ts), reshaped
// into linear trails so the audit record can show "creator → 12.4 SOL → Binance".
// Transfers, never owners: a trail says where SOL landed, not who holds the key.

import type { FlowHop, FlowKind, FlowTrail, FlowsSummary } from '../types.js';
import { exchangeOf } from './exchanges.js';

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const FLOW_DEFAULTS = {
  /** how long after the last sell a transfer out still counts as this token's proceeds moving on */
  windowSec: 24 * 3600,
  /** below this a transfer is rent, a tip or spam, not proceeds */
  minSol: 0.1,
  /** a nameless destination holding at least this much is followed another hop */
  hopAgainSol: 0.5,
  maxHops: 3,
  /** destinations per traced wallet that become trails (largest first) */
  maxTrailsPerWallet: 4,
  /** Helius enhanced calls in flight at once, and the pause between calls */
  concurrency: 2,
  pauseMs: 150,
  pageLimit: 100,
  maxPages: 3,
  timeoutMs: 8_000,
} as const;

export interface TraceWallet {
  wallet: string;
  /** unix seconds of the wallet's last sell: the window opens here */
  since: number;
}

export interface OutflowOptions {
  /** Helius API key; read from SOLANA_RPC_URL (`api-key=`) by the adapter, never logged */
  apiKey: string;
  /** the token creator (kind "dev") and the wallet that funded them (kind "funder") */
  creator?: string | null;
  creatorFunder?: string | null;
  /** names for known shared wallets beyond engine/data/exchanges.json */
  labels?: Record<string, string>;
  /** unix seconds; windows never extend past it */
  now?: number;
  fetch?: typeof fetch;
  windowSec?: number;
  minSol?: number;
  hopAgainSol?: number;
  maxHops?: number;
  maxTrailsPerWallet?: number;
  concurrency?: number;
  pauseMs?: number;
  log?: (msg: string) => void;
}

interface EnhancedTx {
  signature?: string;
  timestamp?: number;
  type?: string;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
}

/** The Helius API key inside an RPC URL, if any: `https://mainnet.helius-rpc.com/?api-key=…`. */
export function heliusKeyFrom(rpcUrl: string | undefined | null): string | null {
  if (!rpcUrl) return null;
  try {
    const u = new URL(rpcUrl);
    if (!u.hostname.includes('helius')) return null;
    return u.searchParams.get('api-key') || null;
  } catch { return null; }
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// Small pacing gate: at most `n` calls in flight, a pause after each one.
function gate(n: number, pauseMs: number) {
  let inFlight = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => (inFlight < n ? (inFlight++, Promise.resolve()) : new Promise<void>(ok => waiting.push(() => { inFlight++; ok(); })));
  const release = async () => { if (pauseMs) await new Promise(r => setTimeout(r, pauseMs)); inFlight--; waiting.shift()?.(); };
  return { acquire, release };
}

/** SOL that left `wallet` by plain transfer inside [from, to] (unix s), summed per destination, oldest-first pages. */
async function sentBy(wallet: string, from: number, to: number, o: Required<Pick<OutflowOptions, 'apiKey' | 'minSol'>> & { f: typeof fetch; g: ReturnType<typeof gate> }): Promise<Map<string, { lamports: number; at: number }>> {
  const out = new Map<string, { lamports: number; at: number }>();
  let after: string | undefined;
  for (let page = 0; page < FLOW_DEFAULTS.maxPages; page++) {
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${o.apiKey}&limit=${FLOW_DEFAULTS.pageLimit}&type=TRANSFER&sort-order=asc&gte-time=${from}&lte-time=${to}${after ? `&after-signature=${after}` : ''}`;
    await o.g.acquire();
    let body: unknown;
    try {
      const res = await o.f(url, { signal: AbortSignal.timeout(FLOW_DEFAULTS.timeoutMs), headers: { accept: 'application/json' } });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 500 * (page + 1))); page--; continue; }
      if (!res.ok) throw new Error(`helius ${res.status}`);
      body = await res.json();
    } finally { await o.g.release(); }
    if (!Array.isArray(body)) break;
    const txs = body as EnhancedTx[];
    for (const tx of txs) {
      const at = tx.timestamp ?? 0;
      if (at < from || at > to) continue;
      for (const t of tx.nativeTransfers ?? []) {
        if (t.fromUserAccount !== wallet || !t.toUserAccount || t.toUserAccount === wallet) continue;
        const lamports = t.amount ?? 0;
        if (lamports / LAMPORTS_PER_SOL < o.minSol) continue;
        const prev = out.get(t.toUserAccount) ?? { lamports: 0, at };
        out.set(t.toUserAccount, { lamports: prev.lamports + lamports, at: Math.min(prev.at, at) });
      }
    }
    // Helius filters after reading a page, so a nearly full page may still have more behind it.
    if (txs.length < FLOW_DEFAULTS.pageLimit * 0.9) break;
    after = txs[txs.length - 1]?.signature;
    if (!after) break;
  }
  return out;
}

/**
 * Trace SOL out of `wallets` (creator first) after each one's last sell. Deterministic for a
 * given set of Helius responses: destinations are visited largest-first, ties broken by address.
 */
export async function traceOutflows(wallets: TraceWallet[], opts: OutflowOptions): Promise<FlowTrail[]> {
  if (!opts.apiKey || !wallets.length) return [];
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const windowSec = opts.windowSec ?? FLOW_DEFAULTS.windowSec;
  const minSol = opts.minSol ?? FLOW_DEFAULTS.minSol;
  const hopAgainSol = opts.hopAgainSol ?? FLOW_DEFAULTS.hopAgainSol;
  const maxHops = opts.maxHops ?? FLOW_DEFAULTS.maxHops;
  const perWallet = opts.maxTrailsPerWallet ?? FLOW_DEFAULTS.maxTrailsPerWallet;
  const g = gate(opts.concurrency ?? FLOW_DEFAULTS.concurrency, opts.pauseMs ?? FLOW_DEFAULTS.pauseMs);
  const ctx = { apiKey: opts.apiKey, minSol, f, g };
  const traced = new Set(wallets.map(w => w.wallet));

  // hop 1: everything each traced wallet sent on inside its window
  const first = await Promise.all(wallets.map(async w => {
    const to = Math.min(now, w.since + windowSec);
    if (to <= w.since) return new Map<string, { lamports: number; at: number }>();
    try { return await sentBy(w.wallet, w.since, to, ctx); }
    catch (e) { opts.log?.(`flows: ${w.wallet.slice(0, 4)}… ${e instanceof Error ? e.message : e}`); return new Map<string, { lamports: number; at: number }>(); }
  }));

  // a destination several traced wallets paid into is a hub (an operator's collector, or a shared service)
  const receivers = new Map<string, number>();
  for (const out of first) for (const to of out.keys()) receivers.set(to, (receivers.get(to) ?? 0) + 1);

  const classify = (to: string): { kind: FlowKind; label?: string } => {
    const name = opts.labels?.[to] ?? exchangeOf(to);
    if (name) return { kind: 'exchange', label: name };
    if (opts.creator && to === opts.creator) return { kind: 'dev' };
    if (opts.creatorFunder && to === opts.creatorFunder) return { kind: 'funder' };
    if ((receivers.get(to) ?? 0) >= 2) return { kind: 'hub' };
    return { kind: 'wallet' };
  };

  const trails: FlowTrail[] = [];
  for (const [i, w] of wallets.entries()) {
    const dests = [...first[i]!.entries()]
      .filter(([to]) => !traced.has(to)) // money moved between the traced wallets themselves is not money gone
      .sort((a, b) => b[1].lamports - a[1].lamports || a[0].localeCompare(b[0]))
      .slice(0, perWallet);
    for (const [to, o] of dests) {
      const hop: FlowHop = { to, lamports: o.lamports, at: o.at, ...classify(to) };
      trails.push({ from: w.wallet, hops: [hop], totalSol: round(o.lamports / LAMPORTS_PER_SOL), endsAt: hop.kind });
    }
  }

  // hops 2..maxHops: a nameless wallet or hub that holds enough is followed to where it sent the most SOL on
  for (let depth = 1; depth < maxHops; depth++) {
    const open = trails.filter(t => t.hops.length === depth && (t.hops[depth - 1]!.kind === 'wallet' || t.hops[depth - 1]!.kind === 'hub') && t.hops[depth - 1]!.lamports / LAMPORTS_PER_SOL >= hopAgainSol);
    if (!open.length) break;
    await Promise.all(open.map(async t => {
      const last = t.hops[depth - 1]!;
      const behind = new Set([t.from, ...t.hops.map(h => h.to)]);
      let out: Map<string, { lamports: number; at: number }>;
      try { out = await sentBy(last.to, last.at, Math.min(now, last.at + windowSec), ctx); }
      catch (e) { opts.log?.(`flows: hop ${last.to.slice(0, 4)}… ${e instanceof Error ? e.message : e}`); return; }
      const next = [...out.entries()].filter(([to]) => !behind.has(to)).sort((a, b) => b[1].lamports - a[1].lamports || a[0].localeCompare(b[0]))[0];
      if (!next) return;
      const [to, o] = next;
      const hop: FlowHop = { to, lamports: o.lamports, at: o.at, ...classify(to) };
      t.hops.push(hop);
      t.endsAt = hop.kind;
    }));
  }
  return trails.sort((a, b) => b.totalSol - a.totalSol || a.from.localeCompare(b.from) || a.hops[0]!.to.localeCompare(b.hops[0]!.to));
}

/** Pure reducer over trails for the evidence record; `traced` = wallets whose outflows were read. */
export function summarizeFlows(trails: FlowTrail[], traced: number, window: { from: number; to: number }): FlowsSummary {
  const sum = (pred: (t: FlowTrail) => boolean) => round(trails.filter(pred).reduce((s, t) => s + t.totalSol, 0));
  return {
    trails,
    toExchangeSol: sum(t => t.endsAt === 'exchange'),
    toFunderSol: sum(t => t.hops.some(h => h.kind === 'funder')),
    // wallets that go on to fund other creators need the creator-history index; nothing is counted until it exists
    recycledSol: 0,
    traced,
    window,
  };
}
