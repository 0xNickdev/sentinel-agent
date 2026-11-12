// Shapes shared by the swarm, the MCP/A2A surface and the audit record.
// Zod schemas are what the LLM is constrained to (structured outputs); the
// interfaces below are what the rest of Sentinel consumes.
import { z } from 'zod';
import type { Evidence, Flag } from '@sentinel/engine';

export const AGENT_IDS = ['holders', 'snipers', 'funding', 'creator', 'contract', 'market', 'flows'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const VERDICTS = ['SAFE', 'CAUTION', 'DANGER', 'RUGGED'] as const;
export type VerdictBand = (typeof VERDICTS)[number];

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// ── What a specialist returns ────────────────────────────────────────────
export const FindingSchema = z.object({
  riskScore: z
    .number()
    .describe('Integer 0-100 for this domain only. 0 = nothing wrong here, 50 = real concern, 100 = certain rug signal.'),
  confidence: z
    .number()
    .describe('0-1. How sure you are, given how complete the data is. Missing data lowers confidence, not the score.'),
  label: z
    .enum(['verified_onchain', 'inferred', 'heuristic'])
    .describe('verified_onchain when the conclusion follows directly from the numbers; inferred when it needs interpretation; heuristic when it is a pattern match.'),
  summary: z.string().describe('One or two plain sentences. Cite the numbers you were given; never invent new ones.'),
  evidence: z.array(z.string()).describe('Flag codes, wallet addresses or metric names the conclusion rests on.'),
  notable: z.array(z.string()).describe('Things the judge must not miss: a specific wallet, an anomaly, a gap in the data. Empty if none.'),
});
export type Finding = z.infer<typeof FindingSchema>;

// ── The advocate: argues the other side before the judge speaks ───────────
export const AdvocateOutputSchema = z.object({
  arguesFor: z.enum(VERDICTS).describe('The band you are arguing for, opposite in spirit to what the swarm leans toward.'),
  thesis: z.string().describe('One sentence: the strongest honest case for that band.'),
  points: z.array(z.string()).describe('Two or three concrete points, each resting on a number or fact from the evidence. No invented facts.'),
  weakestLink: z.string().describe('The single finding or assumption the swarm relies on most and that is least certain.'),
});
export type AdvocateOutput = z.infer<typeof AdvocateOutputSchema>;

// ── What the judge returns ───────────────────────────────────────────────
export const JudgeOutputSchema = z.object({
  verdict: z.enum(VERDICTS).describe('SAFE: no material risk found. CAUTION: real concerns, not disqualifying. DANGER: a rug is likely or the holder is at the mercy of the creator. RUGGED: the rug already happened (creator exited, liquidity gone).'),
  riskScore: z.number().describe('Integer 0-100, your overall risk estimate after weighing every agent.'),
  confidence: z.number().describe('0-1. Lower it when agents disagree or data is incomplete.'),
  headline: z.string().describe('At most twelve words. The verdict in plain language, e.g. "Exit already closed: $5k of liquidity under a $2.6M cap".'),
  decisive: z.string().describe('The one fact that decides this verdict, with its number. One sentence.'),
  reasoning: z.string().describe('Two to four short paragraphs separated by blank lines: what decides it, what is clean and why that does not change it, how disagreement was resolved. Facts and numbers, no commentary about rules or procedure.'),
  topReasons: z.array(z.string()).describe('Exactly three short reasons, most important first, each with a number from the evidence.'),
  cleanSignals: z.array(z.string()).describe('Up to three things that are genuinely fine, each with a number. Empty if nothing is.'),
  whatWouldChange: z.array(z.string()).describe('One or two concrete observations that would move the verdict to a different band, e.g. "liquidity above $250k with LP locked".'),
  action: z.string().describe('One imperative sentence for a trader or trading agent: what to do and the size or condition.'),
  scorecard: z.array(z.object({
    agent: z.enum(AGENT_IDS),
    weight: z.enum(['decisive', 'supporting', 'discounted', 'ignored']).describe('decisive: it set the verdict; supporting: consistent, added weight; discounted: considered but outweighed, say why; ignored: not relevant here.'),
    why: z.string().describe('One short sentence.'),
  })).describe('One entry per specialist that reported: how much its finding counted and why.'),
  dissent: z.string().nullable().describe('If agents disagreed beyond the threshold: who, why, and which side you took. Null if no material disagreement.'),
  rebuttal: z.string().nullable().describe('If an advocate argued for another band: answer the strongest point directly, and say what you conceded. Null if there was no advocate.'),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ── Enriched records that go into the verdict and the audit trail ───────
export interface Veto {
  code: string;
  message: string;
  /** the specialist whose domain owns this hard-fail flag */
  agent: AgentId;
}

export interface Usage { input: number; output: number; cacheRead: number }

export interface AgentFinding extends Finding {
  agent: AgentId;
  agentName: string;
  /** Concordium Agent Registry token id (badge) once registered; null in dev */
  agentRegistryId: string | null;
  model: string;
  /** reliability weight used by the consensus rule */
  weight: number;
  ms: number;
  usage: Usage;
  /** set after a debate round changed this finding */
  revised?: { riskScore: number; confidence: number };
}

export interface ConsensusResult {
  rule: 'veto+confidence_weighted_mean';
  /** Σ w·c·s / Σ w·c over successful agents */
  weightedScore: number;
  /** max(s) − min(s) across agents, 0-100 */
  spread: number;
  /** band implied by weightedScore and vetoes before the judge speaks */
  suggestedBand: VerdictBand;
  completeness: { score: number; missing: string[] };
  debateRounds: number;
  debated: AgentId[];
  failed: AgentId[];
  /** whether the token has been watched long enough for SAFE to mean anything; when not, the verdict cannot be below CAUTION */
  observation?: { sufficient: boolean; missing: string[] };
  /** where the reliability weights came from: the static priors, or priors moved by the graded track */
  weights?: WeightsSource;
}

export interface VerdictProbability {
  rug: number;
  /** seconds after the verdict the probability speaks about */
  horizon: number;
  /** none: the raw score / 100. track: Platt scaling fitted on `n` verdicts graded under `rule` before this one */
  calibration: { source: 'none' } | { source: 'track'; a: number; b: number; n: number; rule: number };
}

export interface WeightsSource {
  source: 'static' | 'track';
  /** track only: the horizon the outcomes were graded at, the labelling rule, and how many graded verdicts stood behind the weights */
  horizon?: number;
  rule?: number;
  graded?: number;
}

// ── The council: anonymous peer ranking of findings by evidential strength ─
export interface CouncilRanking {
  by: AgentId;
  ranked: Array<{ agent: AgentId; rank: number; reason: string }>;
}

export interface CouncilResult {
  /** mean normalised rank received from peers, 1 = always ranked strongest */
  scores: Partial<Record<AgentId, number>>;
  rankings: CouncilRanking[];
  ms: number;
}

/** One line of the swarm transcript: when (ms since start), what, and a short text for terminals and replay. */
export interface TimelineEntry {
  t: number;
  type: SwarmEvent['type'];
  agent?: AgentId | 'judge' | 'advocate';
  text: string;
}

export interface Verdict {
  schema: 'sentinel.verdict/1';
  chain: 'solana';
  mint: string;
  /** snapshot time, unix seconds */
  at: number;
  verdict: VerdictBand;
  riskScore: number;
  /** the forecast the track scores: P(rugged at the horizon), the judge's score passed through the calibration sealed beside it */
  probability?: VerdictProbability;
  confidence: number;
  headline: string;
  decisive: string;
  reasoning: string;
  topReasons: string[];
  cleanSignals: string[];
  whatWouldChange: string[];
  action: string;
  scorecard: JudgeOutput['scorecard'];
  dissent: string | null;
  advocate: (AdvocateOutput & { model: string; ms: number }) | null;
  rebuttal: string | null;
  vetoes: Veto[];
  findings: AgentFinding[];
  consensus: ConsensusResult;
  /** anonymous peer ranking of the findings; null when the council was off or fewer than two rankings succeeded */
  council: CouncilResult | null;
  judge: { model: string; ms: number; usage: Usage; overridden: string[] };
  flags: Flag[];
  /** the deterministic evidence the agents looked at (hashed into the digest) */
  evidence: Evidence;
  models: { specialist: string; judge: string; engine: string };
  attestation: {
    /** sha256 over canonical {chain, mint, at, evidence, verdict} — what goes on Concordium */
    digest: string;
    concordiumTx: string | null;
    agentRegistry: string | null;
    /** post-quantum signature (ML-DSA-65) by the judge key over digest ‖ mint ‖ verdict ‖ score ‖ at */
    signature?: { alg: 'ML-DSA-65'; publicKey: string; signature: string };
  };
  timing: { totalMs: number; agentsMs: number; judgeMs: number };
  timeline: TimelineEntry[];
}

// ── Streamed progress ────────────────────────────────────────────────────
export type SwarmEvent =
  | { type: 'swarm_start'; mint: string; agents: Array<{ id: AgentId; name: string }>; flags: number; baselineScore: number }
  | { type: 'veto'; veto: Veto }
  | { type: 'agent_start'; agent: AgentId; model: string }
  | { type: 'agent_thinking'; agent: AgentId; text: string }
  | { type: 'agent_finding'; finding: AgentFinding }
  | { type: 'agent_error'; agent: AgentId; error: string }
  | { type: 'consensus'; consensus: ConsensusResult }
  | { type: 'debate_start'; agents: AgentId[]; spread: number }
  | { type: 'debate_finding'; finding: AgentFinding }
  | { type: 'council_start'; agents: AgentId[] }
  | { type: 'council_rank'; by: AgentId; ranked: CouncilRanking['ranked'] }
  | { type: 'council'; scores: CouncilResult['scores']; rankings: number }
  | { type: 'advocate_start'; model: string; arguesAgainst: VerdictBand }
  | { type: 'advocate_thinking'; text: string }
  | { type: 'advocate'; advocate: AdvocateOutput }
  | { type: 'judge_start'; model: string }
  | { type: 'judge_thinking'; text: string }
  | { type: 'verdict'; verdict: Verdict };
