// One verdict service behind every surface (x402 route, MCP tool, A2A task):
// snapshot cache → engine → swarm → optional audit record → local store.
// Streams swarm events to whoever is listening for the request.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicLLM, CONSENSUS, detectVetoes, judgeToken, keysFromEnv, scoreToBand, signVerdict, type AttestationKeys, type LLM, type SwarmEvent, type Verdict } from '@sentinel/agents';
import { SolanaAdapter, analyze, type CreatorProof, type LaunchEvent, type LaunchFeed, type Outcome, type TokenSnapshot } from '@sentinel/engine';
import type { AuditClient } from './audit.js';
import type { Account } from './chain.js';
import { explorerTx } from './chain.js';
import type { Network } from './registry.js';

export interface VerdictServiceOptions {
  rpcUrl: string;
  /** a second RPC tried when the first refuses (401/403/429): keeps verdicts flowing when a provider key runs out */
  fallbackRpcUrl?: string | null;
  llm?: LLM;
  audit?: { client: AuditClient; submitter: Account; agentIds: number[]; network: Network } | null;
  /** directory for verdicts.jsonl and snapshot cache; memory-only when omitted */
  dataDir?: string | null;
  /** ML-DSA-65 keys for verdict signatures; from SENTINEL_PQ_SEED (ephemeral in dev) when omitted */
  keys?: AttestationKeys;
  /** real-time pump.fun launch feed (Geyser); omitted when no gRPC credentials */
  launchFeed?: LaunchFeed | null;
  /** creator wallets bound to a Concordium ID proof; attached to the snapshot at verdict time */
  creatorProofs?: { get(wallet: string | null | undefined): CreatorProof | null } | null;
  log?: (m: string) => void;
}

/** An outcome grade attached to a stored verdict, with the chain anchor of the grade when it was recorded. */
export interface StoredOutcome extends Outcome { concordiumTx: string | null }

/** A sub-second-to-seconds read with no models: contract, holders, liquidity and market rules only. */
export interface QuickVerdict {
  tier: 'fast';
  mint: string;
  /** SAFE / CAUTION / DANGER from the engine's rules; RUGGED is only ever called by the full swarm */
  verdict: 'SAFE' | 'CAUTION' | 'DANGER';
  riskScore: number;
  flags: Array<{ code: string; severity: string; message: string }>;
  /** flags that floor the verdict at DANGER (live mint/freeze authority, drained liquidity, …) */
  vetoes: string[];
  checked: string[];
  notChecked: string[];
  market: { symbol: string | null; liquidityUsd: number; fdvUsd: number | null; volume24hUsd: number } | null;
  ms: number;
  at: number;
  cached: boolean;
  /** the last full swarm verdict on this mint, if any */
  full: { verdict: string; riskScore: number; at: number; digest: string; concordiumTx: string | null } | null;
}

export interface StoredVerdict extends Verdict {
  stored: { at: number; auditSeq: number | null; auditExplorer: string | null };
  /** how the token turned out at each horizon; filled in by the resolver, oldest horizon first */
  outcomes?: StoredOutcome[];
}

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isMint = (s: string) => MINT_RE.test(s);

export class VerdictService {
  private readonly snapshots = new Map<string, TokenSnapshot>();
  private readonly byDigest = new Map<string, StoredVerdict>();
  private readonly byMint = new Map<string, StoredVerdict>();
  private readonly adapter: SolanaAdapter;
  private readonly fallback: SolanaAdapter | null;
  private readonly llm: LLM;
  private readonly file: string | null;
  private readonly outcomesFile: string | null;
  readonly keys: AttestationKeys & { ephemeral: boolean };
  private readonly launchRing: LaunchEvent[] = [];
  private readonly launchListeners = new Set<(ev: LaunchEvent) => void>();
  /** true when a LaunchFeed is attached (even while it is reconnecting) */
  readonly launchFeedEnabled: boolean;

