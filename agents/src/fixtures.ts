// Offline snapshots for tests and demos without RPC: the same two tokens the
// engine tests use, one clean launch and one textbook rug.
import type { TokenSnapshot } from '@sentinel/engine';

const SUPPLY = 1_000_000_000;
const w = (i: number) => `wallet${String(i).padStart(3, '0')}`;

export function cleanToken(): TokenSnapshot {
  return {
    chain: 'solana', mint: 'FixtureCleanMint1111111111111111111111111111', creator: 'creatorClean', at: 1_700_000_000,
    mintInfo: { decimals: 6, supply: SUPPLY, mintAuthority: null, freezeAuthority: null, metadataMutable: false },
    holders: [
      { owner: 'curveVault', amount: SUPPLY * 0.7, isProgram: true },
      ...Array.from({ length: 30 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.01 - i * 1000, isProgram: false })),
    ],
    trades: Array.from({ length: 30 }, (_, i) => ({ account: w(i), side: 'buy' as const, amount: SUPPLY * 0.01, slot: 100 + i * 5, timestamp: 1_700_000_000 + i * 2 })),
    liquidity: { kind: 'bonding_curve', lockedPct: 100, quoteReserve: 12, curveProgressPct: 30 },
    creatorHistory: { address: 'creatorClean', launched: 3, graduated: 2, rugged: 0, pastTokens: [], socialReusedBy: 0, verifiedHuman: true },
    funders: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [w(i), `cex${i % 7}`])),
    hubs: ['cex0', 'cex1', 'cex2', 'cex3', 'cex4', 'cex5', 'cex6'],
    market: {
      source: 'dexscreener', symbol: 'CLEAN', name: 'Clean Launch', priceUsd: 0.00004, liquidityUsd: 12_400, fdvUsd: 40_000, volume24hUsd: 58_000, txns24h: 912,
      priceChangePct: { h1: 4.2, h6: 18.5, h24: null }, pairs: 1, topVenue: 'pumpfun', venues: ['pumpfun'], oldestPairAt: 1_699_900_000, onCurve: true,
    },
    flows: [],
  };
}

export function rugToken(): TokenSnapshot {
  const s = cleanToken();
  s.mint = 'FixtureRugMint111111111111111111111111111111';
  s.creator = 'creatorRug';
  s.mintInfo.mintAuthority = 'creatorRug';
  s.mintInfo.freezeAuthority = 'creatorRug';
  s.creatorHistory = { address: 'creatorRug', launched: 6, graduated: 0, rugged: 4, pastTokens: [], socialReusedBy: 2 };
  // 8 wallets buy in the same slot at launch, all funded by the creator, holding 24%; creator sells everything
  s.trades = [
    { account: 'creatorRug', side: 'buy', amount: SUPPLY * 0.05, slot: 99, timestamp: 1_699_999_999 },
    ...Array.from({ length: 8 }, (_, i) => ({ account: w(i), side: 'buy' as const, amount: SUPPLY * 0.03, slot: 100, timestamp: 1_700_000_000 })),
    { account: 'creatorRug', side: 'sell', amount: SUPPLY * 0.05, slot: 400, timestamp: 1_700_000_100 },
  ];
  s.holders = [
    { owner: 'curveVault', amount: SUPPLY * 0.6, isProgram: true },
    ...Array.from({ length: 8 }, (_, i) => ({ owner: w(i), amount: SUPPLY * 0.03, isProgram: false })),
  ];
  s.funders = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [w(i), 'creatorRug']));
  s.market = {
    source: 'dexscreener', symbol: 'RUG', name: 'Textbook Rug', priceUsd: 0.000009, liquidityUsd: 2_100, fdvUsd: 9_000, volume24hUsd: 310, txns24h: 11,
    priceChangePct: { h1: -3.1, h6: -71.4, h24: null }, pairs: 1, topVenue: 'pumpfun', venues: ['pumpfun'], oldestPairAt: 1_699_999_000, onCurve: true,
  };
  // the creator's 12.4 SOL left for Binance within the hour; 0.8 SOL went back to the wallet that funded them
  s.funders['creatorRug'] = 'funderOfCreator';
  s.flows = [
    { from: 'creatorRug', hops: [{ to: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', lamports: 12_400_000_000, at: 1_700_000_160, kind: 'exchange', label: 'Binance' }], totalSol: 12.4, endsAt: 'exchange' },
    { from: 'creatorRug', hops: [{ to: 'funderOfCreator', lamports: 800_000_000, at: 1_700_000_230, kind: 'funder' }], totalSol: 0.8, endsAt: 'funder' },
  ];
  return s;
}

export const FIXTURES = { clean: cleanToken, rug: rugToken } as const;
export type FixtureName = keyof typeof FIXTURES;
