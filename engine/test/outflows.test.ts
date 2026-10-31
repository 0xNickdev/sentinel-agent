import { describe, expect, it } from 'vitest';
import { analyze, heliusKeyFrom, summarizeFlows, traceOutflows, type TokenSnapshot } from '../src/index.js';
import { BINANCE, CREATOR, CREATOR_FUNDER, PAGES, T0, fakeHelius } from './fixtures/helius-outflows.js';

const opts = (f: typeof fetch) => ({ apiKey: 'test-key', creator: CREATOR, creatorFunder: CREATOR_FUNDER, fetch: f, now: T0 + 7200, pauseMs: 0 });

describe('traceOutflows', () => {
  it('reads SOL out of each wallet after its last sell, names destinations and follows up to three hops', async () => {
    const { fetch: f, calls } = fakeHelius();
    const trails = await traceOutflows([{ wallet: CREATOR, since: T0 }, { wallet: 'wallet000', since: T0 + 10 }, { wallet: 'wallet001', since: T0 + 10 }], opts(f));
    const by = (from: string, to: string) => trails.find(t => t.from === from && t.hops[0]!.to === to)!;
    expect(by(CREATOR, BINANCE)).toMatchObject({ totalSol: 12.4, endsAt: 'exchange', hops: [{ kind: 'exchange', label: 'Binance' }] });
    // deposit address swept to the exchange: two hops, ends at exchange
    expect(by(CREATOR, 'depositA').hops.map(h => h.kind)).toEqual(['wallet', 'exchange']);
    expect(by(CREATOR, 'depositA').endsAt).toBe('exchange');
    expect(by(CREATOR, CREATOR_FUNDER)).toMatchObject({ totalSol: 0.8, endsAt: 'funder' });
    // dust and out-of-window transfers are ignored
    expect(trails.some(t => t.hops[0]!.to === 'dustSink' || t.hops[0]!.to === 'lateWallet')).toBe(false);
    // two traced wallets paying the same collector make it a hub; the chain stops after 3 hops
    const hub = by('wallet000', 'collector');
    expect(hub.hops[0]!.kind).toBe('hub');
    expect(hub.hops.map(h => h.to)).toEqual(['collector', 'bankA', 'bankB']);
    expect(hub.endsAt).toBe('wallet');
    // SOL moved between the traced wallets themselves is not money gone
    expect(trails.some(t => t.hops[0]!.to === CREATOR)).toBe(false);
    // … but when the creator is not traced, an insider paying the creator is a "dev" hop
    const solo = await traceOutflows([{ wallet: 'wallet000', since: T0 + 10 }], opts(fakeHelius().fetch));
    expect(solo.find(t => t.hops[0]!.to === CREATOR)).toMatchObject({ totalSol: 0.5, endsAt: 'dev' });
    // deterministic order: largest first
    expect(trails[0]!.totalSol).toBe(12.4);
    // the key never appears in what we record about the calls, and every call carries the window
    expect(calls.every(c => c.includes('type=TRANSFER') && c.includes('gte-time='))).toBe(true);
    // no fourth hop: the wallet reached on hop 3 is never read
    expect(calls.some(c => c.includes('/bankB/'))).toBe(false);
  });

  it('returns nothing without a key or wallets and survives a failing endpoint', async () => {
    expect(await traceOutflows([{ wallet: CREATOR, since: T0 }], { apiKey: '', fetch: fakeHelius().fetch })).toEqual([]);
    expect(await traceOutflows([], opts(fakeHelius().fetch))).toEqual([]);
    const broken = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    expect(await traceOutflows([{ wallet: CREATOR, since: T0 }], opts(broken))).toEqual([]);
  });

  it('finds the Helius key only in a Helius URL', () => {
    expect(heliusKeyFrom('https://mainnet.helius-rpc.com/?api-key=abc')).toBe('abc');
    expect(heliusKeyFrom('https://rpc.shyft.to?api_key=x')).toBeNull();
    expect(heliusKeyFrom('https://api.mainnet-beta.solana.com')).toBeNull();
    expect(heliusKeyFrom(undefined)).toBeNull();
  });
});

describe('flows in evidence', () => {
  const SUPPLY = 1_000_000_000;
  const snap = (flows: TokenSnapshot['flows']): TokenSnapshot => ({
    chain: 'solana', mint: 'MintFlow', creator: CREATOR, at: T0 + 7200,
    mintInfo: { decimals: 6, supply: SUPPLY, mintAuthority: null, freezeAuthority: null, metadataMutable: false },
    holders: [{ owner: 'curveVault', amount: SUPPLY * 0.7, isProgram: true }],
    trades: [{ account: CREATOR, side: 'buy', amount: SUPPLY * 0.05, slot: 99, timestamp: T0 - 100 }, { account: CREATOR, side: 'sell', amount: SUPPLY * 0.05, slot: 400, timestamp: T0 }],
    liquidity: { kind: 'bonding_curve', lockedPct: 100, quoteReserve: 12, curveProgressPct: 30 },
    creatorHistory: null, funders: { [CREATOR]: CREATOR_FUNDER }, hubs: [], flows,
  });

  it('flags dev_cashed_out and proceeds_to_funder from the trails', async () => {
    const trails = await traceOutflows([{ wallet: CREATOR, since: T0 }], opts(fakeHelius().fetch));
    const e = analyze(snap(trails));
    expect(e.flows).not.toBeNull();
    expect(e.flows!.toExchangeSol).toBe(15.4);
    expect(e.flows!.toFunderSol).toBe(0.8);
    expect(e.flows!.recycledSol).toBe(0);
    expect(e.flows!.traced).toBe(1);
    const codes = e.flags.map(f => f.code);
    expect(codes).toContain('dev_cashed_out');
    expect(codes).toContain('proceeds_to_funder');
    expect(e.flags.find(f => f.code === 'dev_cashed_out')).toMatchObject({ severity: 'critical', evidence: { toExchangeSol: 15.4, sharePct: 95.06, exchanges: 'Binance' } });
  });

  it('stays silent when the trace did not run or the proceeds stayed in nameless wallets', () => {
    expect(analyze(snap(null)).flows).toBeNull();
    expect(analyze(snap(undefined)).flows).toBeNull();
    const e = analyze(snap([{ from: CREATOR, hops: [{ to: 'bankA', lamports: 5e9, at: T0 + 60, kind: 'wallet' }], totalSol: 5, endsAt: 'wallet' }]));
    expect(e.flows!.toExchangeSol).toBe(0);
    expect(e.flags.map(f => f.code)).not.toContain('dev_cashed_out');
  });

  it('summarizeFlows is a pure sum by ending', () => {
    const s = summarizeFlows([
      { from: 'a', hops: [{ to: BINANCE, lamports: 2e9, at: 1, kind: 'exchange', label: 'Binance' }], totalSol: 2, endsAt: 'exchange' },
      { from: 'a', hops: [{ to: 'x', lamports: 1e9, at: 1, kind: 'wallet' }, { to: CREATOR_FUNDER, lamports: 9e8, at: 2, kind: 'funder' }], totalSol: 1, endsAt: 'funder' },
    ], 1, { from: 1, to: 2 });
    expect(s).toMatchObject({ toExchangeSol: 2, toFunderSol: 1, recycledSol: 0, traced: 1 });
    void PAGES;
  });
});
