// The verdict track: every verdict is a probability sealed on Concordium before
// the outcome; the resolver reads the market again at fixed horizons, grades
// the outcome with published labels, anchors the grade beside the record, and
// the track page scores the whole history with proper scoring rules. This is
// the accountability the registry badge does not carry: not "we are verified",
// but "here is every call we made, and here is how it turned out".
import { HORIZONS, fetchMarket, gradeOutcome, trackSummary, type MarketData, type ScoredCall, type TrackSummary } from '@sentinel/engine';
import type { AuditClient } from './audit.js';
import { toBps } from './audit.js';
import type { Account } from './chain.js';
import type { StoredOutcome, StoredVerdict, VerdictService } from './service.js';

export interface ResolverOptions {
  service: VerdictService;
  /** when set, grades are recorded on the audit contract beside the verdict */
  audit?: { client: AuditClient; submitter: Account } | null;
  /** horizons in seconds; default 1h, 1d, 7d */
  horizons?: number[];
  /** how often the resolver looks for due verdicts; default 5 min */
  intervalMs?: number;
  /** at most this many grades per tick: the aggregator is shared and rate-limited */
  maxPerTick?: number;
  fetchMarket?: (mint: string) => Promise<MarketData | null>;
  now?: () => number;
  log?: (m: string) => void;
}

export const DEFAULT_HORIZONS = [HORIZONS.h1, HORIZONS.d1, HORIZONS.d7];

/** What the verdict saw of the market, from the evidence it was judged on. */
export const marketThen = (v: StoredVerdict) => ({
  at: v.at,
  liquidityUsd: v.evidence.market?.liquidityUsd ?? v.evidence.liquidity.liquidityUsd ?? null,
  priceUsd: v.evidence.market?.priceUsd ?? null,
  txns24h: v.evidence.market?.txns24h ?? null,
  fdvUsd: v.evidence.market?.fdvUsd ?? null,
});

export class Resolver {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly horizons: number[];
  constructor(private readonly o: ResolverOptions) {
    this.horizons = [...(o.horizons ?? DEFAULT_HORIZONS)].sort((a, b) => a - b);
  }

  /** Verdicts with at least one horizon due and not yet graded, oldest first. */
  due(now = this.o.now?.() ?? Math.floor(Date.now() / 1000)): Array<{ verdict: StoredVerdict; horizons: number[] }> {
    return this.o.service.all()
      // A horizon runs from when the verdict was sealed (stored.at), not from the snapshot time: a call made now on a cached
      // snapshot is still a call made now.
      .map(v => ({ verdict: v, horizons: this.horizons.filter(h => v.stored.at + h <= now && !(v.outcomes ?? []).some(o => o.horizon === h)) }))
      .filter(x => x.horizons.length > 0)
      .sort((a, b) => a.verdict.stored.at - b.verdict.stored.at);
  }

