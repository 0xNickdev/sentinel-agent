// Same-origin proxy to the Sentinel server (see next.config.ts rewrites) for JSON.
export const API = "/sentinel";
// Live streams go straight to the server (CORS-allowed): dev proxies buffer SSE.
export const STREAM = process.env.NEXT_PUBLIC_SENTINEL_API_URL ?? "http://localhost:4020";

export type Band = "SAFE" | "CAUTION" | "DANGER" | "RUGGED";

export interface VerdictSummary { mint: string; verdict: Band; riskScore: number; confidence: number; at: number; digest: string; concordiumTx: string | null; storedAt: number | null; outcomes?: Array<{ horizon: number; rugged: boolean }> }

/** How a token turned out after a verdict, graded at a fixed horizon with published labels. */
export interface Outcome { horizon: number; at: number; rule?: number; void?: boolean; labels: string[]; rugged: boolean; liquidityBps: number | null; priceBps: number | null; concordiumTx: string | null }
export interface ReliabilityBin { lo: number; hi: number; n: number; meanForecast: number | null; observed: number | null }
export interface TrackSummary { n: number; brier: number | null; logScore: number | null; baseRate: number | null; baseBrier: number | null; skill: number | null; reliability: ReliabilityBin[]; confusion: { threshold: number; tp: number; fp: number; tn: number; fn: number; precision: number | null; recall: number | null; mcc: number | null } }
/** The guarantee's own accounts, per asset in its smallest unit: what verdicts earned, what went back to buyers, what is still undecided. */
export interface GuaranteeReport {
  terms: { statement: string; horizon: number; bands: string[] };
  pool: { account: string; explorer: string } | null;
  counts: { paid: number; covered: number; open: number; kept: number; refunded: number };
  book?: Record<string, { revenue: string; refunded: string; net: string; atRisk: string; paid: number; refunds: number }>;
}
/** A specialist's reliability weight in the consensus rule: its prior, moved by how its sealed scores turned out. */
export interface LearnedWeight { weight: number; prior: number; multiplier: number; trust: number; n: number; brier: number | null }
export interface TrackReport {
  /** labelling rule the scores were graded under; grades made under an earlier rule are counted in `superseded` only */
  rule?: number;
  superseded?: Array<{ rule: number; horizon: number; label: string; graded: number; judge: TrackSummary }>;
  weights?: { source: { source: "static" | "track"; horizon?: number; rule?: number; graded?: number }; agents: Record<string, LearnedWeight> };
  /** the score-to-probability map the next verdict is sealed with; null while the track is too short to fit one */
  calibration?: { a: number; b: number; n: number; horizon: number; rule: number } | null;
  /** judge: the sealed probability scored; raw: the judge's score / 100 on the same calls; voided: grades on tokens that had nothing at stake, not scored */
  horizons: Array<{ horizon: number; label: string; judge: TrackSummary; raw?: TrackSummary; agents: Array<{ agent: string; summary: TrackSummary }>; graded: number; voided?: number }>;
  verdicts: number; graded: number; pending: number;
  recent: Array<{ mint: string; digest: string; verdict: Band; riskScore: number; at: number; concordiumTx: string | null; outcomes: Outcome[] }>;
}
export const horizonLabel = (s: number) => (s === 3600 ? "1h" : s === 86400 ? "24h" : s === 604800 ? "7d" : `${s}s`);

export interface Finding { agent: string; agentName: string; riskScore: number; confidence: number; label: string; summary: string; evidence: string[]; notable: string[]; model: string; weight: number; ms: number; revised?: { riskScore: number; confidence: number }; agentRegistryId: string | null }

export type FlowKind = "exchange" | "funder" | "dev" | "hub" | "wallet";
export interface FlowTrail { from: string; hops: Array<{ to: string; lamports: number; at: number; kind: FlowKind; label?: string }>; totalSol: number; endsAt: FlowKind }
export interface FlowsSummary { trails: FlowTrail[]; toExchangeSol: number; toFunderSol: number; recycledSol: number; traced: number; window: { from: number; to: number } }

