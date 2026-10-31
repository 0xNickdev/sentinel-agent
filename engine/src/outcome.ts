// What happened to a token after the verdict. A verdict is a probability
// sealed before the outcome; this is the outcome, graded by the same labels the
// literature settled on ("Catching the Rug", arXiv:2608.20271): a TVL rug is a
// liquidity drawdown past 99%, an idle rug is a market with no trades left.
// Both are read from the DEX aggregator, so every grade is reproducible by
// anyone with the two market snapshots. Creator exit is added from our own
// engine when it ran again at the horizon.

export const HORIZONS = { h1: 3_600, d1: 86_400, d7: 604_800 } as const;
export type HorizonKey = keyof typeof HORIZONS;

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

export type OutcomeLabel = 'tvl_rug' | 'idle' | 'price_collapse' | 'creator_exit' | 'drained';

export interface MarketPoint {
  at: number;
  liquidityUsd: number | null;
  priceUsd: number | null;
  /** trades in the 24h before `at`; null when unknown */
  txns24h?: number | null;
  fdvUsd?: number | null;
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
  labels: OutcomeLabel[];
  /** the binary ground truth the verdict is scored against: TVL rug, idle, drained, or the creator left and the price went with them */
  rugged: boolean;
  /** liquidity now as basis points of liquidity then; null when then was unknown */
  liquidityBps: number | null;
  priceBps: number | null;
}

const bps = (now: number | null | undefined, then: number | null | undefined): number | null =>
  then == null || then <= 0 || now == null ? null : Math.max(0, Math.round((now / then) * 10_000));

export function gradeOutcome(input: OutcomeInput, horizon: number): Outcome {
  const { then, now } = input;
  const labels: OutcomeLabel[] = [];
  const at = now?.at ?? then.at + horizon;
  const liquidityBps = now ? bps(now.liquidityUsd, then.liquidityUsd) : then.liquidityUsd ? 0 : null;
  const priceBps = now ? bps(now.priceUsd, then.priceUsd) : then.priceUsd ? 0 : null;
  const hadLiquidity = (then.liquidityUsd ?? 0) > OUTCOME.goneLiquidityUsd;
  if (hadLiquidity && (now == null || liquidityBps! <= OUTCOME.tvlRugBps || (now.liquidityUsd ?? 0) < OUTCOME.goneLiquidityUsd)) labels.push('tvl_rug');
  if (horizon >= OUTCOME.idleMinHorizon && now && now.txns24h === 0) labels.push('idle');
  // Already-dead tokens: a verdict of RUGGED on a token whose pool is a thin sliver under its market cap is right whenever the
  // drawdown happened. This is the engine's liquidity_drained reading, applied to the horizon snapshot.
  if (now && now.liquidityUsd != null && now.fdvUsd != null && now.liquidityUsd < OUTCOME.drainedLiquidityUsd && now.fdvUsd / Math.max(now.liquidityUsd, 1) > OUTCOME.drainedFdvToLiquidity) labels.push('drained');
  if (priceBps != null && priceBps <= OUTCOME.collapseBps) labels.push('price_collapse');
  const c = input.creator;
  if (c && (c.soldPct ?? 0) >= OUTCOME.creatorExitSoldPct && (c.holdingPct ?? 100) < OUTCOME.creatorExitHeldPct) labels.push('creator_exit');
  const rugged = labels.includes('tvl_rug') || labels.includes('idle') || labels.includes('drained') || (labels.includes('creator_exit') && labels.includes('price_collapse'));
  return { horizon, at, labels, rugged, liquidityBps, priceBps };
}

export const horizonLabel = (seconds: number): string => (Object.entries(HORIZONS).find(([, s]) => s === seconds)?.[0] ?? `${seconds}s`);
