// What happened to a token after the verdict. A verdict is a probability
// sealed before the outcome; this is the outcome, graded by the same labels the
// literature settled on ("Catching the Rug", arXiv:2608.20271): a TVL rug is a
// liquidity drawdown past 99%, an idle rug is a market with no trades left.
// Both are read from the DEX aggregator, so every grade is reproducible by
// anyone with the two market snapshots. Creator exit is added from our own
// engine when it ran again at the horizon.
//
// Rule 2 (bonding curves). The aggregator reports no liquidity for a pair that
// is still a launchpad curve, so rule 1 read almost every priced curve token as
// "drained" and a token the aggregator had dropped as alive. On a curve the
// liquidity is the SOL buyers have put in, and the price gives it exactly; the
// TVL and drained labels are now read from that, and a token that vanished
// from the aggregator is labelled as such. Grades carry the rule they were
// made under and the track scores one rule at a time.
//
// Rule 3 (something at stake). A forecast needs an outcome that can go either
// way. Two thirds of sampled launches had no buyers' money left in the curve
// when they were judged: such a token cannot fall further, so rule 2 graded it
// "alive" when its price merely stayed at the floor, and a correct RUGGED call
// was scored as a miss. A grade on a token with nothing at stake at the verdict
// is now marked void: it is still recorded and anchored, and it is not scored.

export const HORIZONS = { h1: 3_600, d1: 86_400, d7: 604_800 } as const;
export type HorizonKey = keyof typeof HORIZONS;

/** Version of the labelling rule a grade was made under. */
export const OUTCOME_RULE = 3;

/** pump.fun's constant-product curve: 30 virtual SOL against 1.073bn virtual tokens at launch. */
export const PUMP_CURVE = { venue: 'pumpfun', virtualSol: 30, floorPriceSol: 30 / 1_073_000_000 } as const;

export const OUTCOME = {
  /** liquidity left, in basis points of what the verdict saw, at or below which it is a TVL rug */
  tvlRugBps: 100,
  /** below this many USD the pool is gone whatever the ratio says */
  goneLiquidityUsd: 100,
  /** idle needs a day: no trades in the last 24h on a token at least this old */
  idleMinHorizon: HORIZONS.d1,
  /** price left, in basis points of the verdict-time price, at or below which it collapsed */
  collapseBps: 1_000,
  creatorExitSoldPct: 80,
  creatorExitHeldPct: 1,
  /** the absolute rugged state, as the engine's liquidity_drained flag reads it: a thin pool under a large market cap */
  drainedLiquidityUsd: 25_000,
  drainedFdvToLiquidity: 100,
} as const;

export type OutcomeLabel = 'tvl_rug' | 'idle' | 'price_collapse' | 'creator_exit' | 'drained' | 'curve_empty' | 'delisted';

export interface MarketPoint {
  at: number;
  liquidityUsd: number | null;
  priceUsd: number | null;
  /** trades in the 24h before `at`; null when unknown */
  txns24h?: number | null;
  fdvUsd?: number | null;
  /** every pair is still a launchpad bonding curve: liquidityUsd is then not a pool reading */
  onCurve?: boolean | null;
  /** price in SOL, for reading a curve's reserves */
  priceNative?: number | null;
  venue?: string | null;
  /** the aggregator listed the token at this point; lets a later disappearance be told from "never listed" */
  listed?: boolean | null;
}

export interface OutcomeInput {
  /** what the verdict saw */
  then: MarketPoint;
  /** what the aggregator shows at the horizon; null when the token has no pairs any more */
  now: MarketPoint | null;
  /** creator behaviour re-read at the horizon, when the engine ran again */
  creator?: { soldPct: number | null; holdingPct: number | null } | null;
}

export interface Outcome {
  /** seconds after the verdict this grade stands for */
  horizon: number;
  /** when the grade was read, unix seconds */
  at: number;
  /** labelling rule the grade was made under; absent on grades made before rules were versioned (rule 1) */
  rule?: number;
  labels: OutcomeLabel[];
  /** nothing was at stake when the verdict was sealed (no exit liquidity to lose): recorded, not scored */
  void?: boolean;
  /** the binary ground truth the verdict is scored against: TVL rug, idle, drained, an emptied curve, delisted, or the creator left and the price went with them */
  rugged: boolean;
  /** liquidity now as basis points of liquidity then; null when then was unknown */
  liquidityBps: number | null;
  priceBps: number | null;
}

const bps = (now: number | null | undefined, then: number | null | undefined): number | null =>
  then == null || then <= 0 || now == null ? null : Math.max(0, Math.round((now / then) * 10_000));

