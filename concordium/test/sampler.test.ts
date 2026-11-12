import { describe, expect, it } from 'vitest';
import type { MarketData } from '@sentinel/engine';
import { LaunchSampler, VerdictService, type StoredVerdict } from '../src/index.js';

// A token with buyers' money in it: an AMM pool reads straight from liquidityUsd.
const staked = { priceUsd: 0.001, txns24h: 40, liquidityUsd: 20_000, onCurve: false } as MarketData;
// A pump.fun curve back at its floor: a price, trades, and nothing left to lose.
const empty = { priceUsd: 0.0000023, priceNative: 30 / 1_073_000_000, txns24h: 12, liquidityUsd: 0, onCurve: true, topVenue: 'pumpfun' } as MarketData;

describe('launch sampler', () => {
  it('draws only launches 5-30 minutes old, judges each once, and respects the daily cap', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    const now = 1_800_000_000;
    const launch = (mint: string, age: number) => ({ mint, creator: 'c', name: mint, symbol: mint.slice(0, 3), signature: 's', slot: 1, at: now - age });
    const ring = [launch('A'.repeat(32), 60), launch('B'.repeat(32), 600), launch('C'.repeat(32), 900), launch('D'.repeat(32), 3600)];
    (service as unknown as { launches: () => unknown[] }).launches = () => ring;
    const judged: string[] = [];
    (service as unknown as { verdict: (m: string) => Promise<unknown> }).verdict = async (m: string) => { judged.push(m); return { verdict: 'DANGER', riskScore: 80 }; };
    const s = new LaunchSampler({ service, everyMin: 30, perDay: 2, survivorShare: 0, now: () => now, random: () => 0, fetchMarket: async () => staked });
    expect(s.candidates().map(l => l.mint[0])).toEqual(['B', 'C']);   // A too young, D too old
    expect(await s.tick()).toBe('B'.repeat(32));
    expect(s.candidates().map(l => l.mint[0])).toEqual(['C']);        // B is not drawn twice
    expect(await s.tick()).toBe('C'.repeat(32));
    ring.push(launch('E'.repeat(32), 400));
    expect(await s.tick()).toBeNull();                                 // daily cap of 2 reached
    expect(judged).toHaveLength(2);
  });

  it('keeps launches that already left the 50-slot ring, so a busy feed still yields 5-30 minute old candidates', () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    let now = 1_800_000_000;
    let ring: Array<{ mint: string; creator: string; name: string; symbol: string; signature: string; slot: number; at: number }> = [];
    (service as unknown as { launches: () => unknown[] }).launches = () => ring;
    const s = new LaunchSampler({ service, everyMin: 30, now: () => now });
    for (let i = 0; i < 600; i++) {            // one launch a second for ten minutes; the ring keeps 50
      ring = [{ mint: `M${String(i).padStart(31, '0')}`, creator: 'c', name: 'x', symbol: 'X', signature: 's', slot: i, at: now }, ...ring].slice(0, 50);
      if (i % 10 === 0) s.observe(now);
      now++;
    }
    expect(s.candidates(now).length).toBeGreaterThan(20);
    now += 3600;
    expect(s.candidates(now)).toHaveLength(0);  // everything aged out
  });

  it('judges survivors again: graded alive, still trading, past the gap, under the per-token cap', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    const now = 1_800_000_000;
    const v = (mint: string, ageH: number, outcome: boolean | null): StoredVerdict => ({ mint, verdict: 'CAUTION', riskScore: 40, stored: { at: now - ageH * 3600, auditSeq: null, auditExplorer: null }, attestation: { digest: `${mint}-${ageH}` }, outcomes: outcome == null ? [] : [{ horizon: 3600, at: now, rule: 2, labels: [], rugged: outcome, liquidityBps: null, priceBps: null, concordiumTx: null }] }) as unknown as StoredVerdict;
    const all = [v('alive', 3, false), v('dead', 3, true), v('ungraded', 3, null), v('recent', 0.5, false), v('delisted', 3, false), v('capped', 30, false), v('capped', 20, false), v('capped', 3, false)];
    (service as unknown as { all: () => StoredVerdict[] }).all = () => all;
    (service as unknown as { launches: () => unknown[] }).launches = () => [];
    const judged: string[] = [];
    (service as unknown as { verdict: (m: string) => Promise<unknown> }).verdict = async (m: string) => { judged.push(m); return { verdict: 'SAFE', riskScore: 30 }; };
    const market = (mint: string): MarketData | null => (mint === 'delisted' ? null : staked);
    // draws: take the survivor branch, pick the last of the pool (the delisted one, found dead), then the first (alive)
    const draws = [0.4, 0.99, 0];
    const s = new LaunchSampler({ service, everyMin: 30, now: () => now, random: () => draws.shift() ?? 0, fetchMarket: async m => market(m) });
    expect(s.survivors().map(x => x.mint)).toEqual(['alive', 'delisted']);
    expect(await s.tick()).toBe('alive');
    expect(judged).toEqual(['alive']);                           // the delisted one is never judged
    expect(s.survivors().map(x => x.mint)).toEqual(['alive']);   // and is not looked at again
    // with no survivors the draw falls back to launches (none here)
    const none = new LaunchSampler({ service: Object.assign(service, { all: () => [] }), everyMin: 30, now: () => now, random: () => 0 });
    expect(await none.tick()).toBeNull();
  });

  it('judges only launches that still have buyers\' money in them, and spends nothing when none do', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    const now = 1_800_000_000;
    const launch = (mint: string) => ({ mint, creator: 'c', name: mint, symbol: mint.slice(0, 3), signature: 's', slot: 1, at: now - 600 });
    const ring = [launch('A'.repeat(32)), launch('B'.repeat(32)), launch('C'.repeat(32))];
    (service as unknown as { launches: () => unknown[] }).launches = () => ring;
    const judged: string[] = [];
    (service as unknown as { verdict: (m: string) => Promise<unknown> }).verdict = async (m: string) => { judged.push(m); return { verdict: 'DANGER', riskScore: 80 }; };
    const read: string[] = [];
    const market = async (m: string) => { read.push(m[0]!); return m[0] === 'C' ? staked : m[0] === 'B' ? null : empty; };
    const s = new LaunchSampler({ service, everyMin: 30, survivorShare: 0, now: () => now, random: () => 0, fetchMarket: market });
    expect(await s.tick()).toBe('C'.repeat(32));     // A is at the floor, B is not listed, C has a pool
    expect(read).toEqual(['A', 'B', 'C']);
    expect(await s.tick()).toBeNull();               // nothing left with a stake
    expect(read).toEqual(['A', 'B', 'C']);           // and the empty ones are not read twice
    expect(judged).toEqual(['C'.repeat(32)]);
  });
});
