// The orchestrator. Fan out seven specialists in parallel, stream their
// progress, apply the consensus rule, run one debate round when they
// disagree, let the judge speak, reconcile, hash. Returns an async generator
// so callers (CLI, MCP server, web UI) see the swarm work in real time.
import { HORIZONS, analyze, calibrate, verdictDigest, type Evidence, type TokenSnapshot } from '@sentinel/engine';
import { ALL_AGENTS, agentWeight, aggregate, detectVetoes, observation, pickDebaters, reconcile } from './consensus.js';
import { COUNCIL_RANKING_SCHEMA, COUNCIL_SYSTEM, councilBrief, councilScores, decodeRanking, pooled } from './council.js';
import { modelConfig } from './env.js';
import { ADVOCATE_SYSTEM, JUDGE_SYSTEM, advocateUserMessage, judgeUserMessage } from './judge.js';
import type { LLM } from './llm.js';
import { AdvocateOutputSchema, FindingSchema, JudgeOutputSchema, type AdvocateOutput, type AgentFinding, type AgentId, type CouncilRanking, type Effort, type SwarmEvent, type TimelineEntry, type Verdict, type VerdictProbability, type WeightsSource } from './schema.js';
import { SPECIALISTS, debateUserMessage, specialistSystemPrompt, specialistUserMessage, type Specialist } from './specialists.js';

export const ENGINE_VERSION = '@sentinel/engine@0.1.0';

export interface SwarmOptions {
  llm: LLM;
  models?: { specialist: string; judge: string };
  effort?: { specialist: Effort; judge: Effort };
  /** run the debate round when specialists disagree (default true) */
  debate?: boolean;
  /** run the advocate before the judge (default: on unless SENTINEL_ADVOCATE=0) */
  advocate?: boolean;
  /** anonymous peer ranking of the findings after the debate (default: on unless SENTINEL_COUNCIL=0) */
  council?: boolean;
  /** subset of agents to run (default all seven) */
  agents?: AgentId[];
  /** Concordium Agent Registry ids once the agents are registered */
  registry?: Partial<Record<AgentId | 'judge', string>>;
  /** reliability weights learned from the graded track; agents not named keep their prior */
  weights?: { byAgent: Partial<Record<AgentId, number>>; source: WeightsSource };
  /** the map from the judge's score to a probability, fitted on the graded track; absent means score / 100 */
  calibration?: { a: number; b: number; n: number; rule: number; horizon: number };
  signal?: AbortSignal;
}

/** Tiny async queue so parallel agents can push events into one generator. */
class Channel<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  push(item: T) {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false }); else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.items.length) { yield this.items.shift()!; continue; }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>(r => this.waiters.push(r));
      if (next.done) return;
      yield next.value;
    }
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function normalise(f: { riskScore: number; confidence: number; topReasons?: string[] }) {
  f.riskScore = Math.round(clamp(Number.isFinite(f.riskScore) ? f.riskScore : 50, 0, 100));
  f.confidence = Math.round(clamp(Number.isFinite(f.confidence) ? f.confidence : 0.5, 0, 1) * 100) / 100;
}

/** One terminal line per event; thinking deltas are folded into the agent's last line. */
function transcriptLine(ev: SwarmEvent): { agent?: TimelineEntry['agent']; text: string } | null {
  switch (ev.type) {
    case 'swarm_start': return { text: `swarm start · ${ev.agents.length} agents · ${ev.flags} flags · baseline ${ev.baselineScore}` };
    case 'veto': return { agent: ev.veto.agent, text: `VETO ${ev.veto.code}: ${ev.veto.message}` };
    case 'agent_start': return { agent: ev.agent, text: `start · ${ev.model}` };
    case 'agent_finding': return { agent: ev.finding.agent, text: `risk ${ev.finding.riskScore} · conf ${ev.finding.confidence} · ${ev.finding.label} · ${ev.finding.summary}` };
    case 'debate_finding': return { agent: ev.finding.agent, text: `revised → risk ${ev.finding.riskScore} · ${ev.finding.summary}` };
    case 'agent_error': return { agent: ev.agent, text: `error · ${ev.error}` };
    case 'debate_start': return { text: `debate ${ev.agents.join(' vs ')} · spread ${ev.spread}` };
    case 'council_start': return { text: `council · ${ev.agents.length} agents rank each other's findings` };
    case 'council_rank': return { agent: ev.by, text: `ranks ${ev.ranked.map(r => `${r.rank}.${r.agent}`).join(' ')}` };
    case 'council': return { text: Object.keys(ev.scores).length ? `council ${Object.entries(ev.scores).map(([a, v]) => `${a} ${v}`).join(' · ')}` : `council skipped · ${ev.rankings} ranking${ev.rankings === 1 ? '' : 's'}` };
    case 'consensus': return { text: `consensus weighted ${ev.consensus.weightedScore} · spread ${ev.consensus.spread} · suggests ${ev.consensus.suggestedBand} · completeness ${ev.consensus.completeness.score}` };
    case 'advocate_start': return { agent: 'advocate', text: `arguing against ${ev.arguesAgainst} · ${ev.model}` };
    case 'advocate': return { agent: 'advocate', text: `for ${ev.advocate.arguesFor}: ${ev.advocate.thesis}` };
    case 'judge_start': return { agent: 'judge', text: `deliberating · ${ev.model}` };
    case 'verdict': return { agent: 'judge', text: `${ev.verdict.verdict} · risk ${ev.verdict.riskScore} · conf ${ev.verdict.confidence} · ${ev.verdict.headline}` };
    default: return null;
  }
}

