import { analyze, HORIZONS, OUTCOME_RULE, type MarketData } from '@sentinel/engine';
import { cleanToken, rugToken } from '@sentinel/agents';
import { describe, expect, it } from 'vitest';
import { Resolver, VerdictService, learnedCalibration, learnedWeights, marketThen, scoredCalls, trackReport, type StoredVerdict } from '../src/index.js';

const market = (mint: string, liquidityUsd: number, priceUsd: number, txns24h = 500): MarketData => ({
  source: 'dexscreener', symbol: 'X', name: 'X', priceUsd, liquidityUsd, fdvUsd: liquidityUsd * 10, volume24hUsd: 1000, txns24h, priceChangePct: { h1: 0, h6: 0, h24: 0 }, pairs: 1, topVenue: 'raydium', venues: ['raydium'], oldestPairAt: 1_700_000_000, onCurve: false,
});

/** A stored verdict shaped like the service writes it, with only the fields the resolver and the track read. */
function stored(mint: string, riskScore: number, at: number, liquidityUsd: number, priceUsd: number, findings: Array<[string, number]>): StoredVerdict {
  const snapshot = riskScore >= 50 ? rugToken() : cleanToken();
  snapshot.mint = mint;
  snapshot.market = market(mint, liquidityUsd, priceUsd);
  const evidence = analyze(snapshot);
  return {
    schema: 'sentinel.verdict/1', chain: 'solana', mint, at, verdict: riskScore >= 65 ? 'DANGER' : 'SAFE', riskScore, confidence: 0.8,
    headline: '', decisive: '', reasoning: '', topReasons: [], cleanSignals: [], whatWouldChange: [], action: '', scorecard: [], dissent: null, advocate: null, rebuttal: null,
    vetoes: [], consensus: { rule: 'weighted', weightedScore: riskScore, spread: 0, suggestedBand: 'SAFE', completeness: { score: 1, missing: [] }, debateRounds: 0, debated: [], failed: [], vetoes: [], councilScores: null } as unknown as StoredVerdict['consensus'],
    council: null, judge: { model: 'fake', ms: 1, usage: { input: 0, output: 0, cacheRead: 0 }, overridden: [] }, flags: evidence.flags, evidence,
    findings: findings.map(([agent, score]) => ({ agent, agentName: agent, agentRegistryId: null, model: 'fake', weight: 1, ms: 1, usage: { input: 0, output: 0, cacheRead: 0 }, riskScore: score, confidence: 0.8, label: 'inferred', summary: '', evidence: [], notable: [] })) as StoredVerdict['findings'],
    models: { specialist: 'fake', judge: 'fake', engine: '0' }, attestation: { digest: `digest-${mint}`, concordiumTx: null, agentRegistry: null },
    timing: { totalMs: 1, agentsMs: 1, judgeMs: 1 }, timeline: [], stored: { at, auditSeq: null, auditExplorer: null },
  };
}

