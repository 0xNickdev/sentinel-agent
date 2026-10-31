import { AdvocateOutputSchema, FindingSchema, JudgeOutputSchema, type LLM, type StructuredRequest, type StructuredResult } from '@sentinel/agents';

/** Deterministic model double: one risk score per agent, a canned judge, a line of "thinking". */
export function fakeLLM(scores: Record<string, number>, judge: { verdict: 'SAFE' | 'CAUTION' | 'DANGER' | 'RUGGED'; riskScore: number }): LLM {
  return {
    async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      req.onThinking?.(`${req.meta.agent} looking\n`);
      const usage = { input: 10, output: 5, cacheRead: 0 };
      if (req.meta.phase === 'council') {
        // rank the anonymised findings by riskScore desc, deterministically
        const list = JSON.parse(req.user.slice(req.user.indexOf('['), req.user.lastIndexOf(']') + 1)) as Array<{ finding: string; riskScore: number }>;
        const ranked = [...list].sort((a, b) => b.riskScore - a.riskScore).map((f, i) => ({ finding: f.finding, rank: i + 1, reason: `risk ${f.riskScore}` }));
        return { value: { ranked } as T, model: 'fake-specialist', usage, ms: 1 };
      }
      if (req.meta.phase === 'advocate') {
        const value = AdvocateOutputSchema.parse({ arguesFor: 'CAUTION', thesis: 'the other side', points: ['p1'], weakestLink: 'sample' });
        return { value: value as T, model: 'fake-judge', usage, ms: 1 };
      }
      if (req.meta.phase === 'judge') {
        const value = JudgeOutputSchema.parse({ ...judge, confidence: 0.8, headline: 'headline', decisive: 'fact', reasoning: 'because the evidence says so', topReasons: ['one', 'two', 'three'], cleanSignals: [], whatWouldChange: ['x'], action: 'do not buy', scorecard: [{ agent: 'contract', weight: 'decisive', why: 'w' }], dissent: null, rebuttal: 'answered' });
        return { value: value as T, model: 'fake-judge', usage, ms: 2 };
      }
      const riskScore = scores[req.meta.agent] ?? 50;
      const value = FindingSchema.parse({ riskScore, confidence: 0.9, label: 'inferred', summary: `${req.meta.agent} says ${riskScore}`, evidence: [], notable: [] });
      return { value: value as T, model: 'fake-specialist', usage, ms: 1 };
    },
  };
}
