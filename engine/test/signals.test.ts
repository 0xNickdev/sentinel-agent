import { describe, expect, it } from 'vitest';
import { analyze, verdictDigest, type TokenSnapshot } from '../src/index.js';

const SUPPLY = 1_000_000_000;
const w = (i: number) => `wallet${String(i).padStart(3, '0')}`;

function clean(): TokenSnapshot {
  return {
    chain: 'solana', mint: 'MintClean', creator: 'creator', at: 1_700_000_000,
    mintInfo: { decimals: 6, supply: SUPPLY, mintAuthority: null, freezeAuthority: null, metadataMutable: false },
    holders: [
      { owner: 'curveVault', amount: SUPPLY * 0.7, isProgram: true },
      ...Array.from({ length: 30 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.01 - i * 1000, isProgram: false })),
    ],
    trades: Array.from({ length: 30 }, (_, i) => ({ account: w(i), side: 'buy' as const, amount: SUPPLY * 0.01, slot: 100 + i * 5, timestamp: 1_700_000_000 + i * 2 })),
    liquidity: { kind: 'bonding_curve', lockedPct: 100, quoteReserve: 12, curveProgressPct: 30 },
    creatorHistory: { address: 'creator', launched: 3, graduated: 2, rugged: 0, pastTokens: [], socialReusedBy: 0, verifiedHuman: true },
    funders: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [w(i), `cex${i % 7}`])),
    hubs: ['cex0', 'cex1', 'cex2', 'cex3', 'cex4', 'cex5', 'cex6'],
  };
}

describe('analyze — clean token', () => {
  it('finds nothing but the verified-creator note and scores high', () => {
    const e = analyze(clean());
    expect(e.flags.map(f => f.code)).toEqual(['verified_creator']);
    expect(e.baselineScore).toBe(100);
    expect(e.holders.top10Pct).toBeLessThan(11);
    expect(e.snipers.wallets.length).toBe(1);   // only wallet000 is inside the first 3 slots
    expect(e.bundles.groups).toBe(0);
    expect(e.linked.clusters).toEqual([]);      // every shared funder is a hub
  });
});

describe('analyze — textbook rug', () => {
  it('flags creator circle, bundles, snipers and live authorities', () => {
    const s = clean();
    s.mintInfo.mintAuthority = 'creator';
    s.mintInfo.freezeAuthority = 'creator';
    s.creatorHistory = { address: 'creator', launched: 6, graduated: 0, rugged: 4, pastTokens: [], socialReusedBy: 2 };
    // 8 wallets buy in the same slot right at launch, all funded by the creator, holding 24%
    s.trades = [
      { account: 'creator', side: 'buy', amount: SUPPLY * 0.05, slot: 99, timestamp: 1_699_999_999 },
      ...Array.from({ length: 8 }, (_, i) => ({ account: w(i), side: 'buy' as const, amount: SUPPLY * 0.03, slot: 100, timestamp: 1_700_000_000 })),
      { account: 'creator', side: 'sell', amount: SUPPLY * 0.05, slot: 400, timestamp: 1_700_000_100 },
    ];
    s.holders = [
      { owner: 'curveVault', amount: SUPPLY * 0.6, isProgram: true },
      ...Array.from({ length: 8 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.03, isProgram: false })),
    ];
    s.funders = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [w(i), 'creator']));
    const e = analyze(s);
    const codes = e.flags.map(f => f.code);
    expect(codes).toEqual(expect.arrayContaining(['mint_authority_live', 'freeze_authority_live', 'heavy_bundles', 'snipers_holding', 'linked_wallets', 'creator_circle', 'serial_rugger', 'social_reused', 'creator_sold_all']));
    expect(e.linked.linkedToCreatorPct).toBeCloseTo(24, 0);
    expect(e.bundles.largestGroup).toBe(8);
    expect(e.baselineScore).toBe(0);
  });
});

describe('verdictDigest', () => {
  it('is stable across key order and changes with evidence', () => {
    const e = analyze(clean());
    const a = verdictDigest({ chain: 'solana', mint: 'MintClean', at: 1, evidence: e });
    const b = verdictDigest({ mint: 'MintClean', at: 1, chain: 'solana', evidence: JSON.parse(JSON.stringify(e)) });
    expect(a).toBe(b);
    const s = clean(); s.mintInfo.mintAuthority = 'x';
    expect(verdictDigest({ chain: 'solana', mint: 'MintClean', at: 1, evidence: analyze(s) })).not.toBe(a);
  });
});

describe('exchange-funded wallets', () => {
  it('names a known exchange funder, never clusters on it, and keeps unknown shared funders as clusters', () => {
    const s = clean();
    const binance = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'; // Binance 2 in engine/data/exchanges.json
    s.funders[w(0)] = binance; s.funders[w(1)] = binance; s.funders[w(2)] = 'unknownFunder'; s.funders[w(3)] = 'unknownFunder';
    s.hubs = s.hubs.filter(h => h !== 'cex0');
    const e = analyze(s);
    expect(e.linked.exchangeFunded).toEqual(expect.arrayContaining([{ wallet: w(0), exchange: 'Binance' }, { wallet: w(1), exchange: 'Binance' }]));
    expect(e.linked.clusters.map(c => c.funder)).not.toContain(binance);
    expect(e.linked.clusters.some(c => c.funder === 'unknownFunder' && c.wallets.length === 2)).toBe(true);
  });
});

