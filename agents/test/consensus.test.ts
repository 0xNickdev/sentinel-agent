import { analyze } from '@sentinel/engine';
import { describe, expect, it } from 'vitest';
import { CONSENSUS, aggregate, dataCompleteness, detectVetoes, effectiveWeight, observation, pickDebaters, reconcile, rugEvidence, scoreToBand } from '../src/consensus.js';
import { councilBrief, councilScores, decodeRanking } from '../src/council.js';
import { cleanToken, rugToken } from '../src/fixtures.js';
import type { AgentFinding, AgentId, JudgeOutput } from '../src/schema.js';

const finding = (agent: AgentId, riskScore: number, confidence = 0.8, weight = 1): AgentFinding => ({
  agent, agentName: agent, agentRegistryId: null, model: 'fake', weight, ms: 1, usage: { input: 0, output: 0, cacheRead: 0 },
  riskScore, confidence, label: 'inferred', summary: '', evidence: [], notable: [],
});
const judge = (o: Partial<JudgeOutput>): JudgeOutput => ({ verdict: 'CAUTION', riskScore: 50, confidence: 0.7, headline: '', decisive: '', reasoning: '', topReasons: ['a', 'b', 'c', 'd'], cleanSignals: [], whatWouldChange: [], action: '', scorecard: [], dissent: null, rebuttal: null, ...o });

describe('vetoes', () => {
  it('come from the hard-fail flags and are attributed to the agent that owns them', () => {
    const v = detectVetoes(analyze(rugToken()));
    expect(v.map(x => x.code).sort()).toEqual(['dev_cashed_out', 'freeze_authority_live', 'mint_authority_live']);
    expect(v.map(x => x.agent).sort()).toEqual(['contract', 'contract', 'flows']);
    expect(detectVetoes(analyze(cleanToken()))).toEqual([]);
  });
});

describe('aggregate', () => {
  const e = analyze(cleanToken());
  it('is a confidence- and weight-weighted mean with spread', () => {
    const c = aggregate([finding('holders', 20, 1, 1), finding('contract', 80, 1, 1)], e, [], { debateRounds: 0, debated: [], failed: [] });
    expect(c.weightedScore).toBe(50);
    expect(c.spread).toBe(60);
    expect(c.suggestedBand).toBe('CAUTION');
    const weighted = aggregate([finding('holders', 20, 0.2, 1), finding('contract', 80, 1, 1)], e, [], { debateRounds: 0, debated: [], failed: [] });
    expect(weighted.weightedScore).toBe(70);
  });
  it('scales each weight by 0.7 + 0.6 × councilScore when scores are passed in', () => {
    const fs = [finding('holders', 20, 1, 1), finding('contract', 80, 1, 1)];
    // holders ranked strongest (1 → ×1.3), contract weakest (0 → ×0.7): mean = (1.3·20 + 0.7·80) / 2 = 41
    expect(aggregate(fs, e, [], { debateRounds: 0, debated: [], failed: [] }, { holders: 1, contract: 0 }).weightedScore).toBe(41);
    expect(aggregate(fs, e, [], { debateRounds: 0, debated: [], failed: [] }, { holders: 0, contract: 1 }).weightedScore).toBe(59);
    // equal scores or no scores leave the plain mean
    expect(aggregate(fs, e, [], { debateRounds: 0, debated: [], failed: [] }, { holders: 0.5, contract: 0.5 }).weightedScore).toBe(50);
    expect(aggregate(fs, e, [], { debateRounds: 0, debated: [], failed: [] }, null).weightedScore).toBe(50);
    // an agent without a score keeps its static weight
    expect(aggregate(fs, e, [], { debateRounds: 0, debated: [], failed: [] }, { holders: 1 }).weightedScore).toBe(Math.round((1.3 * 20 + 80) / 2.3 * 10) / 10);
    expect(effectiveWeight(1.2, undefined)).toBe(1.2);
    expect(effectiveWeight(1, 1)).toBeCloseTo(1.3);
    expect(effectiveWeight(1, 0)).toBeCloseTo(0.7);
  });
  it('falls back to the engine baseline when no agent answered', () => {
    const c = aggregate([], e, [], { debateRounds: 0, debated: [], failed: ['holders'] });
    expect(c.weightedScore).toBe(100 - e.baselineScore);
  });
  it('a veto lifts the suggested band to the floor', () => {
    const c = aggregate([finding('holders', 10)], e, [{ code: 'mint_authority_live', message: '', agent: 'contract' }], { debateRounds: 0, debated: [], failed: [] });
    expect(c.suggestedBand).toBe(CONSENSUS.vetoFloor);
  });
});

describe('bands and completeness', () => {
  it('maps scores to bands at the configured cut-offs', () => {
    expect(scoreToBand(0)).toBe('SAFE');
    expect(scoreToBand(CONSENSUS.cautionFrom)).toBe('CAUTION');
    expect(scoreToBand(CONSENSUS.dangerFrom)).toBe('DANGER');
  });
  it('the clean fixture is complete, a bare snapshot is not', () => {
    expect(dataCompleteness(analyze(cleanToken())).score).toBe(1);
    const bare = cleanToken();
    bare.creatorHistory = null; bare.funders = {}; bare.liquidity = { kind: 'unknown', lockedPct: null, quoteReserve: null };
    const d = dataCompleteness(analyze(bare));
    expect(d.score).toBeLessThan(0.5);
    expect(d.missing).toContain('creator history');
  });
});

