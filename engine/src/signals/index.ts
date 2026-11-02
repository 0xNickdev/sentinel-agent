// Pure signal computations over a TokenSnapshot. Thresholds are the ones
// that held up on live launchpad data; each one is named so the judge agent
// and the audit record can cite it.

import type { Evidence, Flag, Holder, TokenSnapshot, Trade } from '../types.js';
import { exchangeOf } from '../solana/exchanges.js';
import { summarizeFlows } from '../solana/outflows.js';

export const THRESHOLDS = {
  sniperWindowSlots: 3,          // ≈1.2 s after the first buy on Solana
  bundleWindowSlots: 150,        // ≈1 min: coordinated launch buys, not organic same-slot traffic
  top10ConcentratedPct: 40,
  heavyBundlesPct: 20,
  snipersHoldingPct: 10,
  linkedWalletsPct: 15,
  creatorLinkedPct: 5,
  maxTraceWallets: 16,
  transferFeeWarnBps: 100,
  lpUnlockedWarnPct: 50,
  // market: a pool that cannot absorb a sell is an exit that already closed
  drainedLiquidityUsd: 25_000,  // below this, and …
  drainedFdvToLiquidity: 100,   // … market cap more than 100× the pool = drained
  thinLiquidityUsd: 10_000,
  deadVolume24hUsd: 1_000,
  deadAfterDays: 7,
  collapse24hPct: -60,
  // money flow: proceeds = SOL the creator sent on after the last sell (Helius trace)
  cashedOutPct: 50,              // more than this share of the creator's outflow reached an exchange
  // dev gone, holders carry it (aiagentzoo X-Ray DEV_GONE, 34k graded pump.fun launches): a creator who sold ≥80% and holds <1%
  // of a graduated token that grew and spread out stops being the reason to avoid it; the exit is a fact, not a forecast
  devGoneSoldPct: 80,
  devGoneHeldPct: 1,
  devGoneMinAgeHours: 2,
  devGoneLiquidityUsd: 40_000,   // about twice what a pump.fun pool opens with (85 SOL)
  devGoneTop10Pct: 30,
  devGoneTopWalletPct: 10,
  devGoneInsidersHeldPct: 20,    // snipers or bundlers still holding more than this means the launch crew never left
  bundleSoldPct: 66.7,           // a launch bundle is a note while it holds, a warning once it sold two thirds (bundled launches ran 4x as often)
  bundleHeavyHeldPct: 30,        // unless the bundle wallets still hold this much of the supply
  lockedNotePct: 0.5,
  burnedNotePct: 1,
  cashedOutMinSol: 1,            // … and at least this much SOL, so a dust sweep is not an exit
  funderBackMinSol: 0.5,
} as const;

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ── Holders ──────────────────────────────────────────────────────────────
export function holderStats(holders: Holder[], supply: number, creator: string | null, snipers: Set<string>, burnedPct: number | null = null) {
  const wallets = holders.filter(h => !h.isProgram).sort((a, b) => b.amount - a.amount);
  const top10Pct = wallets.slice(0, 10).reduce((s, h) => s + pct(h.amount, supply), 0);
  const locked = holders.filter(h => h.lock);
  return {
    top: wallets.slice(0, 10).map(h => ({ owner: h.owner, pct: round(pct(h.amount, supply)), isCreator: h.owner === creator, isSniper: snipers.has(h.owner) })),
    top10Pct: round(top10Pct),
    programHeldPct: round(holders.filter(h => h.isProgram).reduce((s, h) => s + pct(h.amount, supply), 0)),
    lockedPct: round(locked.reduce((s, h) => s + pct(h.amount, supply), 0)),
    creatorLockedPct: round(creatorLockedAmount(holders, creator) / (supply || 1) * 100),
    burnedPct,
    count: wallets.length,
  };
}

/** Tokens the creator put into a locker themselves: their signature is on the transaction that made the escrow. */
export function creatorLockedAmount(holders: Holder[], creator: string | null): number {
  if (!creator) return 0;
  return holders.filter(h => h.lock?.lockedBy.includes(creator)).reduce((s, h) => s + h.amount, 0);
}