describe('lockers, burns, bundles that hold, dev gone', () => {
  it('counts a bag the creator locked as held, not sold, and notes it', () => {
    const s = clean();
    s.trades = [
      { account: 'creator', side: 'buy', amount: SUPPLY * 0.05, slot: 99, timestamp: 1_699_999_999 },
      ...s.trades,
      { account: 'creator', side: 'sell', amount: SUPPLY * 0.05, slot: 500, timestamp: 1_700_000_200 },   // the transfer into the escrow reads as a sell
    ];
    s.holders.push({ owner: 'streamflowEscrow', amount: SUPPLY * 0.05, isProgram: true, lock: { program: 'Streamflow', lockedBy: ['creator'] } });
    const e = analyze(s);
    expect(e.creator).toMatchObject({ status: 'holding', holdingPct: 5, lockedPct: 5, soldTokens: 0 });
    expect(e.holders).toMatchObject({ lockedPct: 5, creatorLockedPct: 5 });
    expect(e.flags.map(f => f.code)).toEqual(['creator_locked', 'verified_creator']);
    expect(e.baselineScore).toBe(100);
  });

  it("notes supply locked by someone else and the burn on a pump.fun coin", () => {
    const s = clean();
    s.mint = 'So11111111111111111111111111111111111111pump';
    s.mintInfo.supply = SUPPLY * 0.9;
    s.holders.push({ owner: 'jupLockEscrow', amount: SUPPLY * 0.02, isProgram: true, lock: { program: 'Jupiter Lock', lockedBy: ['someoneElse'] } });
    const e = analyze(s);
    expect(e.holders.burnedPct).toBe(10);
    expect(e.holders.creatorLockedPct).toBe(0);
    expect(e.flags.map(f => f.code).sort()).toEqual(['supply_burned', 'supply_locked', 'verified_creator']);
    expect(analyze(clean()).holders.burnedPct).toBeNull();   // not a pump.fun mint: launch supply unknown
  });

  it('keeps a launch bundle that still holds as a note and warns once it sold two thirds', () => {
    const s = clean();
    s.trades = Array.from({ length: 6 }, (_, i) => ({ account: w(i), side: 'buy' as const, amount: SUPPLY * 0.04, slot: 100, timestamp: 1_700_000_000 }));
    s.holders = [{ owner: 'curveVault', amount: SUPPLY * 0.7, isProgram: true }, ...Array.from({ length: 6 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.04, isProgram: false }))];
    s.funders = {};
    const holding = analyze(s);
    expect(holding.bundles).toMatchObject({ wallets: 6, boughtPct: 24, heldPct: 24 });
    expect(holding.flags.find(f => f.code === 'heavy_bundles')).toMatchObject({ severity: 'info' });
    s.holders = [{ owner: 'curveVault', amount: SUPPLY * 0.7, isProgram: true }, ...Array.from({ length: 6 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.01, isProgram: false }))];
    const sold = analyze(s);
    expect(sold.bundles.heldPct).toBe(6);
    expect(sold.flags.find(f => f.code === 'heavy_bundles')).toMatchObject({ severity: 'warn', evidence: { soldPct: 75 } });
  });

  it('marks dev gone when the creator sold out of a grown, spread-out token, and not while it is fresh or concentrated', () => {
    const s = clean();
    s.trades = [
      { account: 'creator', side: 'buy', amount: SUPPLY * 0.05, slot: 99, timestamp: 1_699_999_999 },
      ...s.trades,
      { account: 'creator', side: 'sell', amount: SUPPLY * 0.05, slot: 500, timestamp: 1_700_000_200 },
    ];
    s.liquidity = { kind: 'amm', lockedPct: 100, quoteReserve: 400, venue: 'raydium' };
    s.market = { source: 'dexscreener', symbol: 'X', name: 'X', priceUsd: 0.001, liquidityUsd: 120_000, fdvUsd: 1_000_000, volume24hUsd: 50_000, txns24h: 900, priceChangePct: { h1: 1, h6: 2, h24: 3 }, pairs: 2, topVenue: 'raydium', venues: ['raydium'], oldestPairAt: 1_700_000_000 - 3 * 86_400, onCurve: false };
    const gone = analyze(s);
    expect(gone.flags.map(f => f.code)).toContain('dev_gone');
    expect(gone.flags.map(f => f.code)).toContain('creator_sold_all');
    s.market.oldestPairAt = s.at - 600;   // ten minutes old: too early to call the holders the owners
    expect(analyze(s).flags.map(f => f.code)).not.toContain('dev_gone');
    s.market.oldestPairAt = 1_700_000_000 - 3 * 86_400;
    s.holders.push({ owner: 'whale', amount: SUPPLY * 0.15, isProgram: false });
    expect(analyze(s).flags.map(f => f.code)).not.toContain('dev_gone');
  });
});

describe('analyze — Concordium ID creator proof', () => {
  const proof = { wallet: 'creator', claims: ['age>=18'], verifiedAt: 1_700_000_100, requestTx: 'aa'.repeat(32), auditTx: 'bb'.repeat(32) };
  it('raises verified_creator with the anchors as evidence when the proof names the creator wallet', () => {
    const s = clean();
    s.creatorHistory = null;
    s.creatorProof = proof;
    const e = analyze(s);
    expect(e.creator.proof).toEqual(proof);
    const f = e.flags.find(x => x.code === 'verified_creator');
    expect(f?.severity).toBe('info');
    expect(f?.evidence.auditTx).toBe(proof.auditTx);
  });
  it('ignores a proof bound to another wallet', () => {
    const s = clean();
    s.creatorHistory = null;
    s.creatorProof = { ...proof, wallet: 'someoneElse' };
    const e = analyze(s);
    expect(e.creator.proof).toBeUndefined();
    expect(e.flags.some(x => x.code === 'verified_creator')).toBe(false);
  });
});
