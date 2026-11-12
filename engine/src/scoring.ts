// Proper scoring of sealed verdicts against graded outcomes. riskScore/100 is
// read as P(rug). Brier and log score are strictly proper, so the judge is
// rewarded for honest probabilities, not for sounding sure. Everything is
// reported against the climatological base rate: most launchpad tokens die, so
// a flat "90% rug" guess already scores well; skill is what beats it.

export interface ScoredCall {
  /** forecast probability of rug, 0..1 */
  p: number;
  /** outcome: 1 rugged, 0 alive */
  y: 0 | 1;
}

export interface ReliabilityBin { lo: number; hi: number; n: number; meanForecast: number | null; observed: number | null }

export interface Confusion { threshold: number; tp: number; fp: number; tn: number; fn: number; precision: number | null; recall: number | null; mcc: number | null }

export interface TrackSummary {
  n: number;
  brier: number | null;
  logScore: number | null;
  baseRate: number | null;
  /** Brier of always forecasting the base rate */
  baseBrier: number | null;
  /** 1 − brier / baseBrier: positive beats the base rate, 0 matches it, negative is worse than a constant */
  skill: number | null;
  reliability: ReliabilityBin[];
  confusion: Confusion;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export const brier = (xs: ScoredCall[]) => { const m = mean(xs.map(x => (x.p - x.y) ** 2)); return m == null ? null : r4(m); };
export const logScore = (xs: ScoredCall[]) => { const m = mean(xs.map(x => -Math.log(x.y ? clamp(x.p) : 1 - clamp(x.p)))); return m == null ? null : r4(m); };

export function reliability(xs: ScoredCall[], bins = 10): ReliabilityBin[] {
  return Array.from({ length: bins }, (_, i) => {
    const lo = i / bins, hi = (i + 1) / bins;
    const inBin = xs.filter(x => (i === bins - 1 ? x.p >= lo && x.p <= hi : x.p >= lo && x.p < hi));
    const mf = mean(inBin.map(x => x.p)), ob = mean(inBin.map(x => x.y));
    return { lo, hi, n: inBin.length, meanForecast: mf == null ? null : r4(mf), observed: ob == null ? null : r4(ob) };
  });
}

export function confusion(xs: ScoredCall[], threshold = 0.5): Confusion {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const x of xs) { const call = x.p >= threshold; if (call && x.y) tp++; else if (call) fp++; else if (x.y) fn++; else tn++; }
  const precision = tp + fp ? r4(tp / (tp + fp)) : null;
  const recall = tp + fn ? r4(tp / (tp + fn)) : null;
  const den = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  const mcc = den ? r4((tp * tn - fp * fn) / den) : null;
  return { threshold, tp, fp, tn, fn, precision, recall, mcc };
}

export function trackSummary(xs: ScoredCall[]): TrackSummary {
  const baseRate = mean(xs.map(x => x.y));
  const baseBrier = baseRate == null ? null : mean(xs.map(x => (baseRate - x.y) ** 2));
  const b = brier(xs);
  const skill = b == null || baseBrier == null ? null : baseBrier === 0 ? null : r4(1 - b / baseBrier);
  return { n: xs.length, brier: b, logScore: logScore(xs), baseRate: baseRate == null ? null : r4(baseRate), baseBrier: baseBrier == null ? null : r4(baseBrier), skill, reliability: reliability(xs), confusion: confusion(xs) };
}

// ── Reliability weights from the track ──────────────────────────────────────
// The consensus rule weighs each specialist by how its sealed scores have
// turned out. This is the exponentially weighted forecaster from prediction
// with expert advice: an agent's weight falls off with its mean Brier loss.
// Losses are taken relative to the swarm's mean, so agents that do equally
// well keep equal weights whatever the base rate; a thin history moves a
// weight only part of the way from its prior, and no history leaves it alone.

export const TRACK_WEIGHTS = {
  /** learning rate on the mean Brier loss: a 0.35 gap in Brier doubles or halves a weight */
  eta: 2,
  /** graded calls an agent needs before the track moves its weight at all */
  minN: 30,
  /** shrinkage: trust in the track is n / (n + shrinkK) */
  shrinkK: 50,
  /** bounds on the track multiplier, so no agent is silenced and none decides alone */
  min: 0.25,
  max: 2.5,
} as const;

export interface LearnedWeight {
  /** what the consensus rule uses: prior × multiplier^trust */
  weight: number;
  prior: number;
  /** exp(−η · (brier − swarm mean brier)), bounded; 1 when the agent has too little history */
  multiplier: number;
  /** n / (n + shrinkK); 0 when the agent has too little history */
  trust: number;
  n: number;
  brier: number | null;
}