/** A plain pump.fun coin mints exactly a billion (CreateV2); whatever is missing now was burned. Other venues: unknown. */
export const PUMP_SUPPLY = 1_000_000_000;
export function burnedPct(snapshot: Pick<TokenSnapshot, 'mint' | 'mintInfo' | 'liquidity'>): number | null {
  const pump = snapshot.liquidity.venue?.toLowerCase().includes('pump') || snapshot.mint.endsWith('pump');
  if (!pump || snapshot.mintInfo.decimals !== 6 || snapshot.mintInfo.supply > PUMP_SUPPLY) return null;
  return round(((PUMP_SUPPLY - snapshot.mintInfo.supply) / PUMP_SUPPLY) * 100);
}

// ── Snipers: buyers (not the creator) inside the first slots of trading ──
export function sniperStats(trades: Trade[], holders: Holder[], supply: number, creator: string | null) {
  const buys = trades.filter(t => t.side === 'buy').sort((a, b) => a.slot - b.slot || a.timestamp - b.timestamp);
  const first = buys[0]?.slot;
  const set = new Map<string, number>();
  if (first != null) {
    for (const t of buys) {
      if (t.slot > first + THRESHOLDS.sniperWindowSlots) break;
      if (t.account !== creator) set.set(t.account, (set.get(t.account) ?? 0) + t.amount);
    }
  }
  const held = new Map(holders.map(h => [h.owner, h.amount]));
  const bought = [...set.values()].reduce((s, a) => s + a, 0);
  const holding = [...set.keys()].reduce((s, w) => s + (held.get(w) ?? 0), 0);
  return { wallets: [...set.keys()], boughtPct: round(pct(bought, supply)), holdingPct: round(pct(holding, supply)), windowSlots: THRESHOLDS.sniperWindowSlots };
}

// ── Bundles: several wallets buying in the same slot (or the same bundle id)
export function bundleStats(trades: Trade[], supply: number, holders: Holder[] = []) {
  const groups = new Map<string, { wallets: Set<string>; amount: number }>();
  const first = trades.filter(t => t.side === 'buy').reduce((m, t) => Math.min(m, t.slot), Infinity);
  for (const t of trades) {
    if (t.side !== 'buy' || t.slot > first + THRESHOLDS.bundleWindowSlots) continue;
    const key = t.bundleId ?? `slot:${t.slot}`;
    const g = groups.get(key) ?? { wallets: new Set<string>(), amount: 0 };
    g.wallets.add(t.account);
    g.amount += t.amount;
    groups.set(key, g);
  }
  const bundles = [...groups.values()].filter(g => g.wallets.size >= 2);
  const members = new Set(bundles.flatMap(g => [...g.wallets]));
  const held = holders.filter(h => members.has(h.owner)).reduce((s, h) => s + h.amount, 0);
  return {
    groups: bundles.length,
    wallets: members.size,
    boughtPct: round(pct(bundles.reduce((s, g) => s + g.amount, 0), supply)),
    largestGroup: bundles.reduce((m, g) => Math.max(m, g.wallets.size), 0),
    heldPct: round(pct(held, supply)),
  };
}

