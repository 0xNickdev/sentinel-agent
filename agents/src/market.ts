// Market-shape facts computed from the trade list. Deterministic, like the
// engine signals: the Market agent interprets these numbers, it never derives
// them. Lives here until the engine grows a price/volume adapter.
import type { TokenSnapshot } from '@sentinel/engine';

export interface MarketStats {
  trades: number;
  buys: number;
  sells: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  /** % of supply sold back since launch */
  soldPct: number;
  /** % of supply bought since launch */
  boughtPct: number;
  /** wallets with 5+ trades and what share of trade count they generate */
  repeatTraders: number;
  repeatTradeSharePct: number;
  /** wallets that both bought and sold inside the launch window */
  flippers: number;
  /** seconds between first and last observed trade */
  spanSeconds: number;
  /** trades in the first minute as % of all observed trades */
  firstMinuteSharePct: number;
  observedWindow: 'launch' | 'full';
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);

export function marketStats(snapshot: TokenSnapshot): MarketStats {
  const { trades } = snapshot;
  const supply = snapshot.mintInfo.supply || 1;
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');
  const byWallet = new Map<string, { n: number; bought: boolean; sold: boolean }>();
  for (const t of trades) {
    const w = byWallet.get(t.account) ?? { n: 0, bought: false, sold: false };
    w.n++;
    if (t.side === 'buy') w.bought = true; else w.sold = true;
    byWallet.set(t.account, w);
  }
  const repeat = [...byWallet.values()].filter(w => w.n >= 5);
  const ts = trades.map(t => t.timestamp).filter(t => t > 0);
  const first = ts.length ? Math.min(...ts) : 0, last = ts.length ? Math.max(...ts) : 0;
  return {
    trades: trades.length,
    buys: buys.length,
    sells: sells.length,
    uniqueBuyers: new Set(buys.map(t => t.account)).size,
    uniqueSellers: new Set(sells.map(t => t.account)).size,
    soldPct: pct(sells.reduce((s, t) => s + t.amount, 0), supply),
    boughtPct: pct(buys.reduce((s, t) => s + t.amount, 0), supply),
    repeatTraders: repeat.length,
    repeatTradeSharePct: pct(repeat.reduce((s, w) => s + w.n, 0), trades.length),
    flippers: [...byWallet.values()].filter(w => w.bought && w.sold).length,
    spanSeconds: last - first,
    firstMinuteSharePct: pct(trades.filter(t => t.timestamp > 0 && t.timestamp - first <= 60).length, trades.length),
    observedWindow: 'launch',
  };
}
