// Fake Helius Enhanced Transactions responses for the money-flow trace.
// Keyed by wallet address; each entry is the TRANSFER page Helius would return.
export const BINANCE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'; // Binance 2 in engine/data/exchanges.json
export const CREATOR = 'creatorRug';
export const CREATOR_FUNDER = 'funderOfCreator';
export const T0 = 1_700_000_100; // creator's last sell

const SOL = 1_000_000_000;
const tx = (sig: string, timestamp: number, from: string, to: string, sol: number) => ({ signature: sig, timestamp, type: 'TRANSFER', nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: Math.round(sol * SOL) }] });

export const PAGES: Record<string, unknown[]> = {
  // creator: 12.4 SOL straight to Binance, 3 SOL to a deposit-looking wallet, 0.8 back to its funder, 0.05 dust
  creatorRug: [
    tx('c1', T0 + 60, CREATOR, BINANCE, 12.4),
    tx('c2', T0 + 120, CREATOR, 'depositA', 3),
    tx('c3', T0 + 130, CREATOR, CREATOR_FUNDER, 0.8),
    tx('c4', T0 + 140, CREATOR, 'dustSink', 0.05),
    tx('c5', T0 + 90_000, CREATOR, 'lateWallet', 50), // outside the 24h window
  ],
  // deposit address sweeps to Binance: the trail ends at an exchange after 2 hops
  depositA: [tx('d1', T0 + 600, 'depositA', BINANCE, 2.99)],
  // two insiders both pay into the same collector → hub
  wallet000: [tx('w0', T0 + 200, 'wallet000', 'collector', 2), tx('w0b', T0 + 210, 'wallet000', CREATOR, 0.5)],
  wallet001: [tx('w1', T0 + 220, 'wallet001', 'collector', 1.5)],
  // collector goes on to a nameless wallet, which goes on to another: three hops, still a wallet
  collector: [tx('k1', T0 + 900, 'collector', 'bankA', 3.4)],
  bankA: [tx('b1', T0 + 1800, 'bankA', 'bankB', 3.3)],
  bankB: [tx('b2', T0 + 3600, 'bankB', 'bankC', 3.2)],
};

/** A fetch double that serves PAGES and records every URL (with the key redacted). */
export function fakeHelius(pages: Record<string, unknown[]> = PAGES) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname + '?' + [...url.searchParams.entries()].filter(([k]) => k !== 'api-key').map(([k, v]) => `${k}=${v}`).join('&'));
    const addr = url.pathname.split('/')[3] ?? '';
    const gte = Number(url.searchParams.get('gte-time') ?? 0), lte = Number(url.searchParams.get('lte-time') ?? Infinity);
    const body = (pages[addr] ?? []).filter(t => { const ts = (t as { timestamp: number }).timestamp; return ts >= gte && ts <= lte; });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}