  /** One pass: grade what is due. Returns the grades made. */
  async tick(): Promise<Array<{ digest: string; outcome: StoredOutcome }>> {
    if (this.running) return [];
    this.running = true;
    const made: Array<{ digest: string; outcome: StoredOutcome }> = [];
    try {
      const now = this.o.now?.() ?? Math.floor(Date.now() / 1000);
      const fetch = this.o.fetchMarket ?? (m => fetchMarket(m));
      let budget = this.o.maxPerTick ?? 20;
      for (const { verdict: v, horizons } of this.due(now)) {
        if (budget <= 0) break;
        let market: MarketData | null;
        try { market = await fetch(v.mint); } catch (e) { this.o.log?.(`resolve · ${v.mint.slice(0, 6)} market: ${e instanceof Error ? e.message : e}`); continue; }
        const nowPoint = market ? { at: now, liquidityUsd: market.liquidityUsd, priceUsd: market.priceUsd, txns24h: market.txns24h, fdvUsd: market.fdvUsd } : null;
        for (const h of horizons) {
          if (budget-- <= 0) break;
          const graded = gradeOutcome({ then: marketThen(v), now: nowPoint }, h);
          const outcome: StoredOutcome = { ...graded, at: now, concordiumTx: null };
          if (this.o.audit && v.stored.auditSeq != null) {
            try {
              const r = await this.o.audit.client.grade(this.o.audit.submitter, { seq: v.stored.auditSeq, horizon: h, labels: graded.labels, rugged: graded.rugged, liquidity_bps: toBps(graded.liquidityBps), price_bps: toBps(graded.priceBps), observed_at: now });
              outcome.concordiumTx = r.txHash;
            } catch (e) { this.o.log?.(`resolve · grade on chain failed (seq ${v.stored.auditSeq}, ${h}s): ${e instanceof Error ? e.message : e}`); }
          }
          if (this.o.service.attachOutcome(v.attestation.digest, outcome)) {
            made.push({ digest: v.attestation.digest, outcome });
            this.o.log?.(`resolve · ${v.mint.slice(0, 6)} · ${v.verdict} ${v.riskScore} → ${graded.rugged ? 'RUGGED' : 'alive'} at +${h}s [${graded.labels.join(', ') || 'no labels'}]${outcome.concordiumTx ? ' · anchored' : ''}`);
          }
        }
      }
    } finally { this.running = false; }
    return made;
  }

  start(): void {
    if (this.timer) return;
    const every = this.o.intervalMs ?? 5 * 60_000;
    const run = () => { this.tick().catch(e => this.o.log?.(`resolve · ${e instanceof Error ? e.message : e}`)); };
    this.timer = setInterval(run, every);
    this.timer.unref?.();
    setTimeout(run, 2_000).unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export interface TrackReport {
  horizons: Array<{ horizon: number; label: string; judge: TrackSummary; agents: Array<{ agent: string; summary: TrackSummary }>; graded: number }>;
  verdicts: number;
  graded: number;
  pending: number;
  recent: Array<{ mint: string; digest: string; verdict: string; riskScore: number; at: number; concordiumTx: string | null; outcomes: StoredOutcome[] }>;
}

const label = (h: number) => (h === HORIZONS.h1 ? '1h' : h === HORIZONS.d1 ? '24h' : h === HORIZONS.d7 ? '7d' : `${h}s`);

/** Score the whole history: judge and each specialist, per horizon. riskScore/100 is P(rug). */
export function trackReport(verdicts: StoredVerdict[], horizons: number[] = DEFAULT_HORIZONS, recentLimit = 50): TrackReport {
  const perHorizon = horizons.map(h => {
    const judge: ScoredCall[] = [];
    const agents = new Map<string, ScoredCall[]>();
    for (const v of verdicts) {
      const o = v.outcomes?.find(x => x.horizon === h);
      if (!o) continue;
      const y = o.rugged ? 1 : 0;
      judge.push({ p: v.riskScore / 100, y });
      for (const f of v.findings) { const list = agents.get(f.agent) ?? []; list.push({ p: f.riskScore / 100, y }); agents.set(f.agent, list); }
    }
    return { horizon: h, label: label(h), judge: trackSummary(judge), agents: [...agents.entries()].map(([agent, xs]) => ({ agent, summary: trackSummary(xs) })).sort((a, b) => (a.summary.brier ?? 1) - (b.summary.brier ?? 1)), graded: judge.length };
  });
  const graded = verdicts.filter(v => (v.outcomes?.length ?? 0) > 0).length;
  return {
    horizons: perHorizon,
    verdicts: verdicts.length,
    graded,
    pending: verdicts.length - graded,
    recent: verdicts.filter(v => v.outcomes?.length).slice(0, recentLimit).map(v => ({ mint: v.mint, digest: v.attestation.digest, verdict: v.verdict, riskScore: v.riskScore, at: v.stored.at, concordiumTx: v.attestation.concordiumTx, outcomes: v.outcomes! })),
  };
}