describe('debate trigger', () => {
  it('picks the two extremes only when the spread exceeds the threshold', () => {
    expect(pickDebaters([finding('holders', 20), finding('snipers', 40), finding('contract', 90)])?.map(f => f.agent)).toEqual(['holders', 'contract']);
    expect(pickDebaters([finding('holders', 20), finding('contract', 50)])).toBeNull();
  });
});

describe('reconcile', () => {
  const clean = analyze(cleanToken());
  const rug = analyze(rugToken());
  const noVeto = aggregate([finding('holders', 30), finding('contract', 40)], clean, [], { debateRounds: 0, debated: [], failed: [] });
  it('keeps a judge answer that respects the rule', () => {
    const r = reconcile(judge({ verdict: 'CAUTION', riskScore: 40, confidence: 0.8 }), noVeto, [], clean);
    expect(r).toMatchObject({ verdict: 'CAUTION', riskScore: 40, confidence: 0.8, overridden: [] });
    expect(r.topReasons).toHaveLength(3);
  });
  it('a veto floors the verdict and the score', () => {
    const vetoes = detectVetoes(rug);
    const c = aggregate([finding('holders', 10)], rug, vetoes, { debateRounds: 0, debated: [], failed: [] });
    const r = reconcile(judge({ verdict: 'SAFE', riskScore: 10 }), c, vetoes, rug);
    expect(r.verdict).toBe('DANGER');
    expect(r.riskScore).toBe(CONSENSUS.dangerFrom);
    expect(r.overridden.length).toBe(2);
  });
  it('RUGGED needs exit evidence', () => {
    const r = reconcile(judge({ verdict: 'RUGGED', riskScore: 60 }), noVeto, [], clean);
    expect(r.verdict).not.toBe('RUGGED');
    expect(r.overridden.some(o => o.startsWith('RUGGED lowered'))).toBe(true);
    expect(rugEvidence(clean)).toBe(false);
    expect(rugEvidence(rug)).toBe(true); // creator sold everything
  });
  it('clamps the score to the judge latitude and the band to the score', () => {
    const r = reconcile(judge({ verdict: 'DANGER', riskScore: 95 }), noVeto, [], clean);
    expect(r.riskScore).toBe(Math.round(noVeto.weightedScore + CONSENSUS.judgeLatitude));
    expect(r.verdict).toBe('CAUTION');
  });
  it('a critical flag lets the judge go above the latitude, never below', () => {
    const s = cleanToken();
    s.trades.push({ account: 'creatorClean', side: 'buy', amount: 1000, slot: 101, timestamp: 1_700_000_001 }, { account: 'creatorClean', side: 'sell', amount: 1000, slot: 300, timestamp: 1_700_000_050 });
    const e = analyze(s);
    expect(e.flags.map(f => f.code)).toContain('creator_sold_all');
    const c = aggregate([finding('holders', 10), finding('creator', 90)], e, [], { debateRounds: 0, debated: [], failed: [] });
    const up = reconcile(judge({ verdict: 'DANGER', riskScore: 88 }), c, [], e);
    expect(up.riskScore).toBe(88);
    expect(up.verdict).toBe('DANGER');
    const down = reconcile(judge({ verdict: 'SAFE', riskScore: 5 }), c, [], e);
    expect(down.riskScore).toBe(Math.round(c.weightedScore - CONSENSUS.judgeLatitude));
  });
  it('SAFE needs observation: a launch nobody has traded, or a curve token under a day old, floors at CAUTION', () => {
    const at = 1_700_000_000;
    const seasoned = analyze(cleanToken());
    expect(observation(seasoned, at)).toEqual({ sufficient: true, missing: [] });
    const young = cleanToken(); young.market = { ...young.market!, oldestPairAt: at - 900 };
    const unpriced = cleanToken(); unpriced.market = { ...unpriced.market!, priceUsd: null, txns24h: 0, oldestPairAt: at - 900 };
    const unlisted = cleanToken(); unlisted.market = null;
    const graduated = cleanToken(); graduated.market = { ...graduated.market!, onCurve: false, oldestPairAt: at - 900 };
    expect(observation(analyze(young), at).missing).toEqual(['still on its bonding curve and 0.3 h old: under 24 h of history']);
    expect(observation(analyze(unpriced), at).missing).toHaveLength(2);
    expect(observation(analyze(unlisted), at).sufficient).toBe(false);
    expect(observation(analyze(graduated), at).sufficient).toBe(true);

    const e = analyze(young), obs = observation(e, at);
    const quiet = [finding('contract', 5), finding('funding', 8), finding('holders', 12)];
    const c = aggregate(quiet, e, [], { debateRounds: 0, debated: [], failed: [], observation: obs });
    expect(c.weightedScore).toBeLessThan(CONSENSUS.cautionFrom);
    expect(c.suggestedBand).toBe('CAUTION');
    const r = reconcile(judge({ verdict: 'SAFE', riskScore: 20 }), c, [], e);
    expect(r).toMatchObject({ verdict: 'CAUTION', riskScore: CONSENSUS.cautionFrom });
    expect(r.overridden.join(' ')).toContain('not enough observation for SAFE');
    // the same findings on a token with a day of history may be called SAFE
    const c2 = aggregate(quiet, seasoned, [], { debateRounds: 0, debated: [], failed: [], observation: observation(seasoned, at) });
    expect(reconcile(judge({ verdict: 'SAFE', riskScore: 20 }), c2, [], seasoned).verdict).toBe('SAFE');
    // a higher call is left alone
    expect(reconcile(judge({ verdict: 'CAUTION', riskScore: 28 }), c, [], e).riskScore).toBe(CONSENSUS.cautionFrom);
  });
  it('drained liquidity is a veto owned by the market agent', () => {
    const s = cleanToken();
    s.market = { ...s.market!, onCurve: false, liquidityUsd: 4_000, fdvUsd: 2_000_000, volume24hUsd: 100 };
    s.liquidity = { kind: 'amm', lockedPct: null, quoteReserve: null, liquidityUsd: 4_000 };
    const v = detectVetoes(analyze(s));
    expect(v).toEqual([expect.objectContaining({ code: 'liquidity_drained', agent: 'market' })]);
  });
  it('caps confidence by data completeness', () => {
    const bare = cleanToken();
    bare.creatorHistory = null; bare.funders = {}; bare.liquidity = { kind: 'unknown', lockedPct: null, quoteReserve: null };
    const e = analyze(bare);
    const c = aggregate([finding('holders', 30)], e, [], { debateRounds: 0, debated: [], failed: [] });
    const r = reconcile(judge({ verdict: 'SAFE', riskScore: 30, confidence: 0.95 }), c, [], e);
    expect(r.confidence).toBeLessThanOrEqual(c.completeness.score + 0.15);
  });
});

