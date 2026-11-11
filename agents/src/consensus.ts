// The consensus rule is code, not prose: vetoes short-circuit, scores are
// confidence- and reliability-weighted, disagreement is measured and either
// debated or reported, and the judge's answer is reconciled against all of
// that. Every number here ends up in the audit record.
import type { Evidence } from '@sentinel/engine';
import { AGENT_IDS, type AgentFinding, type AgentId, type ConsensusResult, type CouncilResult, type JudgeOutput, type Veto, type VerdictBand, VERDICTS } from './schema.js';
import { COUNCIL_WEIGHT } from './council.js';

export const CONSENSUS = {
  /** spread (max − min risk score) above which a debate round runs */
  debateSpread: 35,
  /** weighted score bands */
  cautionFrom: 35,
  dangerFrom: 65,
  /** with a veto the verdict can never be below this */
  vetoFloor: 'DANGER' as VerdictBand,
  /** how far the judge may move the risk score from the weighted mean (no veto) */
  judgeLatitude: 20,
  /** without enough observation the verdict can never be below this: nothing found is not the same as safe */
  unobservedFloor: 'CAUTION' as VerdictBand,
  /** a token still on its bonding curve must have lived this long before it can be called SAFE; nearly every launch is dead within a day */
  curveMinAgeSec: 86_400,
} as const;

/** Hard-fail flag codes and the specialist whose domain owns them. */
export const VETO_CODES: Record<string, AgentId> = {
  mint_authority_live: 'contract',
  freeze_authority_live: 'contract',
  permanent_delegate: 'contract',
  lp_pullable: 'contract',
  liquidity_drained: 'market',
  dev_cashed_out: 'flows',
};

/** Prior reliability weights. The graded track moves them (engine `trackWeights`); with no track yet they are used as they are. */
export const AGENT_WEIGHTS: Record<AgentId, number> = {
  contract: 1.2,
  funding: 1.15,
  snipers: 1.0,
  holders: 0.95,
  creator: 1.0,
  market: 0.8,
  flows: 1.1,
};

const bandIndex = (b: VerdictBand) => VERDICTS.indexOf(b);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function detectVetoes(evidence: Evidence): Veto[] {
  // The creator's exit stays on the record, but once the engine finds the dev gone and the holders carrying a grown,
  // spread-out token (dev_gone), that exit no longer floors the verdict at DANGER; the judge weighs it like any flag.
  const devGone = evidence.flags.some(f => f.code === 'dev_gone');
  return evidence.flags
    .filter(f => f.severity === 'critical' && f.code in VETO_CODES && !(devGone && f.code === 'dev_cashed_out'))
    .map(f => ({ code: f.code, message: f.message, agent: VETO_CODES[f.code]! }));
}

export function scoreToBand(score: number): VerdictBand {
  return score >= CONSENSUS.dangerFrom ? 'DANGER' : score >= CONSENSUS.cautionFrom ? 'CAUTION' : 'SAFE';
}

/** How much of the evidence the engine could actually fill in. Caps confidence. */
export function dataCompleteness(evidence: Evidence): { score: number; missing: string[] } {
  const missing: string[] = [];
  if (evidence.linked.checked === 0) missing.push('funding graph (no wallets traced)');
  if (!evidence.creator.history) missing.push('creator history');
  if (evidence.creator.address == null) missing.push('creator address');
  if (evidence.liquidity.kind === 'unknown') missing.push('liquidity venue');
  if (evidence.liquidity.lockedPct == null && evidence.liquidity.liquidityUsd == null) missing.push('LP lock status');
  if (evidence.market == null) missing.push('market data (price, liquidity, volume)');
  if (evidence.holders.count === 0) missing.push('holders');
  const weights = 7;
  return { score: round((weights - missing.length) / weights), missing };
}

/**
 * Has the token been watched long enough for SAFE to mean anything? The track showed what happens without this: specialists
 * that find nothing in their own domain score a minutes-old launch low, the mean lands in SAFE, and the token is dead the
 * next day. Absence of evidence is reported as such and floors the verdict at CAUTION.
 */
export function observation(evidence: Evidence, at: number): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  const m = evidence.market;
  if (m == null) missing.push('no market: the token is not listed anywhere yet');
  else {
    if (m.priceUsd == null) missing.push('no price: nothing has traded');
    else if (m.txns24h === 0) missing.push('no trades in the last 24 h');
    if (m.onCurve) {
      const age = m.oldestPairAt == null ? null : at - m.oldestPairAt;
      if (age == null || age < CONSENSUS.curveMinAgeSec) missing.push(`still on its bonding curve and ${age == null ? 'of unknown age' : `${Math.max(0, Math.round(age / 360) / 10)} h old`}: under ${CONSENSUS.curveMinAgeSec / 3600} h of history`);
    }
  }
  return { sufficient: missing.length === 0, missing };
}

/** Effective reliability weight: the static weight, scaled by the council score when the peers have ranked this agent. */
export function effectiveWeight(weight: number, councilScore: number | undefined): number {
  return councilScore == null ? weight : weight * (COUNCIL_WEIGHT.floor + COUNCIL_WEIGHT.span * clamp(councilScore, 0, 1));
}