// ── Funding graph: wallets that share a first funder, or sit in the creator's circle
export function linkedStats(snapshot: TokenSnapshot, traced: Map<string, number>) {
  const { creator, funders, hubs } = snapshot;
  const supply = snapshot.mintInfo.supply || 1;
  const hubSet = new Set(hubs);
  const nameOf = (w: string) => snapshot.labels?.[w] ?? exchangeOf(w);
  const exchangeFunded: Array<{ wallet: string; exchange: string }> = [];
  for (const [w] of traced) { const f = funders[w]; const name = f ? nameOf(f) : null; if (f && name) { hubSet.add(f); exchangeFunded.push({ wallet: w, exchange: name }); } }
  const creatorFunder = creator ? funders[creator] ?? null : null;
  const groups = new Map<string, string[]>();
  let checked = 0;
  for (const [w] of traced) {
    if (!(w in funders)) continue;
    checked++;
    const f = funders[w];
    if (!f) continue;
    const viaCreator = creator != null && (f === creator || (creatorFunder != null && f === creatorFunder));
    const key = viaCreator ? `creator:${creator}` : f;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  const clusters = [...groups.entries()].flatMap(([key, wallets]) => {
    const viaCreator = key.startsWith('creator:');
    if (!viaCreator && (wallets.length < 2 || hubSet.has(key))) return [];
    const held = wallets.reduce((s, w) => s + (traced.get(w) ?? 0), 0);
    return [{ funder: viaCreator ? creator! : key, wallets, pct: round(pct(held, supply)), viaCreator }];
  }).sort((a, b) => b.pct - a.pct);
  return {
    clusters,
    linkedPct: round(clusters.reduce((s, c) => s + c.pct, 0)),
    linkedToCreatorPct: round(clusters.filter(c => c.viaCreator).reduce((s, c) => s + c.pct, 0)),
    checked,
    exchangeFunded,
  };
}

// ── Creator behaviour on this token
export function creatorStats(snapshot: TokenSnapshot) {
  const { creator, trades, holders } = snapshot;
  const supply = snapshot.mintInfo.supply || 1;
  if (!creator) return { address: null, status: 'unknown' as const, holdingPct: 0, lockedPct: 0, boughtTokens: 0, soldTokens: 0, history: null };
  const bought = trades.filter(t => t.account === creator && t.side === 'buy').reduce((s, t) => s + t.amount, 0);
  // A bag moved into a locker the creator signed for leaves their wallet like a sell does, but it is not one: it is held until its date.
  const locked = creatorLockedAmount(holders, creator);
  const sold = Math.max(0, trades.filter(t => t.account === creator && t.side === 'sell').reduce((s, t) => s + t.amount, 0) - locked);
  const balance = holders.filter(h => h.owner === creator).reduce((s, h) => s + h.amount, 0) + locked;
  const status: 'never_bought' | 'sold_all' | 'sold_some' | 'holding' = bought === 0 && balance === 0 ? 'never_bought' : bought > 0 && balance === 0 ? 'sold_all' : sold > 0 ? 'sold_some' : 'holding';
  const proof = snapshot.creatorProof && snapshot.creatorProof.wallet === creator ? snapshot.creatorProof : null;
  return { address: creator, status, holdingPct: round(pct(balance, supply)), lockedPct: round(pct(locked, supply)), boughtTokens: bought, soldTokens: sold, history: snapshot.creatorHistory, ...(proof ? { proof } : {}) };
}

// ── Contract-level facts
export function contractStats(snapshot: TokenSnapshot) {
  const m = snapshot.mintInfo;
  return {
    mintRevoked: !m.mintAuthority,
    freezeRevoked: !m.freezeAuthority,
    transferFeeBps: m.extensions?.transferFeeBps ?? 0,
    permanentDelegate: Boolean(m.extensions?.permanentDelegate),
    transferHook: Boolean(m.extensions?.transferHook),
    metadataMutable: m.metadataMutable ?? null,
  };
}

// ── Money flow: where the proceeds went after the sell (null when the trace did not run)
export function flowStats(snapshot: TokenSnapshot): Evidence['flows'] {
  const trails = snapshot.flows;
  if (trails == null) return null;
  const traced = new Set(trails.map(t => t.from)).size;
  const starts = trails.map(t => t.hops[0]?.at ?? snapshot.at);
  const ends = trails.flatMap(t => t.hops.map(h => h.at));
  const window = { from: starts.length ? Math.min(...starts) : snapshot.at, to: ends.length ? Math.max(...ends) : snapshot.at };
  return summarizeFlows([...trails].sort((a, b) => b.totalSol - a.totalSol || a.from.localeCompare(b.from)), traced, window);
}

// ── Flags + baseline score ───────────────────────────────────────────────
export function deriveFlags(e: Omit<Evidence, 'flags' | 'baselineScore'> & { at: number }): Flag[] {
  const f: Flag[] = [];
  const add = (code: string, severity: Flag['severity'], message: string, evidence: Flag['evidence']) => f.push({ code, severity, message, evidence });
  const c = e.contract;
  if (!c.mintRevoked) add('mint_authority_live', 'critical', 'Mint authority is still active: supply can be inflated at will.', { mintRevoked: false });
  if (!c.freezeRevoked) add('freeze_authority_live', 'critical', 'Freeze authority is still active: holders can be frozen out of selling.', { freezeRevoked: false });
  if (c.permanentDelegate) add('permanent_delegate', 'critical', 'A permanent delegate can move tokens out of any wallet.', { permanentDelegate: true });
  if (c.transferHook) add('transfer_hook', 'warn', 'A transfer hook program runs on every transfer and can block sells.', { transferHook: true });
  if (c.transferFeeBps >= THRESHOLDS.transferFeeWarnBps) add('transfer_fee', 'warn', `Every transfer is taxed ${c.transferFeeBps / 100}%.`, { transferFeeBps: c.transferFeeBps });
  if (e.liquidity.kind === 'amm' && e.liquidity.lockedPct != null && e.liquidity.lockedPct < THRESHOLDS.lpUnlockedWarnPct)
    add('lp_pullable', 'critical', `Only ${e.liquidity.lockedPct}% of liquidity is locked or burned.`, { lockedPct: e.liquidity.lockedPct });
  if (e.creator.status === 'sold_all') add('creator_sold_all', 'critical', 'The creator sold their entire position.', { soldTokens: e.creator.soldTokens });
  else if (e.creator.status === 'sold_some') add('creator_sold', 'warn', 'The creator has been selling.', { soldTokens: e.creator.soldTokens, holdingPct: e.creator.holdingPct });
  if (e.creator.lockedPct >= THRESHOLDS.lockedNotePct) add('creator_locked', 'info', `The creator locked ${e.creator.lockedPct}% of the supply in a token locker until its date.`, { lockedPct: e.creator.lockedPct });
  else if (e.holders.lockedPct >= THRESHOLDS.lockedNotePct) add('supply_locked', 'info', `${e.holders.lockedPct}% of the supply sits in a token locker until its date.`, { lockedPct: e.holders.lockedPct });
  if (e.holders.burnedPct != null && e.holders.burnedPct >= THRESHOLDS.burnedNotePct) add('supply_burned', 'info', `${e.holders.burnedPct}% of the minted supply has been burned.`, { burnedPct: e.holders.burnedPct });
  if (e.holders.top10Pct > THRESHOLDS.top10ConcentratedPct) add('top10_concentrated', 'warn', `Top 10 wallets hold ${e.holders.top10Pct}% of supply.`, { top10Pct: e.holders.top10Pct });
  if (e.bundles.boughtPct > THRESHOLDS.heavyBundlesPct) {
    // Wallets buying together at launch is not a red flag by itself: bundled launches ran four times as often (34,183 pump.fun
    // launches, aiagentzoo X-Ray, 2026-10-28). It is one once the bundle has sold most of it, or still sits on a large share.
    const soldPct = round(Math.max(0, 100 - (e.bundles.heldPct / e.bundles.boughtPct) * 100));
    const ev = { boughtPct: e.bundles.boughtPct, heldPct: e.bundles.heldPct, soldPct, groups: e.bundles.groups, wallets: e.bundles.wallets };
    if (soldPct >= THRESHOLDS.bundleSoldPct) add('heavy_bundles', 'warn', `${e.bundles.wallets} wallets bought ${e.bundles.boughtPct}% of supply in launch bundles and have sold ${soldPct}% of it.`, ev);
    else if (e.bundles.heldPct >= THRESHOLDS.bundleHeavyHeldPct) add('heavy_bundles', 'warn', `${e.bundles.wallets} wallets bought ${e.bundles.boughtPct}% of supply in launch bundles and still hold ${e.bundles.heldPct}% of the supply together.`, ev);
    else add('heavy_bundles', 'info', `${e.bundles.wallets} wallets bought ${e.bundles.boughtPct}% of supply in launch bundles; they still hold ${e.bundles.heldPct}%.`, ev);
  }
  if (e.snipers.holdingPct > THRESHOLDS.snipersHoldingPct) add('snipers_holding', 'warn', `Snipers still hold ${e.snipers.holdingPct}% of supply.`, { holdingPct: e.snipers.holdingPct, wallets: e.snipers.wallets.length });
  if (e.linked.linkedPct > THRESHOLDS.linkedWalletsPct) add('linked_wallets', 'warn', `Wallets funded from the same sources hold ${e.linked.linkedPct}%.`, { linkedPct: e.linked.linkedPct, clusters: e.linked.clusters.length });
  if (e.linked.linkedToCreatorPct > THRESHOLDS.creatorLinkedPct) add('creator_circle', 'critical', `Wallets funded by the creator hold ${e.linked.linkedToCreatorPct}% of supply.`, { linkedToCreatorPct: e.linked.linkedToCreatorPct });
  const h = e.creator.history;
  if (h && h.rugged > 0) add('serial_rugger', h.rugged >= 2 ? 'critical' : 'warn', `${h.rugged} of the creator's ${h.launched} previous tokens rugged.`, { rugged: h.rugged, launched: h.launched });
  if (h && h.socialReusedBy > 0) add('social_reused', 'warn', `The same social handle was used by ${h.socialReusedBy} other tokens.`, { socialReusedBy: h.socialReusedBy });
  if (e.creator.proof) add('verified_creator', 'info', `A verified human (Concordium ID, ${e.creator.proof.claims.join(', ')}) signed for this creator wallet; no personal data was shared.`, { verifiedHuman: true, auditTx: e.creator.proof.auditTx, requestTx: e.creator.proof.requestTx, verifiedAt: e.creator.proof.verifiedAt });
  else if (h?.verifiedHuman) add('verified_creator', 'info', 'A verified human (Concordium ID) stands behind this creator.', { verifiedHuman: true });
  const m = e.market;
  if (m) {
    const ratio = m.fdvUsd && m.liquidityUsd > 0 ? m.fdvUsd / m.liquidityUsd : null;
    const ageDays = m.oldestPairAt ? (e.at - m.oldestPairAt) / 86_400 : null;
    if (m.liquidityUsd < THRESHOLDS.drainedLiquidityUsd && ratio != null && ratio > THRESHOLDS.drainedFdvToLiquidity)
      add('liquidity_drained', 'critical', `Only $${m.liquidityUsd.toLocaleString('en-US')} of liquidity backs a $${Math.round(m.fdvUsd!).toLocaleString('en-US')} market cap: the exit door is closed.`, { liquidityUsd: m.liquidityUsd, fdvUsd: m.fdvUsd, fdvToLiquidity: Math.round(ratio) });
    else if (m.liquidityUsd < THRESHOLDS.thinLiquidityUsd && !m.onCurve)
      add('thin_liquidity', 'warn', `Only $${m.liquidityUsd.toLocaleString('en-US')} of liquidity across ${m.pairs} pool${m.pairs === 1 ? '' : 's'}.`, { liquidityUsd: m.liquidityUsd, pairs: m.pairs });
    if (ageDays != null && ageDays > THRESHOLDS.deadAfterDays && m.volume24hUsd < THRESHOLDS.deadVolume24hUsd)
      add('volume_dead', 'warn', `$${m.volume24hUsd.toLocaleString('en-US')} traded in 24h on a token ${Math.round(ageDays)} days old.`, { volume24hUsd: m.volume24hUsd, txns24h: m.txns24h, ageDays: Math.round(ageDays) });
    if (m.priceChangePct.h24 != null && m.priceChangePct.h24 < THRESHOLDS.collapse24hPct)
      add('price_collapse', 'warn', `Price fell ${Math.abs(m.priceChangePct.h24)}% in 24h.`, { h24: m.priceChangePct.h24 });
  }
  const fl = e.flows;
  if (fl && e.creator.address) {
    const sold = e.creator.status === 'sold_all' || e.creator.status === 'sold_some';
    const mine = fl.trails.filter(t => t.from === e.creator.address);
    const out = mine.reduce((s, t) => s + t.totalSol, 0);
    const toExchange = mine.filter(t => t.endsAt === 'exchange').reduce((s, t) => s + t.totalSol, 0);
    const share = out > 0 ? round((toExchange / out) * 100) : 0;
    if (sold && toExchange >= THRESHOLDS.cashedOutMinSol && share > THRESHOLDS.cashedOutPct) {
      const names = [...new Set(mine.filter(t => t.endsAt === 'exchange').map(t => t.hops[t.hops.length - 1]?.label ?? 'exchange'))];
      add('dev_cashed_out', 'critical', `The creator sold and moved ${round(toExchange)} SOL (${share}% of what left the wallet) to ${names.join(', ')} within ${Math.round((fl.window.to - fl.window.from) / 3600) || 1}h.`, { toExchangeSol: round(toExchange), outflowSol: round(out), sharePct: share, exchanges: names.join(', ') });
    }
    // Only the creator's and their crew's SOL counts: an early buyer sending its own money round a loop is not where the launch's money went.
    const circle = new Set([e.creator.address, ...e.linked.clusters.filter(c => c.viaCreator).flatMap(c => c.wallets)]);
    const toFunder = round(fl.trails.filter(t => circle.has(t.from) && t.hops.some(h => h.kind === 'funder')).reduce((s, t) => s + t.totalSol, 0));
    if (toFunder >= THRESHOLDS.funderBackMinSol)
      add('proceeds_to_funder', 'warn', `${toFunder} SOL went back to the wallet that funded the creator.`, { toFunderSol: toFunder });
  }
  // Dev gone, holders carry it: the creator sold out of a graduated token that has since grown and spread out. Their exit is on
  // the record (creator_sold_all / dev_cashed_out stay), but it is no longer the reason to avoid the token today.
  const mk = e.market;
  if (mk && e.creator.address && !mk.onCurve && !f.some(x => x.code === 'liquidity_drained')) {
    const ageHours = mk.oldestPairAt ? (e.at - mk.oldestPairAt) / 3600 : null;
    const soldPct = e.creator.boughtTokens > 0 ? (e.creator.soldTokens / e.creator.boughtTokens) * 100 : 0;
    const gone = (e.creator.status === 'sold_all' || (soldPct >= THRESHOLDS.devGoneSoldPct && e.creator.holdingPct < THRESHOLDS.devGoneHeldPct))
      && ageHours != null && ageHours >= THRESHOLDS.devGoneMinAgeHours
      && mk.liquidityUsd >= THRESHOLDS.devGoneLiquidityUsd
      && e.holders.top10Pct < THRESHOLDS.devGoneTop10Pct && (e.holders.top[0]?.pct ?? 0) < THRESHOLDS.devGoneTopWalletPct
      && e.snipers.holdingPct < THRESHOLDS.devGoneInsidersHeldPct && e.bundles.heldPct < THRESHOLDS.devGoneInsidersHeldPct;
    if (gone) add('dev_gone', 'info', `The creator sold out and left; ${Math.round(ageHours!)}h on, $${Math.round(mk.liquidityUsd).toLocaleString('en-US')} of liquidity backs it and the top 10 hold ${e.holders.top10Pct}%: the holders carry it now.`, { ageHours: Math.round(ageHours!), liquidityUsd: Math.round(mk.liquidityUsd), top10Pct: e.holders.top10Pct, creatorHoldingPct: e.creator.holdingPct });
  }
  return f;
}

export function baselineScore(flags: Flag[]): number {
  let score = 100;
  for (const f of flags) score -= f.severity === 'critical' ? 35 : f.severity === 'warn' ? 12 : f.code === 'verified_creator' ? -8 : 0;
  return Math.max(0, Math.min(100, score));
}

// ── Assembly ─────────────────────────────────────────────────────────────
export function analyze(snapshot: TokenSnapshot): Evidence {
  const supply = snapshot.mintInfo.supply || 1;
  const snipers = sniperStats(snapshot.trades, snapshot.holders, supply, snapshot.creator);
  const sniperSet = new Set(snipers.wallets);
  const holders = holderStats(snapshot.holders, supply, snapshot.creator, sniperSet, burnedPct(snapshot));
  const bundles = bundleStats(snapshot.trades, supply, snapshot.holders);
  const traced = new Map<string, number>();
  const held = new Map(snapshot.holders.map(h => [h.owner, h.amount]));
  for (const h of holders.top) if (h.owner !== snapshot.creator) traced.set(h.owner, held.get(h.owner) ?? 0);
  for (const w of snipers.wallets) if (w !== snapshot.creator && !traced.has(w) && traced.size < THRESHOLDS.maxTraceWallets) traced.set(w, held.get(w) ?? 0);
  const linked = linkedStats(snapshot, traced);
  const creator = creatorStats(snapshot);
  const contract = contractStats(snapshot);
  const partial = { holders, snipers, bundles, linked, creator, contract, liquidity: snapshot.liquidity, market: snapshot.market ?? null, flows: flowStats(snapshot) };
  const flags = deriveFlags({ ...partial, at: snapshot.at });
  return { ...partial, flags, baselineScore: baselineScore(flags) };
}