/**
 * USD that buyers have in a bonding curve, from its price: on x·y=k the price moves with the square of the SOL reserve, so
 * real SOL = virtual × (√(price / floor) − 1). Null when the curve is not one we know or the price cannot be read; a price
 * well under the floor means different curve parameters, not an empty curve.
 */
export function curveLiquidityUsd(p: MarketPoint): number | null {
  if (!p.onCurve || p.venue !== PUMP_CURVE.venue || !p.priceNative || p.priceNative <= 0 || !p.priceUsd || p.priceUsd <= 0) return null;
  const ratio = p.priceNative / PUMP_CURVE.floorPriceSol;
  if (ratio < 0.9) return null;
  const realSol = PUMP_CURVE.virtualSol * (Math.sqrt(Math.max(ratio, 1)) - 1);
  return Math.round(realSol * (p.priceUsd / p.priceNative) * 100) / 100;
}

/** Liquidity a holder can actually exit into: the pool on an AMM, the buyers' SOL on a curve (unknown there unless the price reads). */
const exitLiquidityUsd = (p: MarketPoint): number | null => (p.onCurve ? curveLiquidityUsd(p) : p.liquidityUsd);

/** What a holder stands to lose at this point, in USD of exit liquidity; null when it cannot be read. */
export const stakeUsd = (p: MarketPoint): number | null => exitLiquidityUsd(p);

/** There is something to lose: readable exit liquidity above the "gone" line. Sampling and scoring both use this one test. */
export const hasStake = (p: MarketPoint): boolean => (exitLiquidityUsd(p) ?? 0) > OUTCOME.goneLiquidityUsd;

export function gradeOutcome(input: OutcomeInput, horizon: number): Outcome {
  const { then, now } = input;
  const labels: OutcomeLabel[] = [];
  const at = now?.at ?? then.at + horizon;
  const liqThen = exitLiquidityUsd(then), liqNow = now ? exitLiquidityUsd(now) : null;
  const liquidityBps = now ? bps(liqNow, liqThen) : liqThen ? 0 : null;
  const priceBps = now ? bps(now.priceUsd, then.priceUsd) : then.priceUsd ? 0 : null;
  const hadLiquidity = (liqThen ?? 0) > OUTCOME.goneLiquidityUsd;
  // On a curve an unreadable reserve is unknown, not zero: only a reading can call the drawdown.
  if (hadLiquidity && (now == null || (liqNow != null && (liquidityBps! <= OUTCOME.tvlRugBps || liqNow < OUTCOME.goneLiquidityUsd)))) labels.push('tvl_rug');
  if (horizon >= OUTCOME.idleMinHorizon && now && now.txns24h === 0) labels.push('idle');
  // Already-dead tokens: a verdict of RUGGED on a token whose pool is a thin sliver under its market cap is right whenever the
  // drawdown happened. This is the engine's liquidity_drained reading, applied to the horizon snapshot.
  // A curve always shows a market cap over an empty pool, so the ratio means nothing there; its dead state is read below.
  if (now && !now.onCurve && now.liquidityUsd != null && now.fdvUsd != null && now.liquidityUsd < OUTCOME.drainedLiquidityUsd && now.fdvUsd / Math.max(now.liquidityUsd, 1) > OUTCOME.drainedFdvToLiquidity) labels.push('drained');
  // The curve's own dead state: it traded (it has a price) and the buyers' SOL is gone again, whenever they left.
  if (now && liqNow != null && now.onCurve && liqNow < OUTCOME.goneLiquidityUsd) labels.push('curve_empty');
  // Listed when judged, dropped by the aggregator since: nothing trades it any more.
  if (now == null && then.listed) labels.push('delisted');
  if (priceBps != null && priceBps <= OUTCOME.collapseBps) labels.push('price_collapse');
  const c = input.creator;
  if (c && (c.soldPct ?? 0) >= OUTCOME.creatorExitSoldPct && (c.holdingPct ?? 100) < OUTCOME.creatorExitHeldPct) labels.push('creator_exit');
  const rugged = labels.includes('tvl_rug') || labels.includes('idle') || labels.includes('drained') || labels.includes('curve_empty') || labels.includes('delisted') || (labels.includes('creator_exit') && labels.includes('price_collapse'));
  return { horizon, at, rule: OUTCOME_RULE, labels, ...(hadLiquidity ? {} : { void: true }), rugged, liquidityBps, priceBps };
}

export const horizonLabel = (seconds: number): string => (Object.entries(HORIZONS).find(([, s]) => s === seconds)?.[0] ?? `${seconds}s`);