describe('council', () => {
  const fs = [finding('holders', 20), finding('contract', 80), finding('market', 50)];
  it('shows an agent only the others, lettered, with nothing that names them', () => {
    const b = councilBrief('holders', fs, () => 0.1);
    expect(Object.keys(b.key).sort()).toEqual(['A', 'B']);
    expect(Object.values(b.key).sort()).toEqual(['contract', 'market']);
    expect(b.user).not.toMatch(/"agent"|"model"|"weight"|holders|contract|market/);
    expect(b.user).toContain('"finding": "A"');
  });
  it('decodes a ranking back to agents, re-deriving ranks from order, and rejects incomplete ones', () => {
    const key = { A: 'contract' as const, B: 'market' as const };
    const r = decodeRanking('holders', { ranked: [{ finding: 'Finding B', rank: 5, reason: 'thin' }, { finding: 'a', rank: 2, reason: 'verified' }] }, key);
    expect(r).toEqual({ by: 'holders', ranked: [{ agent: 'contract', rank: 1, reason: 'verified' }, { agent: 'market', rank: 2, reason: 'thin' }] });
    expect(decodeRanking('holders', { ranked: [{ finding: 'A', rank: 1, reason: '' }] }, key)).toBeNull();
    expect(decodeRanking('holders', { ranked: [{ finding: 'A', rank: 1, reason: '' }, { finding: 'A', rank: 2, reason: '' }] }, key)).toBeNull();
    expect(decodeRanking('holders', { ranked: [{ finding: 'A', rank: 1, reason: '' }, { finding: 'Z', rank: 2, reason: '' }] }, key)).toBeNull();
  });
  it('scores are the mean normalised rank received, in [0, 1]', () => {
    const scores = councilScores([
      { by: 'holders', ranked: [{ agent: 'contract', rank: 1, reason: '' }, { agent: 'market', rank: 2, reason: '' }] },
      { by: 'market', ranked: [{ agent: 'contract', rank: 1, reason: '' }, { agent: 'holders', rank: 2, reason: '' }] },
      { by: 'contract', ranked: [{ agent: 'market', rank: 1, reason: '' }, { agent: 'holders', rank: 2, reason: '' }] },
    ]);
    expect(scores).toEqual({ contract: 1, market: 0.5, holders: 0 });
    // a single peer to rank is always "strongest"
    expect(councilScores([{ by: 'a' as AgentId, ranked: [{ agent: 'contract', rank: 1, reason: '' }] }])).toEqual({ contract: 1 });
  });
});

describe('dev gone lifts the flows veto', () => {
  it('drops dev_cashed_out from the vetoes when the engine found the holders carrying the token, and keeps the contract vetoes', () => {
    const e = analyze(rugToken());
    e.flags.push({ code: 'dev_gone', severity: 'info', message: 'the holders carry it now', evidence: {} });
    const v = detectVetoes(e).map(x => x.code).sort();
    expect(v).toEqual(['freeze_authority_live', 'mint_authority_live']);
  });
});