export interface Verdict {
  schema: string; chain: string; mint: string; at: number;
  verdict: Band; riskScore: number; confidence: number; reasoning: string; topReasons: string[]; dissent: string | null;
  headline: string; decisive: string; action: string; cleanSignals: string[]; whatWouldChange: string[];
  scorecard: Array<{ agent: string; weight: "decisive" | "supporting" | "discounted" | "ignored"; why: string }>;
  advocate: { arguesFor: Band; thesis: string; points: string[]; weakestLink: string; model: string; ms: number } | null;
  rebuttal: string | null;
  timeline: Array<{ t: number; type: string; agent?: string; text: string }>;
  vetoes: Array<{ code: string; message: string; agent: string }>;
  findings: Finding[];
  consensus: { rule: string; weightedScore: number; spread: number; suggestedBand: Band; completeness: { score: number; missing: string[] }; debateRounds: number; debated: string[]; failed: string[] };
  judge: { model: string; ms: number; overridden: string[] };
  flags: Array<{ code: string; severity: string; message: string }>;
  evidence: {
    market: { symbol: string | null; name: string | null; liquidityUsd: number; fdvUsd: number | null; volume24hUsd: number; pairs: number; topVenue: string | null } | null;
    holders: { top10Pct: number; count: number; top?: Array<{ owner: string; pct: number; isCreator: boolean; isSniper: boolean }>; programHeldPct?: number; lockedPct?: number; burnedPct?: number | null };
    linked: { linkedPct: number; linkedToCreatorPct: number; checked: number; clusters: Array<{ funder: string; wallets: string[]; pct: number; viaCreator: boolean }>; exchangeFunded?: Array<{ wallet: string; exchange: string }> };
    snipers: { boughtPct: number; holdingPct: number; wallets: string[] };
    bundles: { groups: number; wallets: number; boughtPct: number; heldPct?: number; largestGroup?: number };
    flows?: FlowsSummary | null;
    creator?: { address: string | null; status: string; holdingPct?: number; boughtTokens?: number; soldTokens?: number; lockedPct?: number; proof?: unknown };
    contract?: { mintRevoked: boolean; freezeRevoked: boolean; transferFeeBps: number; permanentDelegate: boolean; transferHook: boolean; metadataMutable: boolean | null };
    liquidity?: { kind: string; lockedPct: number | null; quoteReserve: number | null; curveProgressPct: number | null };
  };
  models: { specialist: string; judge: string; engine: string };
  attestation: { digest: string; concordiumTx: string | null; agentRegistry: string | null; signature?: { alg: string; publicKey: string; signature: string } };
  timing: { totalMs: number; agentsMs: number; judgeMs: number };
  stored?: { at: number; auditSeq: number | null; auditExplorer: string | null };
  outcomes?: Outcome[];
}

/** GET /quick/:mint: the fast tier, engine rules only, no models. */
export interface QuickVerdict { tier: "fast"; mint: string; verdict: "SAFE" | "CAUTION" | "DANGER"; riskScore: number; flags: Array<{ code: string; severity: string; message: string }>; vetoes: string[]; checked: string[]; notChecked: string[]; market: { symbol: string | null; liquidityUsd: number; fdvUsd: number | null; volume24hUsd: number } | null; ms: number; at: number; cached: boolean; full: { verdict: string; riskScore: number; at: number; digest: string; concordiumTx: string | null } | null }

export interface AgentInfo { key: string; name: string; role: string; tokenId: number | null; badge: string | null; badgeCheck: string | null; card: string; cardTx?: string | null; trackRecordTx?: string | null }
/** Sentinel's Solana ed25519 key bound to the owner's Concordium account in the CIS-8 External Key Registry. */
export interface Cis8Binding { network: string; contract: { index: number; subindex: number }; owner: string; externalKey: { namespace: string; key_type: string; public_key_hex: string }; registerTx: string; explorer: string; agentLinks?: Record<string, string> }
export interface AgentsResponse { network: string; agents: AgentInfo[]; price: { microCcd: string; payTo: string; plt?: { asset: string; amount: string; payTo: string } | null } | null; attestation: { alg: string; publicKey: string }; cis8?: Cis8Binding | null }

export type SwarmEvent =
  | { type: "swarm_start"; mint: string; agents: Array<{ id: string; name: string }>; flags: number; baselineScore: number }
  | { type: "veto"; veto: { code: string; message: string; agent: string } }
  | { type: "agent_start"; agent: string; model: string }
  | { type: "agent_thinking"; agent: string; text: string }
  | { type: "agent_finding"; finding: Finding }
  | { type: "agent_error"; agent: string; error: string }
  | { type: "consensus"; consensus: Verdict["consensus"] }
  | { type: "debate_start"; agents: string[]; spread: number }
  | { type: "debate_finding"; finding: Finding }
  | { type: "advocate_start"; model: string; arguesAgainst: Band }
  | { type: "advocate_thinking"; text: string }
  | { type: "advocate"; advocate: { arguesFor: Band; thesis: string; points: string[]; weakestLink: string } }
  | { type: "judge_start"; model: string }
  | { type: "judge_thinking"; text: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "error"; error: string };

export const AGENTS: Array<{ id: string; name: string; movement: string; domain: string }> = [
  { id: "holders", name: "Holders", movement: "sweep", domain: "Concentration and whale structure" },
  { id: "snipers", name: "Snipers & Bundles", movement: "burst", domain: "First-slot buyers, same-slot bundles" },
  { id: "funding", name: "Funding Graph", movement: "trace", domain: "Who funded the top wallets" },
  { id: "creator", name: "Creator", movement: "dossier", domain: "Behaviour and track record" },
  { id: "contract", name: "Contract & Liquidity", movement: "scan", domain: "Authorities, extensions, LP" },
  { id: "market", name: "Market", movement: "pulse", domain: "Liquidity, volume, trade shape" },
  { id: "flows", name: "Money Flow", movement: "trace", domain: "Where the proceeds went" },
];

export const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
export const short = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const ccdscanTx = (hash: string, network = "testnet") => `https://${network === "mainnet" ? "" : "testnet."}ccdscan.io/transactions/${hash}`;
export const solscan = (mint: string) => `https://solscan.io/token/${mint}`;
export const usd = (n: number | null | undefined) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);
export const ago = (unix: number) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - unix)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** The server-side origin for RSC fetches (same target as the rewrite). */
export const serverApi = () => process.env.SENTINEL_API_URL ?? "http://localhost:4020";
