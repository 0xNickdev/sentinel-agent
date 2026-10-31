import { describe, expect, it } from 'vitest';
import { HORIZONS, brier, confusion, gradeOutcome, reliability, trackSummary } from '../src/index.js';

const then = { at: 1_700_000_000, liquidityUsd: 50_000, priceUsd: 0.01, txns24h: 400 };

describe('gradeOutcome', () => {
  it('reads a liquidity drawdown past 99% as a TVL rug, with the price going with it', () => {
    const o = gradeOutcome({ then, now: { at: then.at + 3600, liquidityUsd: 300, priceUsd: 0.0004, txns24h: 12 } }, HORIZONS.h1);
    expect(o).toMatchObject({ rugged: true, liquidityBps: 60, priceBps: 400 });
    expect(o.labels).toEqual(['tvl_rug', 'price_collapse']);
  });
  it('treats a token that vanished from the aggregator as gone when it had liquidity', () => {
    expect(gradeOutcome({ then, now: null }, HORIZONS.d1)).toMatchObject({ rugged: true, labels: ['tvl_rug', 'price_collapse'], liquidityBps: 0, priceBps: 0 });
    expect(gradeOutcome({ then: { at: 1, liquidityUsd: null, priceUsd: null }, now: null }, HORIZONS.d1)).toMatchObject({ rugged: false, labels: [], liquidityBps: null });
  });
  it('calls idle only from the one-day horizon', () => {
    const now = { at: then.at + HORIZONS.d1, liquidityUsd: 40_000, priceUsd: 0.009, txns24h: 0 };
    expect(gradeOutcome({ then, now }, HORIZONS.h1).labels).toEqual([]);
    expect(gradeOutcome({ then, now }, HORIZONS.d1)).toMatchObject({ rugged: true, labels: ['idle'] });
  });
  it('reads a thin pool under a large market cap as drained, whenever the drawdown happened', () => {
    const dead = { at: 1_700_000_000, liquidityUsd: 5_300, priceUsd: 0.0026, fdvUsd: 2_600_000, txns24h: 3 };
    const o = gradeOutcome({ then: { ...dead, at: dead.at - HORIZONS.h1 }, now: dead }, HORIZONS.h1);
    expect(o).toMatchObject({ rugged: true, labels: ['drained'], liquidityBps: 10_000 });
    const healthy = { at: 1, liquidityUsd: 1_170_000, priceUsd: 0.00002, fdvUsd: 1_500_000_000, txns24h: 5000 };
    expect(gradeOutcome({ then: healthy, now: healthy }, HORIZONS.h1).labels).toEqual([]);
  });
  it('keeps a healthy token alive and counts creator exit only together with a collapse', () => {
    const now = { at: then.at + HORIZONS.d7, liquidityUsd: 120_000, priceUsd: 0.03, txns24h: 900 };
    expect(gradeOutcome({ then, now, creator: { soldPct: 100, holdingPct: 0 } }, HORIZONS.d7)).toMatchObject({ rugged: false, labels: ['creator_exit'], liquidityBps: 24_000 });
    const crashed = { at: then.at + HORIZONS.d7, liquidityUsd: 20_000, priceUsd: 0.0005, txns24h: 30 };
    expect(gradeOutcome({ then, now: crashed, creator: { soldPct: 90, holdingPct: 0.2 } }, HORIZONS.d7)).toMatchObject({ rugged: true, labels: ['price_collapse', 'creator_exit'] });
  });
});

describe('scoring', () => {
  const calls = [
    { p: 0.9, y: 1 as const }, { p: 0.8, y: 1 as const }, { p: 0.7, y: 1 as const }, { p: 0.2, y: 0 as const }, { p: 0.1, y: 0 as const }, { p: 0.6, y: 0 as const },
  ];
  it('Brier rewards sharp honest forecasts and skill is measured against the base rate', () => {
    expect(brier(calls)).toBe(0.0917);
    const s = trackSummary(calls);
    expect(s.baseRate).toBe(0.5);
    expect(s.baseBrier).toBe(0.25);
    expect(s.skill).toBe(0.6332);
    expect(trackSummary([]).brier).toBeNull();
    const flat = trackSummary(calls.map(c => ({ ...c, p: 0.5 })));
    expect(flat.skill).toBe(0);
  });
  it('bins reliability and builds a confusion matrix at 0.5', () => {
    const bins = reliability(calls);
    expect(bins).toHaveLength(10);
    expect(bins[9]).toMatchObject({ n: 1, meanForecast: 0.9, observed: 1 });
    expect(bins[6]).toMatchObject({ n: 1, observed: 0 });   // 0.6 was a miss
    expect(confusion(calls)).toMatchObject({ tp: 3, fp: 1, tn: 2, fn: 0, precision: 0.75, recall: 1 });
  });
});