export async function* runSwarm(snapshot: TokenSnapshot, opts: SwarmOptions): AsyncGenerator<SwarmEvent, Verdict> {
  const t0 = Date.now();
  const timeline: TimelineEntry[] = [];
  const record = (ev: SwarmEvent) => { const l = transcriptLine(ev); if (l) timeline.push({ t: Date.now() - t0, type: ev.type, ...(l.agent ? { agent: l.agent } : {}), text: l.text }); return ev; };
  const cfg = modelConfig();
  const models = opts.models ?? { specialist: cfg.specialist, judge: cfg.judge };
  const effort = opts.effort ?? { specialist: cfg.specialistEffort, judge: cfg.judgeEffort };
  const agents = SPECIALISTS.filter(s => (opts.agents ?? ALL_AGENTS).includes(s.id));
  const evidence: Evidence = analyze(snapshot);
  const vetoes = detectVetoes(evidence);

  yield record({ type: 'swarm_start', mint: snapshot.mint, agents: agents.map(a => ({ id: a.id, name: a.name })), flags: evidence.flags.length, baselineScore: evidence.baselineScore });
  for (const veto of vetoes) yield record({ type: 'veto', veto });

  const ch = new Channel<SwarmEvent>();
  const findings: AgentFinding[] = [];
  const failed: AgentId[] = [];
  const weights: WeightsSource = opts.weights?.source ?? { source: 'static' };
  const observed = observation(evidence, snapshot.at);

  const ask = async (sp: Specialist, user: string, phase: 'finding' | 'debate'): Promise<AgentFinding> => {
    const r = await opts.llm.structured({
      schema: FindingSchema, system: specialistSystemPrompt(sp), user, model: models.specialist, effort: effort.specialist, maxTokens: 4000,
      meta: { agent: sp.id, phase },
      onThinking: text => ch.push({ type: 'agent_thinking', agent: sp.id, text }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    normalise(r.value);
    return { ...r.value, agent: sp.id, agentName: sp.name, agentRegistryId: opts.registry?.[sp.id] ?? null, model: r.model, weight: opts.weights?.byAgent[sp.id] ?? agentWeight(sp.id), ms: r.ms, usage: r.usage };
  };

  // ── Round 1: every specialist, in parallel ──────────────────────────────
  const round1 = Promise.allSettled(agents.map(async sp => {
    ch.push({ type: 'agent_start', agent: sp.id, model: models.specialist });
    try {
      const f = await ask(sp, specialistUserMessage(sp, snapshot, evidence), 'finding');
      findings.push(f);
      ch.push({ type: 'agent_finding', finding: f });
    } catch (e) {
      failed.push(sp.id);
      ch.push({ type: 'agent_error', agent: sp.id, error: e instanceof Error ? e.message : String(e) });
    }
  })).then(() => ch.close());
  for await (const ev of ch) yield record(ev);
  await round1;
  const agentsMs = Date.now() - t0;

  // ── Consensus, then one debate round if the swarm is split ─────────────
  let consensus = aggregate(findings, evidence, vetoes, { debateRounds: 0, debated: [], failed, weights, observation: observed });
  const debaters = opts.debate === false ? null : pickDebaters(findings);
  if (debaters) {
    const [lo, hi] = debaters;
    yield record({ type: 'debate_start', agents: [lo.agent, hi.agent], spread: consensus.spread });
    const ch2 = new Channel<SwarmEvent>();
    const rebut = async (mine: AgentFinding, other: AgentFinding) => {
      const sp = SPECIALISTS.find(s => s.id === mine.agent)!;
      try {
        const f = await ask(sp, debateUserMessage(sp, snapshot, evidence, mine, { name: other.agentName, ...other }), 'debate');
        if (f.riskScore !== mine.riskScore || f.confidence !== mine.confidence) f.revised = { riskScore: mine.riskScore, confidence: mine.confidence };
        findings.splice(findings.indexOf(mine), 1, f);
        ch2.push({ type: 'debate_finding', finding: f });
      } catch (e) {
        ch2.push({ type: 'agent_error', agent: mine.agent, error: `debate: ${e instanceof Error ? e.message : String(e)}` });
      }
    };
    const debate = Promise.all([rebut(lo, hi), rebut(hi, lo)]).then(() => ch2.close());
    for await (const ev of ch2) yield record(ev);
    await debate;
    consensus = aggregate(findings, evidence, vetoes, { debateRounds: 1, debated: [lo.agent, hi.agent], failed, weights, observation: observed });
  }

  // ── Council: each specialist ranks the others' findings, anonymised ─────
  let council: Verdict['council'] = null;
  const runCouncil = opts.council ?? process.env.SENTINEL_COUNCIL !== '0';
  if (runCouncil && findings.length >= 2) {
    const tc = Date.now();
    const members = findings.map(f => f.agent);
    yield record({ type: 'council_start', agents: members });
    const ch5 = new Channel<SwarmEvent>();
    const rankings: CouncilRanking[] = [];
    const rank = async (f: AgentFinding) => {
      const sp = SPECIALISTS.find(s => s.id === f.agent)!;
      const brief = councilBrief(f.agent, findings);
      try {
        const r = await opts.llm.structured({
          schema: COUNCIL_RANKING_SCHEMA, system: `${COUNCIL_SYSTEM}\n\nYou are the ${sp.name} agent (${sp.domain}); your own finding is not among those shown.`, user: brief.user,
          model: models.specialist, effort: 'low', maxTokens: 2000,
          meta: { agent: sp.id, phase: 'council' },
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        const decoded = decodeRanking(f.agent, r.value, brief.key);
        if (!decoded) { ch5.push({ type: 'agent_error', agent: f.agent, error: 'council: ranking did not cover every finding once; skipped' }); return; }
        rankings.push(decoded);
        ch5.push({ type: 'council_rank', by: decoded.by, ranked: decoded.ranked });
      } catch (e) {
        ch5.push({ type: 'agent_error', agent: f.agent, error: `council: ${e instanceof Error ? e.message : String(e)}` });
      }
    };
    const work = pooled(findings.map(f => () => rank(f)), 6).then(() => ch5.close());
    for await (const ev of ch5) yield record(ev);
    await work;
    const scores = rankings.length >= 2 ? councilScores(rankings) : {};
    if (rankings.length >= 2) {
      council = { scores, rankings, ms: Date.now() - tc };
      consensus = aggregate(findings, evidence, vetoes, { debateRounds: consensus.debateRounds, debated: consensus.debated, failed, weights, observation: observed }, scores);
    }
    yield record({ type: 'council', scores, rankings: rankings.length });
  }
  yield record({ type: 'consensus', consensus });

  // ── Advocate: the strongest honest case for the other side ─────────────
  let advocate: Verdict['advocate'] = null;
  const runAdvocate = opts.advocate ?? process.env.SENTINEL_ADVOCATE !== '0';
  if (runAdvocate && findings.length) {
    yield record({ type: 'advocate_start', model: models.judge, arguesAgainst: consensus.suggestedBand });
    const ch4 = new Channel<SwarmEvent>();
    const call = opts.llm.structured({
      schema: AdvocateOutputSchema, system: ADVOCATE_SYSTEM, user: advocateUserMessage(snapshot, evidence, findings, vetoes, consensus, consensus.suggestedBand),
      model: models.judge, effort: 'low', maxTokens: 4000, fallbacks: !models.judge.includes('haiku'),
      meta: { agent: 'advocate', phase: 'advocate' },
      onThinking: text => ch4.push({ type: 'advocate_thinking', text }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then(r => r, e => { ch4.push({ type: 'agent_error', agent: 'market', error: `advocate: ${e instanceof Error ? e.message : String(e)}` }); return null; }).finally(() => ch4.close());
    for await (const ev of ch4) yield record(ev);
    const r = await call;
    if (r) {
      const a: AdvocateOutput = { ...r.value, points: r.value.points.slice(0, 3) };
      advocate = { ...a, model: r.model, ms: r.ms };
      yield record({ type: 'advocate', advocate: a });
    }
  }

  // ── Judge ──────────────────────────────────────────────────────────────
  yield record({ type: 'judge_start', model: models.judge });
  const ch3 = new Channel<SwarmEvent>();
  const judgeCall = opts.llm.structured({
    schema: JudgeOutputSchema, system: JUDGE_SYSTEM, user: judgeUserMessage(snapshot, evidence, findings, vetoes, consensus, advocate, council),
    model: models.judge, effort: effort.judge, maxTokens: 12000, fallbacks: !models.judge.includes('haiku'),
    meta: { agent: 'judge', phase: 'judge' },
    onThinking: text => ch3.push({ type: 'judge_thinking', text }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  }).finally(() => ch3.close());
  for await (const ev of ch3) yield record(ev);
  const judged = await judgeCall;
  normalise(judged.value);
  const final = reconcile(judged.value, consensus, vetoes, evidence);
  const reported = new Set(findings.map(f => f.agent));
  const scorecard = judged.value.scorecard.filter(s => reported.has(s.agent));

  // ── Record ─────────────────────────────────────────────────────────────
  const modelsUsed = { specialist: models.specialist, judge: judged.model, engine: ENGINE_VERSION };
  const cal = opts.calibration;
  const probability: VerdictProbability = {
    rug: calibrate(final.riskScore / 100, cal ?? null), horizon: cal?.horizon ?? HORIZONS.d1,
    calibration: cal ? { source: 'track', a: cal.a, b: cal.b, n: cal.n, rule: cal.rule } : { source: 'none' },
  };
  const attested = {
    verdict: final.verdict, riskScore: final.riskScore, probability, confidence: final.confidence, headline: judged.value.headline, decisive: judged.value.decisive, reasoning: judged.value.reasoning, topReasons: final.topReasons, action: judged.value.action,
    vetoes: vetoes.map(v => v.code),
    findings: findings.map(f => ({ agent: f.agent, agentRegistryId: f.agentRegistryId, riskScore: f.riskScore, confidence: f.confidence, label: f.label, summary: f.summary })),
    consensus: { rule: consensus.rule, weightedScore: consensus.weightedScore, spread: consensus.spread, debateRounds: consensus.debateRounds },
    council: council ? { scores: council.scores } : null,
    models: modelsUsed,
  };
  const verdict: Verdict = {
    schema: 'sentinel.verdict/1', chain: snapshot.chain, mint: snapshot.mint, at: snapshot.at,
    verdict: final.verdict, riskScore: final.riskScore, probability, confidence: final.confidence,
    headline: judged.value.headline, decisive: judged.value.decisive, reasoning: judged.value.reasoning, topReasons: final.topReasons,
    cleanSignals: judged.value.cleanSignals.slice(0, 3), whatWouldChange: judged.value.whatWouldChange.slice(0, 2), action: judged.value.action,
    scorecard, dissent: judged.value.dissent, advocate, rebuttal: advocate ? judged.value.rebuttal : null,
    vetoes, findings, consensus, council,
    judge: { model: judged.model, ms: judged.ms, usage: judged.usage, overridden: final.overridden },
    flags: evidence.flags, evidence, models: modelsUsed,
    attestation: { digest: verdictDigest({ chain: snapshot.chain, mint: snapshot.mint, at: snapshot.at, evidence, verdict: attested }), concordiumTx: null, agentRegistry: opts.registry?.judge ?? null },
    timing: { totalMs: Date.now() - t0, agentsMs, judgeMs: judged.ms },
    timeline,
  };
  record({ type: 'verdict', verdict });
  yield { type: 'verdict', verdict };
  return verdict;
}

/** Drain the generator; handy for callers that only want the verdict. */
export async function judgeToken(snapshot: TokenSnapshot, opts: SwarmOptions, onEvent?: (ev: SwarmEvent) => void): Promise<Verdict> {
  const gen = runSwarm(snapshot, opts);
  while (true) {
    const next = await gen.next();
    if (next.done) return next.value;
    onEvent?.(next.value);
  }
}