describe('resolver', () => {
  it('grades only due horizons, once each, from a fresh market read, and the track scores judge and specialists', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    const t0 = 1_700_000_000;
    // verdict A: called DANGER 85 on a token that then lost its liquidity; verdict B: called SAFE 15 on one that kept it
    const a = stored('A'.repeat(32), 85, t0, 50_000, 0.01, [['holders', 90], ['market', 70]]);
    const b = stored('B'.repeat(32), 15, t0, 80_000, 0.02, [['holders', 10], ['market', 30]]);
    (service as unknown as { remember(v: StoredVerdict, p: boolean): void }).remember(a, false);
    (service as unknown as { remember(v: StoredVerdict, p: boolean): void }).remember(b, false);
    const reads: string[] = [];
    let clock = t0 + HORIZONS.h1 + 10;
    const resolver = new Resolver({
      service, now: () => clock,
      fetchMarket: async mint => { reads.push(mint); return mint.startsWith('A') ? market(mint, 200, 0.0001, 3) : market(mint, 90_000, 0.025); },
    });
    expect(resolver.due().map(d => d.horizons)).toEqual([[HORIZONS.h1], [HORIZONS.h1]]);
    const made = await resolver.tick();
    expect(made).toHaveLength(2);
    expect(reads).toHaveLength(2);
    expect(a.outcomes?.[0]).toMatchObject({ horizon: HORIZONS.h1, rugged: true, labels: ['tvl_rug', 'price_collapse'], liquidityBps: 40, concordiumTx: null });
    expect(b.outcomes?.[0]).toMatchObject({ horizon: HORIZONS.h1, rugged: false, labels: [] });
    // nothing else is due yet; a second tick reads nothing
    expect(await resolver.tick()).toEqual([]);
    expect(reads).toHaveLength(2);
    // a day on, the 24h horizon is due; the 1h grade is never redone
    clock = t0 + HORIZONS.d1 + 10;
    expect(resolver.due().map(d => d.horizons)).toEqual([[HORIZONS.d1], [HORIZONS.d1]]);
    await resolver.tick();
    expect(a.outcomes?.map(o => o.horizon)).toEqual([HORIZONS.h1, HORIZONS.d1]);

    const report = trackReport(service.all());
    expect(report).toMatchObject({ verdicts: 2, graded: 2, pending: 0 });
    const h1 = report.horizons.find(h => h.horizon === HORIZONS.h1)!;
    expect(h1.graded).toBe(2);
    expect(h1.judge.brier).toBe(0.0225);           // (0.85-1)² and (0.15-0)² averaged
    expect(h1.judge.baseRate).toBe(0.5);
    expect(h1.judge.skill).toBe(0.91);
    expect(h1.judge.confusion).toMatchObject({ tp: 1, tn: 1, fp: 0, fn: 0 });
    expect(h1.agents.map(x => x.agent)).toEqual(['holders', 'market']);   // best Brier first
    expect(h1.agents[0]!.summary.brier).toBe(0.01);
    expect(report.recent[0]!.outcomes).toHaveLength(2);
    expect(marketThen(a)).toMatchObject({ at: t0, liquidityUsd: 50_000, priceUsd: 0.01 });
  });

  it('scores one labelling rule at a time and learns the consensus weights from the graded track only', () => {
    const t0 = 1_700_000_000;
    const grade = (v: StoredVerdict, rugged: boolean, rule?: number) => { v.outcomes = [{ horizon: HORIZONS.d1, at: t0 + HORIZONS.d1, ...(rule ? { rule } : {}), labels: rugged ? ['tvl_rug'] : [], rugged, liquidityBps: null, priceBps: null, concordiumTx: null }]; return v; };
    // 40 verdicts graded under the current rule: the market agent called every one right, the contract agent every one wrong
    const current = Array.from({ length: 40 }, (_, i) => grade(stored(`M${i}`.padEnd(32, 'x'), 50, t0 + i, 50_000, 0.01, [['market', i % 2 ? 90 : 10], ['contract', i % 2 ? 10 : 90]]), i % 2 === 1, OUTCOME_RULE));
    // 20 older grades carry no rule (rule 1): the other way round, and they must not count
    const old = Array.from({ length: 20 }, (_, i) => grade(stored(`O${i}`.padEnd(32, 'x'), 50, t0 + i, 50_000, 0.01, [['market', 10], ['contract', 90]]), true));

    expect(learnedWeights(old).source).toEqual({ source: 'static' });
    expect(learnedWeights(current.slice(0, 20)).source).toEqual({ source: 'static' });   // under minN
    const w = learnedWeights([...current, ...old]);
    expect(w.source).toEqual({ source: 'track', horizon: HORIZONS.d1, rule: OUTCOME_RULE, graded: 40 });
    expect(w.agents.market).toMatchObject({ n: 40, brier: 0.01, prior: 0.8 });
    expect(w.byAgent.market).toBeGreaterThan(0.8);
    expect(w.byAgent.contract).toBeLessThan(1.2);
    expect(w.byAgent.market).toBeGreaterThan(w.byAgent.contract);
    expect(w.byAgent.holders).toBe(0.95);   // no history: the prior stands

    const report = trackReport([...current, ...old]);
    expect(report.rule).toBe(OUTCOME_RULE);
    expect(report.horizons.find(h => h.horizon === HORIZONS.d1)!.graded).toBe(40);
    expect(report.superseded).toMatchObject([{ rule: 1, horizon: HORIZONS.d1, label: '24h', graded: 20 }]);
    expect(report.weights.source.source).toBe('track');
  });

  it('leaves void grades out of the score, and seals a calibrated probability once the track can fit one', () => {
    const t0 = 1_700_000_000;
    const grade = (v: StoredVerdict, rugged: boolean, extra: object = {}) => { v.outcomes = [{ horizon: HORIZONS.d1, at: t0 + HORIZONS.d1, rule: OUTCOME_RULE, labels: [], rugged, liquidityBps: null, priceBps: null, concordiumTx: null, ...extra }]; return v; };
    // An overconfident judge: says 85, and three in five of those die; says 30, and one in five do.
    const graded = Array.from({ length: 100 }, (_, i) => (i % 2
      ? grade(stored(`H${i}`.padEnd(32, 'x'), 85, t0 + i, 50_000, 0.01, [['market', 85]]), i % 10 < 6)
      : grade(stored(`L${i}`.padEnd(32, 'x'), 30, t0 + i, 50_000, 0.01, [['market', 30]]), i % 10 < 2)));
    const voids = Array.from({ length: 30 }, (_, i) => grade(stored(`V${i}`.padEnd(32, 'x'), 90, t0 + i, 50_000, 0.01, [['market', 90]]), false, { void: true }));

    const calls = scoredCalls([...graded, ...voids], HORIZONS.d1);
    expect(calls.judge).toHaveLength(100);
    expect(calls.voided).toBe(30);
    expect(calls.agents.get('market')).toHaveLength(100);

    expect(learnedCalibration(graded.slice(0, 40))).toBeNull();
    const c = learnedCalibration([...graded, ...voids])!;
    expect(c).toMatchObject({ n: 100, horizon: HORIZONS.d1, rule: OUTCOME_RULE });
    expect(c.b).toBeLessThan(1);

    // A verdict sealed with a probability is scored on it; the raw score is reported beside it.
    const sealed = graded.map(v => ({ ...v, probability: { rug: v.riskScore === 85 ? 0.6 : 0.2, horizon: HORIZONS.d1, calibration: { source: 'track' as const, a: c.a, b: c.b, n: c.n, rule: c.rule } } }));
    const report = trackReport([...sealed, ...voids]);
    const day = report.horizons.find(h => h.horizon === HORIZONS.d1)!;
    expect(day).toMatchObject({ graded: 100, voided: 30 });
    expect(day.judge.brier!).toBeLessThan(day.raw.brier!);
    expect(day.judge.skill!).toBeGreaterThan(0);
    expect(report.calibration).toMatchObject({ n: 100 });
  });
});