export function trackWeights<K extends string>(priors: Record<K, number>, calls: Partial<Record<K, ScoredCall[]>>, cfg: { eta: number; minN: number; shrinkK: number; min: number; max: number } = TRACK_WEIGHTS): Record<K, LearnedWeight> {
  const ids = Object.keys(priors) as K[];
  const loss = new Map<K, number>();
  for (const id of ids) { const xs = calls[id] ?? []; if (xs.length >= cfg.minN) loss.set(id, xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / xs.length); }
  const ref = loss.size ? [...loss.values()].reduce((a, b) => a + b, 0) / loss.size : 0;
  const out = {} as Record<K, LearnedWeight>;
  for (const id of ids) {
    const n = calls[id]?.length ?? 0, b = loss.get(id);
    // One agent with a history has nobody to be compared with: its weight stays where it was.
    if (b == null || loss.size < 2) { out[id] = { weight: priors[id], prior: priors[id], multiplier: 1, trust: 0, n, brier: b == null ? null : r4(b) }; continue; }
    const multiplier = Math.min(cfg.max, Math.max(cfg.min, Math.exp(-cfg.eta * (b - ref))));
    const trust = n / (n + cfg.shrinkK);
    out[id] = { weight: r4(priors[id] * multiplier ** trust), prior: priors[id], multiplier: r4(multiplier), trust: r4(trust), n, brier: r4(b) };
  }
  return out;
}

// ── Calibration from the track ──────────────────────────────────────────────
// The judge's score orders tokens; what a buyer needs is a probability. Platt
// scaling maps one to the other: logit(p) = a + b · logit(score). The two
// numbers are fitted on verdicts already graded, with a ridge penalty that
// holds them at the identity (a = 0, b = 1) until the track says otherwise, so
// a short history bends the score only slightly. The slope is never negative:
// calibration may flatten the judge's ordering, it may not reverse it. The fit
// used for a verdict is sealed with it, and never sees that verdict's outcome.

export const CALIBRATION = {
  /** graded calls needed before the score is mapped at all */
  minN: 50,
  /** and at least this many of each outcome, so both ends of the map are seen */
  minEach: 10,
  /** ridge strength on (a, b − 1) */
  ridge: 1,
  /** a calibrated probability is never reported as certain */
  floor: 0.02,
  ceil: 0.98,
} as const;

export interface Calibration { a: number; b: number; n: number }

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const inner = (p: number) => Math.min(0.99, Math.max(0.01, p));

/** The probability a calibration assigns to a raw score/100. */
export const calibrate = (p: number, c: Calibration | null, cfg: { floor: number; ceil: number } = CALIBRATION): number =>
  c ? r4(Math.min(cfg.ceil, Math.max(cfg.floor, sigmoid(c.a + c.b * logit(inner(p)))))) : p;

/** Fit the map on raw scores against outcomes; null while the history is too short or one-sided. */
export function fitCalibration(xs: ScoredCall[], cfg: { minN: number; minEach: number; ridge: number } = CALIBRATION): Calibration | null {
  const pos = xs.filter(x => x.y === 1).length;
  if (xs.length < cfg.minN || pos < cfg.minEach || xs.length - pos < cfg.minEach) return null;
  const z = xs.map(x => logit(inner(x.p)));
  const solve = (slope: number | null) => {
    // Newton's method on the penalised log loss; two parameters, so the Hessian is inverted by hand.
    let a = 0, b = slope ?? 1;
    for (let it = 0; it < 200; it++) {
      let ga = cfg.ridge * a, gb = cfg.ridge * (b - 1), haa = cfg.ridge, hab = 0, hbb = cfg.ridge;
      for (let i = 0; i < xs.length; i++) {
        const q = sigmoid(a + b * z[i]!), w = q * (1 - q), e = q - xs[i]!.y;
        ga += e; gb += e * z[i]!; haa += w; hab += w * z[i]!; hbb += w * z[i]! * z[i]!;
      }
      // Steps are capped: an undamped Newton step overshoots when the scores sit far out on the logit axis.
      const cap = (d: number) => Math.max(-1, Math.min(1, d));
      if (slope != null) { const da = cap(ga / haa); a -= da; if (Math.abs(da) < 1e-9) break; continue; }
      const det = haa * hbb - hab * hab;
      if (!(det > 1e-12)) break;
      const da = cap((hbb * ga - hab * gb) / det), db = cap((haa * gb - hab * ga) / det);
      a -= da; b -= db;
      if (Math.abs(da) + Math.abs(db) < 1e-9) break;
    }
    return { a, b };
  };
  let { a, b } = solve(null);
  if (!(b >= 0)) ({ a, b } = solve(0));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a: r4(a), b: r4(b), n: xs.length };
}
