// The launch sampler feeds the track. A track record is only as honest as its
// sample: verdicts asked for by users skew to tokens that already look bad or
// famous. The sampler judges launches drawn from the live pump.fun feed on a
// fixed clock, a few minutes after they appear (so there is trading to read),
// with no filter on how they look. Those verdicts are sealed and later graded
// like any other, which gives the track an unbiased stream of calls.
//
// Launches alone teach the track little: nearly all of them are dead within a
// day, so every call has the same outcome. Half the draws therefore go to
// survivors: tokens Sentinel judged before whose last grade found them alive
// and which still trade. They are judged again, as a new sealed verdict, on an
// older token with a real history. The choice looks only at what is visible
// when the draw is made, never at how the token turns out.
// Every run costs model tokens, so it is off unless SENTINEL_SAMPLER_EVERY_MIN
// is set, and a daily cap bounds the spend.
import { fetchMarket, type LaunchEvent, type MarketData } from '@sentinel/engine';
import type { StoredVerdict, VerdictService } from './service.js';

export interface SamplerOptions {
  service: VerdictService;
  /** one verdict every this many minutes */
  everyMin: number;
  /** judge a launch only once it is at least this old, so its first trades exist (default 5 min) */
  minAgeSec?: number;
  /** and at most this old, so the call is still early (default 30 min) */
  maxAgeSec?: number;
  /** hard cap on sampled verdicts per UTC day (default 48) */
  perDay?: number;
  /** share of draws that go to survivors when there are any (default 0.5; 0 turns re-judging off) */
  survivorShare?: number;
  /** a survivor is judged again only this long after its last verdict (default 1 h) */
  survivorMinGapSec?: number;
  /** verdicts one token can collect in total (default 3) */
  maxVerdictsPerMint?: number;
  fetchMarket?: (mint: string) => Promise<MarketData | null>;
  random?: () => number;
  now?: () => number;
  log?: (m: string) => void;
}

export class LaunchSampler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private day = '';
  private today = 0;
  private readonly judged = new Set<string>();
  /** launches seen on the feed, kept until they are too old to sample; the service ring holds only the newest 50 (under a minute on pump.fun) */
  private readonly seen = new Map<string, LaunchEvent>();
  private watcher: NodeJS.Timeout | null = null;
  /** survivors found dead at a draw; not looked at again */
  private readonly gone = new Set<string>();

  constructor(private readonly o: SamplerOptions) {}

  /** Launches eligible right now: old enough to have trades, young enough to be early, not judged before. */
  /** Copy the newest launches into the pool and drop the ones past maxAge. Called every few seconds by start(). */
  observe(now = this.o.now?.() ?? Math.floor(Date.now() / 1000)): void {
    const max = this.o.maxAgeSec ?? 1800;
    for (const l of this.o.service.launches(50)) if (!this.seen.has(l.mint)) this.seen.set(l.mint, l);
    for (const [m, l] of this.seen) if (now - l.at > max) this.seen.delete(m);
    while (this.seen.size > 20_000) { const k = this.seen.keys().next().value; if (k === undefined) break; this.seen.delete(k); }
  }

  candidates(now = this.o.now?.() ?? Math.floor(Date.now() / 1000)): LaunchEvent[] {
    const min = this.o.minAgeSec ?? 300, max = this.o.maxAgeSec ?? 1800;
    this.observe(now);
    return [...this.seen.values()].filter(l => now - l.at >= min && now - l.at <= max && !this.judged.has(l.mint) && !this.o.service.lookup({ mint: l.mint }));
  }

  /** Tokens judged before whose latest verdict has been graded alive at its last horizon, due for another look. */
  survivors(now = this.o.now?.() ?? Math.floor(Date.now() / 1000)): StoredVerdict[] {
    const gap = this.o.survivorMinGapSec ?? 3600, cap = this.o.maxVerdictsPerMint ?? 3;
    const perMint = new Map<string, StoredVerdict[]>();
    for (const v of this.o.service.all()) { const l = perMint.get(v.mint) ?? []; l.push(v); perMint.set(v.mint, l); }
    const out: StoredVerdict[] = [];
    for (const [mint, vs] of perMint) {
      if (vs.length >= cap || this.gone.has(mint)) continue;
      const latest = vs.reduce((a, b) => (b.stored.at > a.stored.at ? b : a));
      const last = latest.outcomes?.[latest.outcomes.length - 1];
      if (last && !last.rugged && now - latest.stored.at >= gap) out.push(latest);
    }
    return out;
  }

  /** A random survivor that still trades right now, or null. Dead ones are remembered and skipped from then on. */
  private async pickSurvivor(now: number, random: () => number): Promise<StoredVerdict | null> {
    const pool = this.survivors(now);
    const read = this.o.fetchMarket ?? (m => fetchMarket(m));
    for (let tries = 0; tries < 5 && pool.length; tries++) {
      const [v] = pool.splice(Math.floor(random() * pool.length), 1);
      let m: MarketData | null;
      try { m = await read(v!.mint); } catch { continue; }
      if (m && m.priceUsd != null && m.txns24h > 0) return v!;
      this.gone.add(v!.mint);
    }
    return null;
  }

  /** One draw: a survivor judged again, or a uniformly random eligible launch judged once. Returns the mint judged, or null. */
  async tick(): Promise<string | null> {
    if (this.busy) return null;
    const now = this.o.now?.() ?? Math.floor(Date.now() / 1000);
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.today = 0; }
    if (this.today >= (this.o.perDay ?? 48)) return null;
    const random = this.o.random ?? Math.random;
    if (random() < (this.o.survivorShare ?? 0.5)) {
      this.busy = true;
      try {
        const s = await this.pickSurvivor(now, random);
        if (s) {
          this.today++;
          const v = await this.o.service.verdict(s.mint, undefined, { fresh: true });
          this.o.log?.(`sample · survivor ${s.mint.slice(0, 6)} · was ${s.verdict} ${s.riskScore} ${Math.round((now - s.stored.at) / 3600)} h ago · now ${v.verdict} ${v.riskScore} · ${this.today}/${this.o.perDay ?? 48} today`);
          return s.mint;
        }
      } catch (e) {
        this.o.log?.(`sample · survivor failed: ${e instanceof Error ? e.message : e}`);
        return null;
      } finally { this.busy = false; }
    }
    const pool = this.candidates(now);
    if (!pool.length) { this.o.log?.(`sample · nothing eligible (${this.seen.size} launches seen in the last ${Math.round((this.o.maxAgeSec ?? 1800) / 60)} min)`); return null; }
    const pick = pool[Math.floor(random() * pool.length)]!;
    this.busy = true;
    this.judged.add(pick.mint);
    this.today++;
    try {
      const v = await this.o.service.verdict(pick.mint, undefined, { fresh: true });
      this.o.log?.(`sample · ${pick.symbol || '?'} ${pick.mint.slice(0, 6)} · ${v.verdict} ${v.riskScore} · ${this.today}/${this.o.perDay ?? 48} today`);
      return pick.mint;
    } catch (e) {
      this.o.log?.(`sample · ${pick.mint.slice(0, 6)} failed: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally { this.busy = false; }
  }

  start(): void {
    if (this.timer) return;
    const run = () => { void this.tick(); };
    this.timer = setInterval(run, this.o.everyMin * 60_000);
    this.timer.unref?.();
    this.watcher = setInterval(() => this.observe(), 10_000);
    this.watcher.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.watcher) clearInterval(this.watcher);
    this.timer = this.watcher = null;
  }
}
