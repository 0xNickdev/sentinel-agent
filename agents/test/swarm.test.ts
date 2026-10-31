import { describe, expect, it } from 'vitest';
import { AdvocateOutputSchema, FindingSchema, JudgeOutputSchema, type SwarmEvent } from '../src/schema.js';
import type { LLM, StructuredRequest, StructuredResult } from '../src/llm.js';
import { cleanToken, rugToken } from '../src/fixtures.js';
import { judgeToken, runSwarm } from '../src/swarm.js';
import { aggregate } from '../src/consensus.js';

/** A deterministic stand-in: scores per agent, a canned judge, streamed "thinking". */
function fakeLLM(scores: Record<string, number>, judge: { verdict: 'SAFE' | 'CAUTION' | 'DANGER' | 'RUGGED'; riskScore: number }): LLM & { calls: StructuredRequest<unknown>[] } {
  const calls: StructuredRequest<unknown>[] = [];
  return {
    calls,
    async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      calls.push(req as StructuredRequest<unknown>);
      req.onThinking?.(`looking at ${req.meta.agent}\n`);
      const usage = { input: 100, output: 50, cacheRead: 0 };
      if (req.meta.phase === 'council') {
        // rank the anonymised findings by riskScore desc, deterministically
        const list = JSON.parse(req.user.slice(req.user.indexOf('['), req.user.lastIndexOf(']') + 1)) as Array<{ finding: string; riskScore: number }>;
        const ranked = [...list].sort((a, b) => b.riskScore - a.riskScore).map((f, i) => ({ finding: f.finding, rank: i + 1, reason: `risk ${f.riskScore}` }));
        return { value: { ranked } as T, model: 'fake-specialist', usage, ms: 1 };
      }
      if (req.meta.phase === 'advocate') {
        const value = AdvocateOutputSchema.parse({ arguesFor: 'CAUTION', thesis: 'the other side', points: ['p1', 'p2'], weakestLink: 'sample size' });
        return { value: value as T, model: 'fake-judge', usage, ms: 2 };
      }
      if (req.meta.phase === 'judge') {
        const value = JudgeOutputSchema.parse({ ...judge, confidence: 0.8, headline: 'short headline', decisive: 'the fact', reasoning: 'because', topReasons: ['one', 'two', 'three'], cleanSignals: ['fine'], whatWouldChange: ['x'], action: 'do not buy', scorecard: [{ agent: 'contract', weight: 'decisive', why: 'authorities' }, { agent: 'holders', weight: 'discounted', why: 'small' }], dissent: req.user.includes('revisedFrom') ? 'resolved' : null, rebuttal: req.user.includes('"advocate": null') ? null : 'answered' });
        return { value: value as T, model: 'fake-judge', usage, ms: 5 };
      }
      const base = scores[req.meta.agent] ?? 50;
      // in a debate the low agent moves up a little, the high agent stays
      const riskScore = req.meta.phase === 'debate' && base < 50 ? base + 10 : base;
      const value = FindingSchema.parse({ riskScore, confidence: 0.9, label: 'inferred', summary: `${req.meta.agent} says ${riskScore}`, evidence: [], notable: [] });
      return { value: value as T, model: 'fake-specialist', usage, ms: 3 };
    },
  };
}

const models = { specialist: 'fake-specialist', judge: 'fake-judge' };
const effort = { specialist: 'low' as const, judge: 'low' as const };

