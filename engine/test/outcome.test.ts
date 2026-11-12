import { describe, expect, it } from 'vitest';
import { HORIZONS, OUTCOME_RULE, PUMP_CURVE, brier, calibrate, confusion, curveLiquidityUsd, fitCalibration, gradeOutcome, hasStake, reliability, trackSummary, trackWeights } from '../src/index.js';

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

describe('gradeOutcome on a bonding curve', () => {
  const SOL = 90, floor = PUMP_CURVE.floorPriceSol;
  // a curve point holding `sol` of buyers' money: price moves with the square of the reserve
  const curve = (sol: number, at = 1_700_000_000, txns24h = 50) => {
    const priceNative = floor * ((PUMP_CURVE.virtualSol + sol) / PUMP_CURVE.virtualSol) ** 2;
    return { at, liquidityUsd: 0, priceUsd: priceNative * SOL, priceNative, fdvUsd: priceNative * SOL * 1e9, txns24h, onCurve: true, venue: 'pumpfun', listed: true };
  };
  it('reads the buyers\' SOL from the curve price', () => {
    expect(curveLiquidityUsd(curve(0))).toBe(0);
    expect(curveLiquidityUsd(curve(10))).toBeCloseTo(10 * SOL, 0);
    expect(curveLiquidityUsd({ ...curve(10), venue: 'moonshot' })).toBeNull();
    expect(curveLiquidityUsd({ ...curve(10), priceNative: floor / 50 })).toBeNull();
    expect(curveLiquidityUsd({ ...curve(10), onCurve: false })).toBeNull();
  });
  it('does not call a live curve drained just because the aggregator shows no pool', () => {
    const o = gradeOutcome({ then: curve(8), now: curve(9, 1_700_003_600) }, HORIZONS.h1);
    expect(o).toMatchObject({ rugged: false, labels: [], rule: OUTCOME_RULE });
    expect(o.liquidityBps).toBeGreaterThan(10_000);
  });
  it('calls a curve the buyers have left a TVL rug and an empty curve', () => {
    const o = gradeOutcome({ then: curve(8), now: curve(0.02, 1_700_003_600) }, HORIZONS.h1);
    expect(o.rugged).toBe(true);
    expect(o.labels).toEqual(['tvl_rug', 'curve_empty']);
  });
  it('calls an already-empty curve empty whenever the buyers left, and an unpriced one nothing', () => {
    expect(gradeOutcome({ then: curve(0), now: curve(0, 1_700_003_600) }, HORIZONS.h1)).toMatchObject({ rugged: true, labels: ['curve_empty'] });
    const unpriced = { at: 1, liquidityUsd: 0, priceUsd: null, priceNative: null, fdvUsd: null, txns24h: 0, onCurve: true, venue: 'pumpfun', listed: true };
    expect(gradeOutcome({ then: unpriced, now: unpriced }, HORIZONS.h1)).toMatchObject({ rugged: false, labels: [] });
    expect(gradeOutcome({ then: unpriced, now: unpriced }, HORIZONS.d1)).toMatchObject({ rugged: true, labels: ['idle'] });
  });
  it('calls a token the aggregator dropped delisted, and leaves one it never listed alone', () => {
    expect(gradeOutcome({ then: { ...curve(0), priceNative: null }, now: null }, HORIZONS.d1)).toMatchObject({ rugged: true, labels: ['delisted', 'price_collapse'] });
    expect(gradeOutcome({ then: { at: 1, liquidityUsd: null, priceUsd: null, listed: false }, now: null }, HORIZONS.d1)).toMatchObject({ rugged: false, labels: [] });
  });
});

