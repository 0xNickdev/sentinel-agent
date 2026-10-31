// Chain-agnostic input to the engine. Adapters (Solana today) fill a
// TokenSnapshot from RPC/indexer data; signals never touch the network, so
// they are unit-testable and auditable: the same snapshot always yields the
// same evidence, which is what we hash into the Concordium audit record.

export interface Holder {
  owner: string;
  /** UI amount (already divided by decimals) */
  amount: number;
  /** true for program-derived addresses: curve vaults, pools, lockers */
  isProgram: boolean;
  /** set when the account sits in a token locker (Streamflow, Jupiter Lock, Raydium's locker): the program's name and who signed the locking transaction */
  lock?: { program: string; lockedBy: string[] };
}

export interface Trade {
  account: string;
  side: 'buy' | 'sell';
  /** UI token amount */
  amount: number;
  /** block/slot number, used for sniper + bundle detection */
  slot: number;
  /** unix seconds */
  timestamp: number;
  /** optional: Jito bundle id or equivalent, when known */
  bundleId?: string;
}

export interface MintInfo {
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Token-2022 extensions that change what a holder can do with the token */
  extensions?: {
    transferFeeBps?: number;
    permanentDelegate?: string | null;
    transferHook?: string | null;
    nonTransferable?: boolean;
    defaultAccountFrozen?: boolean;
  };
  metadataMutable?: boolean | null;
}

export interface Liquidity {
  kind: 'bonding_curve' | 'amm' | 'none' | 'unknown';
  /** % of LP tokens burned or locked by a program; 100 = cannot be pulled */
  lockedPct: number | null;
  /** quote currency in the pool, UI amount */
  quoteReserve: number | null;
  /** curve progress 0–100 when still on a launchpad curve */
  curveProgressPct?: number | null;
  venue?: string;
  /** USD liquidity summed over every known pool (market adapter) */
  liquidityUsd?: number | null;
}

/** Market-wide facts from a DEX aggregator: the view RPC cannot give. */
export interface MarketData {
  source: 'dexscreener';
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  /** USD liquidity summed over all pairs */
  liquidityUsd: number;
  fdvUsd: number | null;
  volume24hUsd: number;
  txns24h: number;
  /** liquidity-weighted price change in % */
  priceChangePct: { h1: number | null; h6: number | null; h24: number | null };
  pairs: number;
  topVenue: string | null;
  venues: string[];
  /** unix seconds of the oldest pair, i.e. when the token first became tradable */
  oldestPairAt: number | null;
  /** every pair is still a launchpad bonding curve */
  onCurve: boolean;
}

export interface CreatorHistory {
  address: string;
  launched: number;
  /** tokens that reached a real market (graduated / listed) */
  graduated: number;
  /** tokens that went to ~zero within 24h */
  rugged: number;
  pastTokens: Array<{ mint: string; symbol?: string; outcome: 'graduated' | 'rugged' | 'alive' | 'dead' | 'unknown'; athUsd?: number }>;
  /** social handle reuse across unrelated tokens */
  socialReusedBy: number;
  /** a Concordium ID proof (real person, 18+) is attached to this creator */
  verifiedHuman?: boolean;
}

/** What a SOL transfer landed on: a named exchange, the creator's funder, the creator, a hub several traced wallets paid into, or a wallet with no record. */
export type FlowKind = 'exchange' | 'funder' | 'dev' | 'hub' | 'wallet';

export interface FlowHop {
  to: string;
  lamports: number;
  /** unix seconds of the first transfer on this hop */
  at: number;
  kind: FlowKind;
  /** exchange or launcher name when kind is "exchange" */
  label?: string;
}

/** SOL leaving one traced wallet after its last sell, followed up to three hops. */
export interface FlowTrail {
  from: string;
  hops: FlowHop[];
  /** SOL on the first hop, i.e. what left the traced wallet to this destination */
  totalSol: number;
  endsAt: FlowKind;
}

export interface FlowsSummary {
  trails: FlowTrail[];
  toExchangeSol: number;
  toFunderSol: number;
  /** SOL to wallets that fund other creators (needs the creator index; 0 until it exists) */
  recycledSol: number;
  /** wallets whose outflows were read */
  traced: number;
  /** unix seconds: earliest window start, latest window end */
  window: { from: number; to: number };
}

export interface TokenSnapshot {
  chain: 'solana';
  mint: string;
  creator: string | null;
  mintInfo: MintInfo;
  holders: Holder[];
  trades: Trade[];
  liquidity: Liquidity;
  creatorHistory: CreatorHistory | null;
  /** first funder of each wallet we chose to trace, null when unknown */
  funders: Record<string, string | null>;
  /** wallets with 1000+ transactions: exchanges, faucets, routers — never a "link" */
  hubs: string[];
  /** names for known shared wallets among funders and holders, e.g. "Binance", "Coinbase", "ClawPump" */
  labels?: Record<string, string>;
  /** market-wide view from a DEX aggregator; null when the token has no pools or the adapter was skipped */
  market?: MarketData | null;
  /** SOL trails out of the creator and selling insiders after their last sell; null when no Helius key or the trace was skipped */
  flows?: FlowTrail[] | null;
  /** snapshot time, unix seconds */
  at: number;
}

export type Severity = 'info' | 'warn' | 'critical';

export interface Flag {
  code: string;
  severity: Severity;
  /** human sentence, safe to show */
  message: string;
  /** the numbers behind it, for the audit record and the UI */
  evidence: Record<string, number | string | boolean | null>;
}

export interface Evidence {
  holders: {
    top: Array<{ owner: string; pct: number; isCreator: boolean; isSniper: boolean }>; top10Pct: number; programHeldPct: number; count: number;
    /** % of supply sitting in a token locker until its date (part of programHeldPct) */
    lockedPct: number;
    /** % of supply the creator locked themselves (their signature is on the locking transaction) */
    creatorLockedPct: number;
    /** % of the minted supply burned since launch; null when the launch supply is unknown (only plain pump.fun coins mint exactly a billion) */
    burnedPct: number | null;
  };
  snipers: { wallets: string[]; boughtPct: number; holdingPct: number; windowSlots: number };
  bundles: { groups: number; wallets: number; boughtPct: number; largestGroup: number; /** % of supply the bundle wallets still hold */ heldPct: number };
  linked: { clusters: Array<{ funder: string; wallets: string[]; pct: number; viaCreator: boolean }>; linkedPct: number; linkedToCreatorPct: number; checked: number; /** traced wallets whose first funder is a named exchange or launcher, with the name */ exchangeFunded: Array<{ wallet: string; exchange: string }> };
  creator: { address: string | null; status: 'holding' | 'sold_some' | 'sold_all' | 'never_bought' | 'unknown'; holdingPct: number; /** % of supply the creator moved into a locker they signed for; counted as held, not sold */ lockedPct: number; boughtTokens: number; soldTokens: number; history: CreatorHistory | null };
  contract: { mintRevoked: boolean; freezeRevoked: boolean; transferFeeBps: number; permanentDelegate: boolean; transferHook: boolean; metadataMutable: boolean | null };
  liquidity: Liquidity;
  market: MarketData | null;
  /** where the proceeds went; null when the trace did not run */
  flows: FlowsSummary | null;
  flags: Flag[];
  /** 0 (certain rug) … 100 (nothing found) — deterministic baseline the judge agent starts from */
  baselineScore: number;
}