describe('runSwarm', () => {
  it('streams every stage and returns a verdict on the clean fixture', async () => {
    const llm = fakeLLM({ holders: 10, snipers: 15, funding: 5, creator: 10, contract: 5, market: 20, flows: 5 }, { verdict: 'SAFE', riskScore: 12 });
    const events: SwarmEvent[] = [];
    const v = await judgeToken(cleanToken(), { llm, models, effort }, e => events.push(e));
    const types = events.map(e => e.type);
    expect(types[0]).toBe('swarm_start');
    expect(types.filter(t => t === 'agent_start')).toHaveLength(7);
    expect(types.filter(t => t === 'agent_finding')).toHaveLength(7);
    expect(types.filter(t => t === 'agent_thinking').length).toBeGreaterThanOrEqual(7);
    expect(types).not.toContain('debate_start');
    expect(types.slice(-3)).toEqual(['judge_start', 'judge_thinking', 'verdict']);
    expect(types).toContain('advocate');
    expect(v.verdict).toBe('SAFE');
    expect(v.advocate?.arguesFor).toBe('CAUTION');
    expect(v.rebuttal).toBe('answered');
    expect(v.headline).toBe('short headline');
    expect(v.scorecard.map(s => s.agent).sort()).toEqual(['contract', 'holders']);
    expect(v.timeline[0]?.type).toBe('swarm_start');
    expect(v.timeline.at(-1)?.type).toBe('verdict');
    expect(v.timeline.filter(t => t.type === 'agent_finding')).toHaveLength(7);
    expect(v.vetoes).toEqual([]);
    expect(v.findings).toHaveLength(7);
    expect(v.consensus.debateRounds).toBe(0);
    expect(v.attestation.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(v.models.judge).toBe('fake-judge');
    expect(llm.calls).toHaveLength(16); // 7 findings + 7 council rankings + advocate + judge
    expect(llm.calls.find(c => c.meta.phase === 'judge')?.fallbacks).toBe(true);
  });

  it('runs the council after the debate and before the advocate, and folds its scores into consensus', async () => {
    const llm = fakeLLM({ holders: 10, snipers: 90, funding: 95, creator: 90, contract: 100, market: 60, flows: 95 }, { verdict: 'DANGER', riskScore: 80 });
    const events: SwarmEvent[] = [];
    const v = await judgeToken(rugToken(), { llm, models, effort }, e => events.push(e));
    const types = events.map(e => e.type);
    const last = (t: string) => types.lastIndexOf(t);
    expect(types.filter(t => t === 'council_rank')).toHaveLength(7);
    expect(types.indexOf('council_start')).toBeGreaterThan(last('debate_finding'));
    expect(last('council_rank')).toBeLessThan(types.indexOf('council'));
    expect(types.indexOf('council')).toBeLessThan(types.indexOf('consensus'));
    expect(types.indexOf('consensus')).toBeLessThan(types.indexOf('advocate_start'));
    expect(types.indexOf('advocate_start')).toBeLessThan(types.indexOf('judge_start'));
    const councilCalls = llm.calls.filter(c => c.meta.phase === 'council');
    expect(councilCalls).toHaveLength(7);
    expect(councilCalls.every(c => c.effort === 'low' && c.model === 'fake-specialist')).toBe(true);
    // anonymised: no agent names or ids in what a ranker sees
    expect(councilCalls.some(c => /"agent"|Holders|Snipers|fake-specialist/.test(c.user))).toBe(false);
    expect(councilCalls.find(c => c.meta.agent === 'holders')?.user).not.toContain('holders says');
    expect(v.council).not.toBeNull();
    expect(v.council!.rankings).toHaveLength(7);
    expect(v.council!.rankings.every(r => r.ranked.length === 6 && r.ranked.every(x => x.agent !== r.by && x.reason.length > 0))).toBe(true);
    const scores = Object.values(v.council!.scores);
    expect(scores).toHaveLength(7);
    expect(scores.every(s => s! >= 0 && s! <= 1)).toBe(true);
    // the fake ranks by riskScore desc: contract (100) is always first, holders (20 after debate) always last
    expect(v.council!.scores.contract).toBe(1);
    expect(v.council!.scores.holders).toBe(0);
    const judgeCall = llm.calls.find(c => c.meta.phase === 'judge')!;
    expect(judgeCall.user).toContain('"council"');
    expect(judgeCall.user).toContain('"reasons"');
    // consensus used the council-scaled weights (not the plain mean)
    const plain = aggregate(v.findings, v.evidence, v.vetoes, { debateRounds: 1, debated: [], failed: [] });
    const scaled = aggregate(v.findings, v.evidence, v.vetoes, { debateRounds: 1, debated: [], failed: [] }, v.council!.scores);
    expect(v.consensus.weightedScore).toBe(scaled.weightedScore);
    expect(v.consensus.weightedScore).not.toBe(plain.weightedScore);
    expect(v.timeline.some(t => t.type === 'council_rank' && t.agent === 'contract')).toBe(true);
    expect(v.timeline.find(t => t.type === 'council')?.text).toMatch(/^council contract 1/);
  });

  it('skips a failed ranking and drops the council entirely below two usable rankings', async () => {
    const inner = fakeLLM({ holders: 10, snipers: 15, funding: 5, creator: 10, contract: 5, market: 20, flows: 5 }, { verdict: 'SAFE', riskScore: 12 });
    const oneFails: LLM = { structured: async req => { if (req.meta.phase === 'council' && req.meta.agent === 'market') throw new Error('rate limited'); return inner.structured(req); } };
    const events: SwarmEvent[] = [];
    const v = await judgeToken(cleanToken(), { llm: oneFails, models, effort, advocate: false }, e => events.push(e));
    expect(events.some(e => e.type === 'agent_error' && e.agent === 'market' && e.error.startsWith('council:'))).toBe(true);
    expect(v.council!.rankings).toHaveLength(6);
    expect(v.council!.rankings.map(r => r.by)).not.toContain('market');
    expect(v.council!.scores.market).toBeDefined(); // still ranked by the others
    expect(v.findings).toHaveLength(7);

    const garbage: LLM = { structured: async req => (req.meta.phase === 'council' && req.meta.agent !== 'contract' ? { value: { ranked: [{ finding: 'A', rank: 1, reason: 'x' }] } as never, model: 'fake', usage: { input: 0, output: 0, cacheRead: 0 }, ms: 1 } : inner.structured(req)) };
    const w = await judgeToken(cleanToken(), { llm: garbage, models, effort, advocate: false }, e => events.push(e));
    expect(w.council).toBeNull();
    const councilEv = events.filter(e => e.type === 'council').at(-1);
    expect(councilEv && councilEv.type === 'council' && councilEv.rankings).toBe(1);
    expect(councilEv && councilEv.type === 'council' && councilEv.scores).toEqual({});
  });

  it('council off yields null and no council events', async () => {
    const llm = fakeLLM({ holders: 10, snipers: 15, funding: 5, creator: 10, contract: 5, market: 20, flows: 5 }, { verdict: 'SAFE', riskScore: 12 });
    const events: SwarmEvent[] = [];
    const v = await judgeToken(cleanToken(), { llm, models, effort, council: false, advocate: false }, e => events.push(e));
    expect(v.council).toBeNull();
    expect(events.some(e => e.type.startsWith('council'))).toBe(false);
    expect(llm.calls.filter(c => c.meta.phase === 'council')).toHaveLength(0);
    expect(llm.calls).toHaveLength(8);
  });

  it('vetoes the rug fixture, runs a debate when agents split, and the rule overrides a soft judge', async () => {
    const llm = fakeLLM({ holders: 10, snipers: 90, funding: 95, creator: 90, contract: 100, market: 60, flows: 95 }, { verdict: 'CAUTION', riskScore: 40 });
    const events: SwarmEvent[] = [];
    const v = await judgeToken(rugToken(), { llm, models, effort }, e => events.push(e));
    const types = events.map(e => e.type);
    expect(types.filter(t => t === 'veto')).toHaveLength(3);
    expect(types).toContain('debate_start');
    expect(types.filter(t => t === 'debate_finding')).toHaveLength(2);
    const debate = events.find(e => e.type === 'debate_start');
    expect(debate && debate.type === 'debate_start' && debate.agents.sort()).toEqual(['contract', 'holders']);
    const revised = v.findings.find(f => f.agent === 'holders');
    expect(revised?.revised).toEqual({ riskScore: 10, confidence: 0.9 });
    expect(revised?.riskScore).toBe(20);
    expect(v.findings.find(f => f.agent === 'contract')?.revised).toBeUndefined(); // unchanged after debate: not marked revised
    expect(v.consensus.debateRounds).toBe(1);
    expect(v.verdict).toBe('DANGER');
    expect(v.riskScore).toBeGreaterThanOrEqual(65);
    expect(v.judge.overridden.length).toBeGreaterThan(0);
    expect(v.dissent).toBe('resolved');
    expect(llm.calls).toHaveLength(18); // 7 + 2 debate + 7 council + advocate + judge
  });

  it('survives a failing specialist and reports it', async () => {
    const inner = fakeLLM({ holders: 10, snipers: 10, funding: 10, creator: 10, contract: 10, market: 10, flows: 10 }, { verdict: 'SAFE', riskScore: 10 });
    const llm: LLM = { structured: async req => { if (req.meta.agent === 'market') throw new Error('boom'); return inner.structured(req); } };
    const events: SwarmEvent[] = [];
    const v = await judgeToken(cleanToken(), { llm, models, effort, debate: false, advocate: false }, e => events.push(e));
    expect(events.some(e => e.type === 'agent_error' && e.agent === 'market')).toBe(true);
    expect(v.advocate).toBeNull();
    expect(v.findings).toHaveLength(6);
    expect(v.consensus.failed).toEqual(['market']);
  });

  it('runs a subset of agents when asked', async () => {
    const llm = fakeLLM({ contract: 5 }, { verdict: 'SAFE', riskScore: 5 });
    const gen = runSwarm(cleanToken(), { llm, models, effort, agents: ['contract'], advocate: false });
    const starts: string[] = [];
    let r = await gen.next();
    while (!r.done) { if (r.value.type === 'agent_start') starts.push(r.value.agent); r = await gen.next(); }
    expect(starts).toEqual(['contract']);
    expect(r.value.findings).toHaveLength(1);
  });
});