  constructor(private readonly o: VerdictServiceOptions) {
    this.keys = o.keys ? { ...o.keys, ephemeral: false } : keysFromEnv();
    if (this.keys.ephemeral) o.log?.('attest · SENTINEL_PQ_SEED not set: using an ephemeral ML-DSA-65 key (signatures valid for this process only)');
    this.adapter = new SolanaAdapter({ rpcUrl: o.rpcUrl, log: m => o.log?.(`engine · ${m}`) });
    this.fallback = o.fallbackRpcUrl && o.fallbackRpcUrl !== o.rpcUrl ? new SolanaAdapter({ rpcUrl: o.fallbackRpcUrl, log: m => o.log?.(`engine (fallback rpc) · ${m}`) }) : null;
    this.llm = o.llm ?? new AnthropicLLM();
    this.file = o.dataDir ? join(o.dataDir, 'verdicts.jsonl') : null;
    this.outcomesFile = o.dataDir ? join(o.dataDir, 'outcomes.jsonl') : null;
    if (o.dataDir) {
      mkdirSync(o.dataDir, { recursive: true });
      if (this.file && existsSync(this.file)) for (const line of readFileSync(this.file, 'utf8').split('\n')) if (line.trim()) this.remember(JSON.parse(line) as StoredVerdict, false);
      // Grades live in their own append-only log: a verdict is sealed when written and never rewritten.
      if (this.outcomesFile && existsSync(this.outcomesFile)) for (const line of readFileSync(this.outcomesFile, 'utf8').split('\n')) if (line.trim()) { const g = JSON.parse(line) as { digest: string; outcome: StoredOutcome }; this.attachOutcome(g.digest, g.outcome, false); }
    }
    this.launchFeedEnabled = Boolean(o.launchFeed);
    if (o.launchFeed) {
      // The feed owns its reconnects; we only keep the last 50 and fan out. A failing feed never takes the server down.
      o.launchFeed.on('launch', ev => {
        this.launchRing.unshift(ev);
        if (this.launchRing.length > 50) this.launchRing.length = 50;
        o.log?.(`launch · ${ev.symbol || '?'} · ${ev.mint} · by ${ev.creator.slice(0, 6)}`);
        for (const l of this.launchListeners) { try { l(ev); } catch { /* listener gone */ } }
      });
      o.launchFeed.on('error', e => o.log?.(`launch · feed error: ${e.message}`));
      try { o.launchFeed.start(); } catch (e) { o.log?.(`launch · feed failed to start: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  private readonly quickCache = new Map<string, QuickVerdict>();

  /** Fast tier: engine rules on a light snapshot, no LLM, cached 60 s. The launch, funding, creator and flow lanes are not read. */
  async quick(mint: string): Promise<QuickVerdict> {
    if (!isMint(mint)) throw new Error(`not a Solana mint: ${mint}`);
    const hit = this.quickCache.get(mint);
    if (hit && Date.now() / 1000 - hit.at < 60) return { ...hit, cached: true };
    const t0 = Date.now();
    let snap: TokenSnapshot;
    try { snap = await this.adapter.quickSnapshot(mint); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!this.fallback || !/\b(401|403|429)\b|Forbidden|Unauthorized|Too Many/i.test(msg)) throw e;
      snap = await this.fallback.quickSnapshot(mint);
    }
    const ev = analyze(snap);
    const vetoes = detectVetoes(ev).map(v => v.code);
    const flags = ev.flags.map(f => ({ code: f.code, severity: f.severity, message: f.message }));
    // No pools means the liquidity rules had nothing to read: absence of evidence is never SAFE.
    if (!snap.market) flags.push({ code: 'no_market', severity: 'warn', message: 'No trading pools found: liquidity and market shape could not be checked.' });
    const noHolders = snap.unavailable?.includes('holders') ?? false;
    if (noHolders) flags.push({ code: 'holders_unavailable', severity: 'info', message: 'The RPC refused the holder query for this mint; concentration was not checked.' });
    let riskScore = 100 - ev.baselineScore;
    if (!snap.market) riskScore = Math.max(riskScore, CONSENSUS.cautionFrom);
    const band = vetoes.length ? 'DANGER' : scoreToBand(riskScore);
    const prev = this.byMint.get(mint);
    const q: QuickVerdict = {
      tier: 'fast', mint, verdict: band === 'RUGGED' ? 'DANGER' : band, riskScore, vetoes,
      flags,
      checked: ['mint and freeze authority', 'Token-2022 extensions', 'metadata mutability', ...(noHolders ? [] : ['holder concentration', 'burned and locked supply']), ...(snap.market ? ['liquidity and pools', 'market shape'] : [])],
      notChecked: [...(noHolders ? ['holder concentration'] : []), ...(snap.market ? [] : ['liquidity and pools']), 'snipers and bundles', 'funding graph', 'creator behaviour and history', 'money flow after sells', 'agent reasoning'],
      market: snap.market ? { symbol: snap.market.symbol ?? null, liquidityUsd: snap.market.liquidityUsd, fdvUsd: snap.market.fdvUsd ?? null, volume24hUsd: snap.market.volume24hUsd } : null,
      ms: Date.now() - t0, at: Math.floor(Date.now() / 1000), cached: false,
      full: prev ? { verdict: prev.verdict, riskScore: prev.riskScore, at: prev.stored.at, digest: prev.attestation.digest, concordiumTx: prev.attestation.concordiumTx } : null,
    };
    this.quickCache.set(mint, q);
    if (this.quickCache.size > 500) this.quickCache.delete(this.quickCache.keys().next().value!);
    return q;
  }

  /** Newest first, at most 50. */
  launches(limit = 50): LaunchEvent[] { return this.launchRing.slice(0, limit); }

  /** Subscribe to new launches; returns an unsubscribe. */
  onLaunch(l: (ev: LaunchEvent) => void): () => void { this.launchListeners.add(l); return () => this.launchListeners.delete(l); }

  /** Pre-seed a snapshot (demo cache, tests). */
  seed(snapshot: TokenSnapshot) { this.snapshots.set(snapshot.mint, snapshot); }

  async snapshot(mint: string): Promise<TokenSnapshot> {
    const cached = this.snapshots.get(mint);
    if (cached) return cached;
    let s: TokenSnapshot;
    try {
      s = await this.adapter.snapshot(mint);
    } catch (e) {
      // A provider that refuses (expired key, exhausted credits, rate limit) should not take verdicts down with it.
      const msg = e instanceof Error ? e.message : String(e);
      if (!this.fallback || !/\b(401|403|429)\b|Forbidden|Unauthorized|Too Many/i.test(msg)) throw e;
      this.o.log?.(`engine · primary rpc refused (${msg.slice(0, 60)}); retrying on the fallback rpc`);
      s = await this.fallback.snapshot(mint);
    }
    this.snapshots.set(mint, s);
    return s;
  }

  /** Run the swarm. `onEvent` receives the live stream; the result is stored and, when configured, anchored on Concordium. */
  async verdict(mint: string, onEvent?: (ev: SwarmEvent) => void, opts: { snapshot?: TokenSnapshot; fresh?: boolean } = {}): Promise<StoredVerdict> {
    if (!isMint(mint)) throw new Error(`not a Solana mint: ${mint}`);
    if (!opts.fresh) { const prev = this.byMint.get(mint); if (prev && Date.now() / 1000 - prev.stored.at < 300) { onEvent?.({ type: 'verdict', verdict: prev }); return prev; } }
    const base = opts.snapshot ?? (await this.snapshot(mint));
    // A proof can arrive after the snapshot was cached, so it is looked up per verdict, never cached with the chain data.
    const proof = this.o.creatorProofs?.get(base.creator) ?? null;
    const snapshot = proof ? { ...base, creatorProof: { wallet: proof.wallet, claims: proof.claims, verifiedAt: proof.verifiedAt, requestTx: proof.requestTx, auditTx: proof.auditTx } } : base;
    const v = await judgeToken(snapshot, { llm: this.llm, ...(this.o.audit ? { registry: Object.fromEntries(this.o.audit.agentIds.map((id, i) => [['holders', 'snipers', 'funding', 'creator', 'contract', 'market', 'judge'][i] ?? `agent${i}`, String(id)])) } : {}) }, onEvent);
    let auditSeq: number | null = null, auditExplorer: string | null = null;
    if (this.o.audit) {
      try {
        const r = await this.o.audit.client.record(this.o.audit.submitter, v, this.o.audit.agentIds);
        v.attestation.concordiumTx = r.txHash;
        auditSeq = r.seq; auditExplorer = r.explorer;
        this.o.log?.(`audit · seq ${r.seq} · ${r.explorer}`);
      } catch (e) {
        this.o.log?.(`audit · failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    v.attestation.signature = signVerdict(this.keys, v);
    const stored: StoredVerdict = { ...v, stored: { at: Math.floor(Date.now() / 1000), auditSeq, auditExplorer } };
    this.remember(stored, true);
    return stored;
  }

  private remember(v: StoredVerdict, persist: boolean) {
    this.byDigest.set(v.attestation.digest, v);
    this.byMint.set(v.mint, v);
    if (persist && this.file) appendFileSync(this.file, JSON.stringify(v) + '\n');
  }

  /** Every stored verdict, newest first. */
  all(): StoredVerdict[] { return [...this.byDigest.values()].sort((a, b) => b.stored.at - a.stored.at); }

  /** Attach an outcome grade to a verdict (one per horizon) and persist it. Returns false when the digest is unknown or the horizon is already graded. */
  attachOutcome(digest: string, outcome: StoredOutcome, persist = true): boolean {
    const v = this.byDigest.get(digest);
    if (!v) return false;
    v.outcomes ??= [];
    if (v.outcomes.some(o => o.horizon === outcome.horizon)) return false;
    v.outcomes.push(outcome);
    v.outcomes.sort((a, b) => a.horizon - b.horizon);
    if (persist && this.outcomesFile) appendFileSync(this.outcomesFile, JSON.stringify({ digest, outcome }) + '\n');
    return true;
  }

  lookup(q: { digest?: string; mint?: string }): StoredVerdict | null {
    if (q.digest) return this.byDigest.get(q.digest) ?? null;
    if (q.mint) return this.byMint.get(q.mint) ?? null;
    return null;
  }

  recent(limit = 20): StoredVerdict[] {
    return [...this.byDigest.values()].sort((a, b) => b.stored.at - a.stored.at).slice(0, limit);
  }

  auditLink(v: StoredVerdict): string | null {
    return v.attestation.concordiumTx && this.o.audit ? explorerTx(this.o.audit.network, v.attestation.concordiumTx) : v.stored.auditExplorer;
  }
}
