import { describe, expect, it } from 'vitest';
import { analyze, liquidityFromMarket, marketFromPairs, type TokenSnapshot } from '../src/index.js';

const mint = 'MintX';
const pair = (o: Record<string, unknown>) => ({ baseToken: { address: mint, symbol: 'X', name: 'X' }, dexId: 'raydium', pairCreatedAt: 1_700_000_000_000, ...o });

describe('marketFromPairs', () => {
  it('sums liquidity and volume, weights price change by liquidity, finds the top venue', () => {
    const m = marketFromPairs(mint, [
      pair({ liquidity: { usd: 1000 }, volume: { h24: 10 }, priceChange: { h24: -10 }, fdv: 50_000, priceUsd: '1' }),
      pair({ dexId: 'meteora', liquidity: { usd: 3000 }, volume: { h24: 30 }, priceChange: { h24: -50 }, txns: { h24: { buys: 2, sells: 3 } } }),
      { baseToken: { address: 'Other' }, liquidity: { usd: 999_999 } },
    ])!;
    expect(m.liquidityUsd).toBe(4000);
    expect(m.volume24hUsd).toBe(40);
    expect(m.priceChangePct.h24).toBe(-40);
    expect(m.topVenue).toBe('meteora');
    expect(m.venues.sort()).toEqual(['meteora', 'raydium']);
    expect(m.txns24h).toBe(5);
    expect(m.oldestPairAt).toBe(1_700_000_000);
    expect(m.onCurve).toBe(false);
  });
  it('returns null with no pairs and recognises a pump.fun curve', () => {
    expect(marketFromPairs(mint, [])).toBeNull();
    const m = marketFromPairs(mint, [pair({ dexId: 'pumpfun', liquidity: { usd: 5000 } })])!;
    expect(m.onCurve).toBe(true);
    expect(liquidityFromMarket(m, { kind: 'unknown', lockedPct: null, quoteReserve: null })).toMatchObject({ kind: 'bonding_curve', lockedPct: 100, liquidityUsd: 5000, venue: 'pumpfun' });
    expect(liquidityFromMarket(null, { kind: 'unknown', lockedPct: null, quoteReserve: null }).kind).toBe('unknown');
  });
});

describe('market flags', () => {
  const base = (): TokenSnapshot => ({
    chain: 'solana', mint, creator: null, at: 1_700_000_000 + 30 * 86_400,
    mintInfo: { decimals: 6, supply: 1_000_000, mintAuthority: null, freezeAuthority: null },
    holders: [], trades: [], liquidity: { kind: 'amm', lockedPct: null, quoteReserve: null }, creatorHistory: null, funders: {}, hubs: [],
  });
  it('a drained pool on a big market cap is critical; a dead pair is a warning', () => {
    const s = base();
    s.market = marketFromPairs(mint, [pair({ liquidity: { usd: 4_600 }, fdv: 2_600_000, volume: { h24: 150 }, priceChange: { h24: -9 } })]);
    const codes = analyze(s).flags.map(f => f.code);
    expect(codes).toContain('liquidity_drained');
    expect(codes).toContain('volume_dead');
    expect(codes).not.toContain('thin_liquidity');
  });
  it('deep liquidity on a large token raises nothing', () => {
    const s = base();
    s.market = marketFromPairs(mint, [pair({ liquidity: { usd: 1_100_000 }, fdv: 260_000_000, volume: { h24: 1_400_000 }, priceChange: { h24: -4 } })]);
    expect(analyze(s).flags).toEqual([]);
  });
  it('a young thin pool is only thin, not drained', () => {
    const s = base();
    s.at = 1_700_000_000 + 3600;
    s.market = marketFromPairs(mint, [pair({ liquidity: { usd: 5_000 }, fdv: 60_000, volume: { h24: 20_000 }, priceChange: { h24: -70 } })]);
    const codes = analyze(s).flags.map(f => f.code);
    expect(codes).toEqual(['thin_liquidity', 'price_collapse']);
  });
});
