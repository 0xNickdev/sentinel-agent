// Market facts from Dexscreener's public token endpoint (no key, ~300 rpm).
// Gives what RPC alone cannot: where the token trades, how deep the pools
// are in USD, and whether anyone still trades it. This is how a dead rug
// looks different from a quiet launch.
import type { Liquidity, MarketData } from '../types.js';

const ENDPOINT = 'https://api.dexscreener.com/latest/dex/tokens/';

interface DsPair {
  dexId?: string;
  labels?: string[];
  pairCreatedAt?: number;
  priceUsd?: string;
  priceNative?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  priceChange?: { h1?: number; h6?: number; h24?: number };
  baseToken?: { address?: string; name?: string; symbol?: string };
}

export async function fetchMarket(mint: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<MarketData | null> {
  const f = opts.fetch ?? fetch;
  const res = await f(`${ENDPOINT}${mint}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const body = (await res.json()) as { pairs?: DsPair[] | null };
  return marketFromPairs(mint, body.pairs ?? []);
}

/** Pure reducer over Dexscreener pairs, so it can be unit-tested with fixtures. */
/** Third-party text goes through the model later: keep it short and printable, nothing else. */
const clean = (s: string | undefined | null, max = 32): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[^\p{L}\p{N}\p{P}\p{Zs}$]/gu, '').trim().slice(0, max);
  return t.length ? t : null;
};

export function marketFromPairs(mint: string, raw: DsPair[]): MarketData | null {
  const pairs = raw.filter(p => (p.baseToken?.address ?? mint) === mint);
  if (!pairs.length) return null;
  const sum = (sel: (p: DsPair) => number | undefined) => pairs.reduce((s, p) => s + (sel(p) ?? 0), 0);
  const top = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;
  const created = pairs.map(p => p.pairCreatedAt).filter((t): t is number => typeof t === 'number' && t > 0);
  const weightedChange = (key: 'h1' | 'h6' | 'h24') => {
    let w = 0, acc = 0;
    for (const p of pairs) {
      const c = p.priceChange?.[key];
      const l = p.liquidity?.usd ?? 0;
      if (typeof c === 'number' && l > 0) { acc += c * l; w += l; }
    }
    return w > 0 ? Math.round((acc / w) * 100) / 100 : null;
  };
  return {
    source: 'dexscreener',
    symbol: clean(top.baseToken?.symbol, 16),
    name: clean(top.baseToken?.name, 48),
    priceUsd: top.priceUsd ? Number(top.priceUsd) : null,
    priceNative: Number(top.priceNative) > 0 ? Number(top.priceNative) : null,
    liquidityUsd: Math.round(sum(p => p.liquidity?.usd)),
    fdvUsd: top.fdv ?? top.marketCap ?? null,
    volume24hUsd: Math.round(sum(p => p.volume?.h24)),
    txns24h: sum(p => (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0)),
    priceChangePct: { h1: weightedChange('h1'), h6: weightedChange('h6'), h24: weightedChange('h24') },
    pairs: pairs.length,
    topVenue: top.dexId ?? null,
    venues: [...new Set(pairs.map(p => p.dexId).filter((d): d is string => !!d))],
    oldestPairAt: created.length ? Math.floor(Math.min(...created) / 1000) : null,
    onCurve: pairs.every(p => p.dexId === 'pumpfun' || p.dexId === 'moonshot' || p.labels?.includes('bonding-curve')),
  };
}

/** Liquidity as the market sees it; falls back to the RPC-only guess when there is no market data. */
export function liquidityFromMarket(market: MarketData | null, rpcGuess: Liquidity): Liquidity {
  if (!market) return rpcGuess;
  if (market.onCurve) return { kind: 'bonding_curve', lockedPct: 100, quoteReserve: null, curveProgressPct: null, liquidityUsd: market.liquidityUsd, ...(market.topVenue ? { venue: market.topVenue } : {}) };
  return { kind: 'amm', lockedPct: null, quoteReserve: null, liquidityUsd: market.liquidityUsd, ...(market.topVenue ? { venue: market.topVenue } : {}) };
}