export function aggregate(findings: AgentFinding[], evidence: Evidence, vetoes: Veto[], extra: Pick<ConsensusResult, 'debateRounds' | 'debated' | 'failed' | 'weights' | 'observation'>, councilScores?: CouncilResult['scores'] | null): ConsensusResult {
  let num = 0, den = 0;
  for (const f of findings) {
    const w = effectiveWeight(f.weight, councilScores?.[f.agent]) * clamp(f.confidence, 0.05, 1);
    num += w * f.riskScore;
    den += w;
  }
  // No agent answered: fall back to the deterministic baseline (risk = 100 − score).
  const weightedScore = round(den > 0 ? num / den : 100 - evidence.baselineScore, 1);
  const scores = findings.map(f => f.riskScore);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  let suggestedBand = scoreToBand(weightedScore);
  if (extra.observation && !extra.observation.sufficient && bandIndex(suggestedBand) < bandIndex(CONSENSUS.unobservedFloor)) suggestedBand = CONSENSUS.unobservedFloor;
  if (vetoes.length && bandIndex(suggestedBand) < bandIndex(CONSENSUS.vetoFloor)) suggestedBand = CONSENSUS.vetoFloor;
  return { rule: 'veto+confidence_weighted_mean', weightedScore, spread, suggestedBand, completeness: dataCompleteness(evidence), ...extra };
}

/** The two agents furthest apart; they get to hear each other once. */
export function pickDebaters(findings: AgentFinding[]): [AgentFinding, AgentFinding] | null {
  if (findings.length < 2) return null;
  const sorted = [...findings].sort((a, b) => a.riskScore - b.riskScore);
  const lo = sorted[0]!, hi = sorted[sorted.length - 1]!;
  return hi.riskScore - lo.riskScore > CONSENSUS.debateSpread ? [lo, hi] : null;
}

/** Only a token whose creator has exited or whose liquidity is gone can be called RUGGED. */
export function rugEvidence(evidence: Evidence): boolean {
  return evidence.creator.status === 'sold_all'
    || evidence.liquidity.kind === 'none'
    || (evidence.liquidity.kind === 'amm' && evidence.liquidity.lockedPct === 0)
    || evidence.flags.some(f => f.code === 'liquidity_drained');
}

export interface Reconciled { verdict: VerdictBand; riskScore: number; confidence: number; topReasons: string[]; overridden: string[] }

/** The judge interprets; the rule decides what it is allowed to conclude. */
export function reconcile(out: JudgeOutput, consensus: ConsensusResult, vetoes: Veto[], evidence: Evidence): Reconciled {
  const overridden: string[] = [];
  let verdict = out.verdict;
  let riskScore = Math.round(clamp(out.riskScore, 0, 100));
  let confidence = clamp(out.confidence, 0, 1);

  if (vetoes.length && bandIndex(verdict) < bandIndex(CONSENSUS.vetoFloor)) {
    overridden.push(`verdict ${verdict} raised to ${CONSENSUS.vetoFloor}: ${vetoes.map(v => v.code).join(', ')}`);
    verdict = CONSENSUS.vetoFloor;
  }
  if (verdict === 'RUGGED' && !rugEvidence(evidence)) {
    overridden.push('RUGGED lowered to DANGER: no exit evidence (creator still holds, liquidity present)');
    verdict = 'DANGER';
  }
  if (vetoes.length) {
    const floor = CONSENSUS.dangerFrom;
    if (riskScore < floor) { overridden.push(`riskScore ${riskScore} raised to ${floor} by veto`); riskScore = floor; }
  } else {
    // The judge may move the score by judgeLatitude around the swarm mean. A critical
    // flag (creator sold all, creator circle, serial rugger) is a fact the mean may
    // under-weight when most agents see nothing in their own domain, so with one
    // present the judge may go as high as it likes, only not lower than the band allows.
    const critical = evidence.flags.some(f => f.severity === 'critical');
    const lo = Math.round(consensus.weightedScore - CONSENSUS.judgeLatitude), hi = critical ? 100 : Math.round(consensus.weightedScore + CONSENSUS.judgeLatitude);
    if (riskScore < lo || riskScore > hi) { overridden.push(`riskScore ${riskScore} clamped to [${Math.max(0, lo)}, ${Math.min(100, hi)}] around weighted mean ${consensus.weightedScore}`); riskScore = clamp(riskScore, lo, hi); }
  }
  if (consensus.observation && !consensus.observation.sufficient && riskScore < CONSENSUS.cautionFrom) {
    overridden.push(`riskScore ${riskScore} raised to ${CONSENSUS.cautionFrom}: not enough observation for SAFE (${consensus.observation.missing.join('; ')})`);
    riskScore = CONSENSUS.cautionFrom;
  }
  // the band must agree with the score it sits on; RUGGED sits in the DANGER range
  if (verdict === 'RUGGED') {
    if (riskScore < CONSENSUS.dangerFrom) { overridden.push(`riskScore ${riskScore} raised to ${CONSENSUS.dangerFrom} for RUGGED`); riskScore = CONSENSUS.dangerFrom; }
  } else {
    const implied = scoreToBand(riskScore);
    if (implied !== verdict) { overridden.push(`verdict ${verdict} moved to ${implied} to match riskScore ${riskScore}`); verdict = implied; }
  }
  const cap = round(clamp(consensus.completeness.score + 0.15, 0.3, 1));
  if (confidence > cap) { overridden.push(`confidence ${round(confidence)} capped at ${cap} by data completeness`); confidence = cap; }
  confidence = round(clamp(confidence, 0.05, 0.98));
  const topReasons = out.topReasons.filter(Boolean).slice(0, 3);
  return { verdict, riskScore, confidence, topReasons, overridden };
}

export function agentWeight(id: AgentId): number {
  return AGENT_WEIGHTS[id];
}

export const ALL_AGENTS: readonly AgentId[] = AGENT_IDS;