describe('trackWeights', () => {
  const calls = (p: number, n: number) => Array.from({ length: n }, (_, i) => ({ p, y: (i % 5 === 0 ? 0 : 1) as 0 | 1 }));
  const priors = { good: 1, bad: 1, thin: 1.2 };
  it('leaves every weight at its prior until there is a track to learn from', () => {
    expect(trackWeights(priors, {})).toMatchObject({ good: { weight: 1, trust: 0 }, thin: { weight: 1.2, multiplier: 1 } });
    expect(trackWeights(priors, { good: calls(0.8, 100) }).good).toMatchObject({ weight: 1, trust: 0, brier: 0.16 });
  });
  it('moves weight toward the agent whose sealed scores turned out better, by as much as the history supports', () => {
    const w = trackWeights(priors, { good: calls(0.8, 100), bad: calls(0.1, 100), thin: calls(0.1, 10) });
    expect(w.good.weight).toBeGreaterThan(1);
    expect(w.bad.weight).toBeLessThan(1);
    expect(w.good.multiplier * w.bad.multiplier).toBeCloseTo(1, 2);
    expect(w.thin).toMatchObject({ weight: 1.2, trust: 0, n: 10 });
    const more = trackWeights(priors, { good: calls(0.8, 1000), bad: calls(0.1, 1000) });
    expect(more.good.weight).toBeGreaterThan(w.good.weight);
    expect(more.good.multiplier).toBe(w.good.multiplier);
  });
  it('keeps equal performers equal whatever the base rate, and bounds the multiplier', () => {
    const same = trackWeights({ a: 1, b: 1 }, { a: calls(0.3, 60), b: calls(0.3, 60) });
    expect(same.a.weight).toBe(1);
    const far = trackWeights({ a: 1, b: 1 }, { a: calls(1, 500).map(c => ({ ...c, p: c.y })), b: calls(1, 500).map(c => ({ ...c, p: 1 - c.y })) }, { eta: 10, minN: 30, shrinkK: 50, min: 0.25, max: 2.5 });
    expect(far.a.multiplier).toBe(2.5);
    expect(far.b.multiplier).toBe(0.25);
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

describe('stake (rule 3)', () => {
  const sol = 80, floor = PUMP_CURVE.floorPriceSol;
  const curve = (ratio: number, at = 1_700_000_000) => ({ at, liquidityUsd: 0, priceUsd: floor * ratio * sol, priceNative: floor * ratio, onCurve: true, venue: 'pumpfun', listed: true, txns24h: 20 });
  it('sees no stake in a curve at its floor or one it cannot read, and a stake once buyers are in', () => {
    expect(hasStake(curve(1))).toBe(false);
    expect(hasStake(curve(0.8))).toBe(false);
    expect(hasStake(curve(1.5))).toBe(true);
    expect(hasStake({ at: 1, liquidityUsd: 50_000, priceUsd: 0.01 })).toBe(true);
    expect(hasStake({ at: 1, liquidityUsd: null, priceUsd: null })).toBe(false);
  });
  it('voids the grade of a token that had nothing to lose, whatever happened after', () => {
    const flat = gradeOutcome({ then: curve(1), now: curve(1, 1_700_086_400) }, HORIZONS.d1);
    expect(flat).toMatchObject({ void: true, rule: OUTCOME_RULE });
    expect(gradeOutcome({ then: curve(1), now: null }, HORIZONS.d1).void).toBe(true);
  });
  it('scores a token that had buyers in it: emptied is rugged, held is alive', () => {
    const emptied = gradeOutcome({ then: curve(2), now: curve(1, 1_700_086_400) }, HORIZONS.d1);
    expect(emptied.void).toBeUndefined();
    expect(emptied.rugged).toBe(true);
    const held = gradeOutcome({ then: curve(2), now: curve(2.1, 1_700_086_400) }, HORIZONS.d1);
    expect(held).toMatchObject({ rugged: false, labels: [] });
    expect(held.void).toBeUndefined();
  });
});

describe('calibration', () => {
  // A judge whose 80 means 60 %: high scores die three times in five, low scores one in five.
  const history = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? { p: 0.8, y: (i % 10 < 6 ? 1 : 0) as 0 | 1 } : { p: 0.3, y: (i % 10 < 2 ? 1 : 0) as 0 | 1 }));
  it('leaves the score alone until the track is long enough and has both outcomes', () => {
    expect(fitCalibration(history(40))).toBeNull();
    expect(fitCalibration(Array.from({ length: 80 }, () => ({ p: 0.8, y: 1 as const })))).toBeNull();
    expect(calibrate(0.8, null)).toBe(0.8);
  });
  it('pulls an overconfident score toward what happened and keeps the order', () => {
    const c = fitCalibration(history(400))!;
    expect(c.n).toBe(400);
    expect(calibrate(0.8, c)).toBeGreaterThan(0.5);
    expect(calibrate(0.8, c)).toBeLessThan(0.7);
    expect(calibrate(0.3, c)).toBeLessThan(0.3);
    expect(calibrate(0.9, c)).toBeGreaterThan(calibrate(0.2, c));
    const raw = history(400), fixed = raw.map(x => ({ ...x, p: calibrate(x.p, c) }));
    expect(brier(fixed)!).toBeLessThan(brier(raw)!);
  });
  it('flattens a score that ranks nothing, and never reverses it', () => {
    const inverted = Array.from({ length: 200 }, (_, i) => (i % 2 ? { p: 0.9, y: (i % 10 < 2 ? 1 : 0) as 0 | 1 } : { p: 0.1, y: (i % 10 < 8 ? 1 : 0) as 0 | 1 }));
    const c = fitCalibration(inverted)!;
    expect(c.b).toBe(0);
    expect(calibrate(0.9, c)).toBe(calibrate(0.1, c));
    expect(calibrate(0.9, c)).toBeCloseTo(0.5, 1);
  });
  it('never reports certainty', () => {
    const c = { a: 0, b: 5, n: 100 };
    expect(calibrate(0.99, c)).toBe(0.98);
    expect(calibrate(0.01, c)).toBe(0.02);
  });
});
