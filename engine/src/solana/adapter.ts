// Builds a TokenSnapshot for a Solana mint from plain RPC. Venue-agnostic:
// trades are reconstructed from token-balance deltas in the mint's own
// transaction history, so pump.fun, Raydium and Meteora all look the same.
// Everything is read-only; Sentinel never signs anything on Solana.

import { Connection, PublicKey, type ParsedAccountData, type ParsedTransactionWithMeta } from '@solana/web3.js';
import type { CreatorHistory, Holder, Liquidity, MarketData, MintInfo, TokenSnapshot, Trade } from '../types.js';
import { fetchMarket, liquidityFromMarket } from './dexscreener.js';
import { exchangeOf } from './exchanges.js';
import { heliusKeyFrom, traceOutflows } from './outflows.js';

/** Programs that hold tokens until a date. A bag in one of these is held, not sold, and not a whale either. */
export const LOCKERS: Record<string, string> = {
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: 'Streamflow',
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: 'Jupiter Lock',
  LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE: 'Raydium Locker',
};
/** self-owned escrows whose creating transaction is read per snapshot: two RPC calls each */
const MAX_LOCK_LOOKUPS = 5;

export interface AdapterOptions {
  rpcUrl: string;
  /** how many of the earliest signatures to walk for trades (launch window matters most) */
  maxSignatures?: number;
  /** wallets with this many signatures are hubs (exchanges, routers), never links */
  hubThreshold?: number;
  /** how many wallets to trace to their first funder */
  maxTrace?: number;
  /** getTransaction batch size (Shyft caps at 10) and pause between batches */
  batchSize?: number;
  batchDelayMs?: number;
  /** optional creator-history provider (indexer, our own DB, a partner API) */
  creatorHistory?: (creator: string) => Promise<CreatorHistory | null>;
  /** market adapter (default: Dexscreener public API); pass null to skip */
  market?: ((mint: string) => Promise<MarketData | null>) | null;
  /** trace SOL out of the creator and selling insiders (Helius Enhanced API); default on when rpcUrl carries a Helius api-key, else skipped */
  flows?: boolean;
  /** how many wallets the money-flow trace reads (creator first) */
  maxFlowWallets?: number;
  log?: (msg: string) => void;
}

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Run `fn` over `items` with at most `n` in flight — enough to hide RPC
// latency without tripping per-key rate limits.
async function pooled<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export class SolanaAdapter {
  private conn: Connection;
  private opts: Required<Omit<AdapterOptions, 'creatorHistory' | 'log' | 'market' | 'flows'>> & Pick<AdapterOptions, 'creatorHistory' | 'log' | 'market' | 'flows'>;

  constructor(opts: AdapterOptions) {
    this.conn = new Connection(opts.rpcUrl, 'confirmed');
    this.opts = { maxSignatures: 600, hubThreshold: 1000, maxTrace: 16, batchSize: 10, batchDelayMs: 60, maxFlowWallets: 8, ...opts };
  }

  /**
   * Fast path: mint authorities and extensions, top holders and the market view, read in parallel (no history walk,
   * no funder tracing, no money flow). About a second instead of tens; the launch, funding and creator lanes stay empty
   * and the caller must say so.
   */
  async quickSnapshot(mint: string): Promise<TokenSnapshot> {
    const pk = new PublicKey(mint);
    const marketFn = this.opts.market === null ? null : (this.opts.market ?? fetchMarket);
    const [mintInfo, market] = await Promise.all([
      this.readMint(pk),
      marketFn ? marketFn(mint).catch(() => null) : Promise.resolve(null),
    ]);
    // Some RPCs refuse the largest-accounts query on huge mints (USDC): answer without the holder lane, say so.
    const unavailable: string[] = [];
    const holders = await this.readHolders(pk, mintInfo.supply).catch(e => { this.opts.log?.(`quick holders: ${e instanceof Error ? e.message.slice(0, 80) : e}`); unavailable.push('holders'); return [] as Holder[]; });
    const liquidity = liquidityFromMarket(market, this.inferLiquidity(holders, mintInfo.supply));
    return { chain: 'solana', mint, creator: null, mintInfo, holders, trades: [], liquidity, creatorHistory: null, funders: {}, hubs: [], labels: {}, market, flows: null, at: Math.floor(Date.now() / 1000), ...(unavailable.length ? { unavailable } : {}) };
  }

  async snapshot(mint: string): Promise<TokenSnapshot> {
    const pk = new PublicKey(mint);
    const mintInfo = await this.readMint(pk);
    const marketFn = this.opts.market === null ? null : (this.opts.market ?? fetchMarket);
    const [holders, history, market] = await Promise.all([
      this.readHolders(pk, mintInfo.supply),
      this.readHistory(pk),
      marketFn ? marketFn(mint).catch(e => { this.opts.log?.(`market: ${e instanceof Error ? e.message : e}`); return null; }) : Promise.resolve(null),
    ]);
    const trades = this.tradesFrom(history.txs, mint, holders);
    const creator = history.creator;
    const liquidity = liquidityFromMarket(market, this.inferLiquidity(holders, mintInfo.supply));
    if (market) this.opts.log?.(`market: ${market.symbol ?? '?'} · $${market.liquidityUsd.toLocaleString('en-US')} liquidity in ${market.pairs} pools (${market.venues.join(', ')}) · fdv $${market.fdvUsd ? Math.round(market.fdvUsd).toLocaleString('en-US') : '?'} · 24h vol $${market.volume24hUsd.toLocaleString('en-US')}`);

    // trace top wallets + early buyers to their first funder
    const wallets = holders.filter(h => !h.isProgram).sort((a, b) => b.amount - a.amount).slice(0, 12).map(h => h.owner);
    const early = [...new Set(trades.filter(t => t.side === 'buy').slice(0, 20).map(t => t.account))];
    const toTrace = [...new Set([...wallets, ...early, ...(creator ? [creator] : [])])].filter(w => w !== creator || true).slice(0, this.opts.maxTrace + 1);
    const funders: Record<string, string | null> = {};
    const hubs = new Set<string>();
    await pooled(toTrace, 4, async (w) => {
      try {
        const r = await this.firstFunder(w);
        funders[w] = r.funder;
        if (r.isHub) hubs.add(w);
      } catch { funders[w] = null; }
    });
    const labels: Record<string, string> = {};
    await pooled([...new Set(Object.values(funders).filter((x): x is string => !!x))], 4, async (f) => {
      const name = exchangeOf(f);
      if (name) { labels[f] = name; hubs.add(f); return; }
      if (await this.isHub(f).catch(() => true)) hubs.add(f);
    });

    const creatorHistory = creator && this.opts.creatorHistory ? await this.opts.creatorHistory(creator).catch(() => null) : null;
    const flows = await this.traceFlows(creator, trades, funders, labels, hubs);
    return { chain: 'solana', mint, creator, mintInfo, holders, trades, liquidity, creatorHistory, funders, hubs: [...hubs], labels, market, flows, at: Math.floor(Date.now() / 1000) };
  }

  // ── Money flow: SOL out of the creator and selling insiders after their last sell ──
  // Needs a Helius key (the enhanced API parses native transfers and filters by
  // time). Null when there is none or the trace is off; a failure never fails the snapshot.
  private async traceFlows(creator: string | null, trades: Trade[], funders: Record<string, string | null>, labels: Record<string, string>, hubs: Set<string>) {
    const apiKey = heliusKeyFrom(this.opts.rpcUrl);
    if (this.opts.flows === false || !apiKey) return null;
    const lastSell = new Map<string, number>();
    for (const t of trades) if (t.side === 'sell' && t.timestamp) lastSell.set(t.account, Math.max(lastSell.get(t.account) ?? 0, t.timestamp));
    if (!lastSell.size) return [];
    // the creator first, then wallets the creator funded, then the earliest buyers: only those that sold
    const early = [...new Set(trades.filter(t => t.side === 'buy').slice(0, 20).map(t => t.account))];
    const linked = Object.entries(funders).filter(([, f]) => creator && f === creator).map(([w]) => w);
    const order = [...new Set([...(creator ? [creator] : []), ...linked, ...early])].filter(w => lastSell.has(w) && !hubs.has(w)).slice(0, this.opts.maxFlowWallets);
    if (!order.length) return [];
    try {
      const trails = await traceOutflows(order.map(w => ({ wallet: w, since: lastSell.get(w)! })), {
        apiKey, creator, creatorFunder: creator ? funders[creator] ?? null : null, labels, ...(this.opts.log ? { log: this.opts.log } : {}),
      });
      this.opts.log?.(`flows: ${order.length} wallets traced, ${trails.length} trails, ${trails.filter(t => t.endsAt === 'exchange').reduce((s, t) => s + t.totalSol, 0).toFixed(2)} SOL to exchanges`);
      return trails;
    } catch (e) {
      this.opts.log?.(`flows: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // ── Mint ───────────────────────────────────────────────────────────────
  async readMint(mint: PublicKey): Promise<MintInfo> {
    const info = await this.conn.getParsedAccountInfo(mint);
    const data = info.value?.data as ParsedAccountData | undefined;
    const parsed = data?.parsed?.info;
    if (!parsed) throw new Error(`not a token mint: ${mint.toBase58()}`);
    const decimals = Number(parsed.decimals ?? 0);
    const ext = (parsed.extensions ?? []) as Array<{ extension: string; state?: Record<string, unknown> }>;
    const find = (name: string) => ext.find(e => e.extension === name)?.state;
    const fee = find('transferFeeConfig') as { newerTransferFee?: { transferFeeBasisPoints?: number } } | undefined;
    const isToken2022 = info.value?.owner.toBase58() === TOKEN_2022;
    const out: MintInfo = {
      decimals,
      supply: Number(parsed.supply ?? 0) / 10 ** decimals,
      mintAuthority: parsed.mintAuthority ?? null,
      freezeAuthority: parsed.freezeAuthority ?? null,
      metadataMutable: (find('tokenMetadata') as { updateAuthority?: string } | undefined)?.updateAuthority ? true : null,
    };
    if (isToken2022) {
      out.extensions = {
        transferFeeBps: fee?.newerTransferFee?.transferFeeBasisPoints ?? 0,
        permanentDelegate: (find('permanentDelegate') as { delegate?: string } | undefined)?.delegate ?? null,
        transferHook: (find('transferHook') as { programId?: string } | undefined)?.programId ?? null,
        nonTransferable: Boolean(find('nonTransferable')),
        defaultAccountFrozen: (find('defaultAccountState') as { accountState?: string } | undefined)?.accountState === 'frozen',
      };
    }
    return out;
  }

  // ── Holders (largest 20 token accounts, grouped by owner) ──────────────
  async readHolders(mint: PublicKey, supply: number): Promise<Holder[]> {
    const largest = await this.conn.getTokenLargestAccounts(mint);
    const accounts = largest.value.filter(a => Number(a.uiAmount ?? 0) > 0);
    if (!accounts.length) return [];
    const infos = await this.conn.getMultipleParsedAccounts(accounts.map(a => a.address));
    const owners = accounts.map((_, i) => (infos.value[i]?.data as ParsedAccountData | undefined)?.parsed?.info?.owner as string | undefined);
    const locks = await this.readLocks(accounts.map(a => a.address.toBase58()), owners);
    const byOwner = new Map<string, Holder>();
    accounts.forEach((a, i) => {
      const owner = owners[i];
      if (!owner) return;
      const prev = byOwner.get(owner);
      const lock = locks.get(a.address.toBase58()) ?? prev?.lock;
      byOwner.set(owner, { owner, amount: (prev?.amount ?? 0) + Number(a.uiAmount ?? 0), isProgram: !PublicKey.isOnCurve(new PublicKey(owner).toBytes()), ...(lock ? { lock } : {}) });
    });
    void supply;
    return [...byOwner.values()].sort((a, b) => b.amount - a.amount);
  }

  // Token lockers among the largest accounts: an account whose owner is owned by a locker program, or a self-owned escrow
  // (Streamflow's escrow owns itself, so its owner names no program) whose creating transaction a locker took part in.
  // The signers of that transaction say whose lock it is. Ported from aiagentzoo X-Ray (apps/node/src/chain/holders.ts).
  private async readLocks(accounts: string[], owners: Array<string | undefined>): Promise<Map<string, NonNullable<Holder['lock']>>> {
    const out = new Map<string, NonNullable<Holder['lock']>>();
    const uniq = [...new Set(owners.filter((o): o is string => Boolean(o)))];
    if (!uniq.length) return out;
    let ownerPrograms = new Map<string, string>();
    try {
      const infos = await this.conn.getMultipleAccountsInfo(uniq.map(o => new PublicKey(o)));
      ownerPrograms = new Map(uniq.map((o, i) => [o, infos[i]?.owner.toBase58() ?? '']));
    } catch (e) { this.opts.log?.(`locks: owners ${e instanceof Error ? e.message : e}`); return out; }
    let lookups = 0;
    for (const [i, account] of accounts.entries()) {
      const owner = owners[i];
      if (!owner) continue;
      const program = LOCKERS[ownerPrograms.get(owner) ?? ''];
      if (program) { out.set(account, { program, lockedBy: [] }); continue; }
      if (owner !== account || lookups >= MAX_LOCK_LOOKUPS) continue;
      lookups++;
      try {
        const sigs = await this.conn.getSignaturesForAddress(new PublicKey(account), { limit: 50 });
        const first = sigs.at(-1)?.signature;
        if (!first) continue;
        const tx = await this.conn.getParsedTransaction(first, { maxSupportedTransactionVersion: 1 });
        const keys = tx?.transaction.message.accountKeys ?? [];
        const locker = keys.map(k => LOCKERS[k.pubkey.toBase58()]).find(Boolean);
        if (locker) out.set(account, { program: locker, lockedBy: keys.filter(k => k.signer).map(k => k.pubkey.toBase58()) });
      } catch (e) { this.opts.log?.(`locks: ${account.slice(0, 4)}… ${e instanceof Error ? e.message : e}`); }
    }
    if (out.size) this.opts.log?.(`locks: ${out.size} locked account${out.size === 1 ? '' : 's'} (${[...new Set([...out.values()].map(l => l.program))].join(', ')})`);
    return out;
  }

  // ── History: the earliest transactions touching the mint ───────────────
  private async readHistory(mint: PublicKey): Promise<{ txs: ParsedTransactionWithMeta[]; creator: string | null }> {
    // Walk signatures newest→oldest until we have the launch window.
    const all: { signature: string; slot: number }[] = [];
    let before: string | undefined;
    while (all.length < 5000) {
      const page = await this.conn.getSignaturesForAddress(mint, before ? { before, limit: 1000 } : { limit: 1000 });
      if (!page.length) break;
      all.push(...page.filter(s => !s.err).map(s => ({ signature: s.signature, slot: s.slot })));
      before = page[page.length - 1]!.signature;
      if (page.length < 1000) break;
    }
    const oldest = all.slice(-this.opts.maxSignatures).reverse();
    const txs: ParsedTransactionWithMeta[] = [];
    // Providers cap getTransaction batches (Shyft: 10), so stay small and polite.
    const B = this.opts.batchSize;
    for (let i = 0; i < oldest.length; i += B) {
      const batch = await this.conn.getParsedTransactions(oldest.slice(i, i + B).map(s => s.signature), { maxSupportedTransactionVersion: 1 });
      for (const tx of batch) if (tx) txs.push(tx);
      if (this.opts.batchDelayMs) await new Promise(r => setTimeout(r, this.opts.batchDelayMs));
    }
    // The creator is the fee payer of the mint's first transaction.
    const creator = txs[0]?.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
    this.opts.log?.(`history: ${all.length} signatures, parsed ${txs.length}, creator ${creator}`);
    return { txs, creator };
  }

  // Each tx: owners whose balance of this mint rose bought, fell sold.
  private tradesFrom(txs: ParsedTransactionWithMeta[], mint: string, holders: Holder[]): Trade[] {
    const programs = new Set(holders.filter(h => h.isProgram).map(h => h.owner));
    const out: Trade[] = [];
    for (const tx of txs) {
      const pre = new Map<string, number>(), post = new Map<string, number>();
      for (const b of tx.meta?.preTokenBalances ?? []) if (b.mint === mint && b.owner) pre.set(b.owner, (pre.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
      for (const b of tx.meta?.postTokenBalances ?? []) if (b.mint === mint && b.owner) post.set(b.owner, (post.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
      for (const owner of new Set([...pre.keys(), ...post.keys()])) {
        if (programs.has(owner) || !PublicKey.isOnCurve(new PublicKey(owner).toBytes())) continue;
        const delta = (post.get(owner) ?? 0) - (pre.get(owner) ?? 0);
        if (Math.abs(delta) < 1e-9) continue;
        out.push({ account: owner, side: delta > 0 ? 'buy' : 'sell', amount: Math.abs(delta), slot: tx.slot, timestamp: tx.blockTime ?? 0 });
      }
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  private inferLiquidity(holders: Holder[], supply: number): Liquidity {
    const program = holders.filter(h => h.isProgram).reduce((s, h) => s + h.amount, 0);
    const pct = supply ? (program / supply) * 100 : 0;
    // Curve-held supply reads as a launchpad; a real AMM pool vault needs the
    // venue adapter (Meteora / Raydium) to say whether LP is burned or locked.
    return pct > 20 ? { kind: 'bonding_curve', lockedPct: 100, quoteReserve: null, curveProgressPct: null } : { kind: 'unknown', lockedPct: null, quoteReserve: null };
  }

  // ── Funding graph helpers ──────────────────────────────────────────────
  async firstFunder(wallet: string): Promise<{ funder: string | null; isHub: boolean }> {
    const sigs = await this.conn.getSignaturesForAddress(new PublicKey(wallet), { limit: this.opts.hubThreshold });
    if (!sigs.length) return { funder: null, isHub: false };
    if (sigs.length >= this.opts.hubThreshold) return { funder: null, isHub: true };
    for (const info of sigs.slice(-3).reverse()) {
      const tx = await this.conn.getParsedTransaction(info.signature, { maxSupportedTransactionVersion: 1 });
      const keys = tx?.transaction.message.accountKeys.map(k => k.pubkey.toBase58()) ?? [];
      const pre = tx?.meta?.preBalances ?? [], post = tx?.meta?.postBalances ?? [];
      const self = keys.indexOf(wallet);
      if (self < 0 || (post[self] ?? 0) <= (pre[self] ?? 0)) continue;
      let funder: string | null = null, drop = 0;
      keys.forEach((k, i) => { const d = (pre[i] ?? 0) - (post[i] ?? 0); if (k !== wallet && d > drop) { drop = d; funder = k; } });
      return { funder, isHub: false };
    }
    return { funder: null, isHub: false };
  }

  async isHub(address: string): Promise<boolean> {
    const sigs = await this.conn.getSignaturesForAddress(new PublicKey(address), { limit: this.opts.hubThreshold });
    return sigs.length >= this.opts.hubThreshold;
  }
}
