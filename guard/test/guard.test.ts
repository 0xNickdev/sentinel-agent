import { describe as suite, expect, it, vi } from 'vitest';
import { createGuard, GuardBlockedError, settlement } from '../src/index.js';
import { guardAction, mintsIn, sentinelGuardPlugin } from '../src/eliza.js';

const GW = 'https://api.sentinelagent.pro';
const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const CARD = { capabilities: { extensions: [{ uri: 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1', params: { tokenAddress: 'ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9XuYWbM5LAuY1BXBRN' } }] } };
const BADGE_OK = { badge_valid: true, issues: [], agent_uri: `${GW}/.well-known/agent-card.json`, on_chain: { owner_account: '4XB5Fr1j' } };
const CLEAN = { verdict: 'SAFE', riskScore: 5, vetoes: [], flags: [], notChecked: ['snipers and bundles', 'funding graph'], full: null };
const FULL_SAFE = { verdict: 'SAFE', riskScore: 18, confidence: 0.82, headline: 'clean', attestation: { digest: 'ab'.repeat(32), concordiumTx: 'cd'.repeat(32) } };

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> } | undefined;
function mockFetch(route: Route) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = route(url, init) ?? (url.endsWith('/.well-known/agent-card.json') ? { body: CARD } : url.includes('/check-badge/') ? { body: BADGE_OK } : { status: 404, body: { error: 'no route' } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

suite('createGuard', () => {
  it('blocks on a free-screen veto without paying', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: { verdict: 'DANGER', riskScore: 90, vetoes: ['mint_authority_live'], flags: [] } } : undefined));
    const pay = mockFetch(() => ({ body: FULL_SAFE }));
    const d = await createGuard({ fetch: http, pay }).check(MINT);
    expect(d).toMatchObject({ action: 'block', source: 'quick', vetoes: ['mint_authority_live'] });
    expect(d.oracle.verified).toBe(true);
    expect(pay).not.toHaveBeenCalled();
  });

  it('never allows on the free screen alone by default', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const d = await createGuard({ fetch: http }).check(MINT);
    expect(d.action).toBe('warn');
    expect(d.reason).toMatch(/no payer/);
  });

  it('pays for the full verdict, sends idempotency and price ceiling, reads the receipt', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: 'ef'.repeat(32) })).toString('base64');
    const pay = mockFetch(() => ({ body: FULL_SAFE, headers: { 'payment-response': receipt } }));
    const d = await createGuard({ fetch: http, pay, maxPriceCcd: 2 }).check(MINT, { idempotencyKey: 'trade-0001' });
    expect(d).toMatchObject({ action: 'allow', source: 'full', verdict: 'SAFE', paidTx: 'ef'.repeat(32) });
    expect(d.audit?.url).toBe(`https://sentinelagent.pro/audit/${'ab'.repeat(32)}`);
    const [url, init] = pay.mock.calls[0]!;
    expect(url).toBe(`${GW}/x402/verdict`);
    expect((init as RequestInit).headers).toMatchObject({ 'idempotency-key': 'trade-0001', 'x-max-price-ccd': '2' });
  });

  it('a SAFE below the confidence floor is a warn, DANGER is a block', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const low = await createGuard({ fetch: http, pay: mockFetch(() => ({ body: { ...FULL_SAFE, confidence: 0.4 } })) }).check(MINT);
    expect(low.action).toBe('warn');
    const bad = await createGuard({ fetch: http, pay: mockFetch(() => ({ body: { ...FULL_SAFE, verdict: 'DANGER', riskScore: 77, decisive: 'creator sold 100%' } })) }).check(MINT);
    expect(bad).toMatchObject({ action: 'block' });
    expect(bad.reason).toMatch(/creator sold/);
  });

  it('reuses a recent paid verdict instead of paying again', async () => {
    const now = Math.floor(Date.now() / 1000);
    const http = mockFetch(u => (u.includes('/quick/') ? { body: { ...CLEAN, full: { verdict: 'SAFE', riskScore: 18, at: now - 60, digest: 'ab'.repeat(32), concordiumTx: null } } } : u.includes('/verdicts/') ? { body: FULL_SAFE } : undefined));
    const pay = mockFetch(() => ({ body: FULL_SAFE }));
    const d = await createGuard({ fetch: http, pay }).check(MINT);
    expect(d).toMatchObject({ action: 'allow', source: 'recent-full' });
    expect(pay).not.toHaveBeenCalled();
  });

  it('reads the oracle\'s graded record and, when the policy asks, refuses one that has not earned it', async () => {
    const track = (graded: number, skill: number | null) => ({ rule: 2, horizons: [{ label: '1h', graded: 500, judge: { brier: 0.1, skill: 0.5 } }, { label: '24h', graded, judge: { brier: 0.18, skill } }] });
    const route = (t: unknown): Route => u => (u.endsWith('/track') ? { body: t } : u.includes('/quick/') ? { body: CLEAN } : undefined);
    // by default the record is reported, not required
    const seen = await createGuard({ fetch: mockFetch(route(track(120, 0.21))) }).check(MINT, { mode: 'quick' });
    expect(seen.oracle.track).toEqual({ horizon: '24h', graded: 120, brier: 0.18, skill: 0.21, rule: 2 });
    expect(seen.action).toBe('warn');
    const policy = { minOracleSkill: 0.1 };
    expect((await createGuard({ fetch: mockFetch(route(track(120, 0.21))), policy }).check(MINT, { mode: 'quick' })).source).toBe('quick');
    for (const t of [track(120, 0.02), track(12, 0.4), track(120, null), { error: 'none' }]) {
      const pay = mockFetch(() => ({ body: FULL_SAFE }));
      const d = await createGuard({ fetch: mockFetch(route(t)), pay, policy }).check(MINT);
      expect(d).toMatchObject({ action: 'block', source: 'oracle' });
      expect(d.reason).toContain('graded record is below policy');
      expect(pay).not.toHaveBeenCalled();
    }
  });

  it('refuses an oracle whose badge does not verify, or belongs to another host', async () => {
    const bad = mockFetch(u => (u.includes('/check-badge/') ? { body: { badge_valid: false, issues: ['hash mismatch'] } } : undefined));
    expect(await createGuard({ fetch: bad }).check(MINT)).toMatchObject({ action: 'block', source: 'oracle' });
    const foreign = mockFetch(u => (u.includes('/check-badge/') ? { body: { ...BADGE_OK, agent_uri: 'https://evil.example/.well-known/agent-card.json' } } : undefined));
    const d = await createGuard({ fetch: foreign }).check(MINT);
    expect(d.action).toBe('block');
    expect(d.reason).toMatch(/belongs to/);
  });

  it('fails closed on network errors and price refusals', async () => {
    const down = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect((await createGuard({ fetch: down }).check(MINT)).action).toBe('block');
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const d = await createGuard({ fetch: http, pay: mockFetch(() => ({ status: 412, body: { error: 'price_above_max' } })), maxPriceCcd: 0.5 }).check(MINT);
    expect(d).toMatchObject({ action: 'block' });
    expect(d.reason).toMatch(/nothing paid/);
  });

  it('rejects input that is not a mint', async () => {
    expect((await createGuard({ fetch: mockFetch(() => undefined) }).check('not-a-mint')).action).toBe('block');
  });

  it('wrap() throws on block and runs the buy on allow', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const buy = vi.fn(async (m: string) => `bought ${m}`);
    const allowGuard = createGuard({ fetch: http, pay: mockFetch(() => ({ body: FULL_SAFE })) });
    expect(await allowGuard.wrap(buy, m => m)(MINT)).toBe(`bought ${MINT}`);
    const blockGuard = createGuard({ fetch: http, pay: mockFetch(() => ({ body: { ...FULL_SAFE, verdict: 'RUGGED' } })) });
    await expect(blockGuard.wrap(buy, m => m)(MINT)).rejects.toBeInstanceOf(GuardBlockedError);
    expect(buy).toHaveBeenCalledTimes(1);
  });

  it('decodes x402 receipts', () => {
    expect(settlement(Buffer.from('{"transaction":"aa"}').toString('base64'))).toBe('aa');
    expect(settlement('%%%')).toBeNull();
  });
});

suite('eliza adapter', () => {
  it('finds mints in text', () => {
    expect(mintsIn(`buy 1 SOL of ${MINT} now`)).toEqual([MINT]);
    expect(mintsIn('hello')).toEqual([]);
  });

  it('CHECK_TOKEN_RISK answers with the decision', async () => {
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const [action] = sentinelGuardPlugin(createGuard({ fetch: http })).actions!;
    const message = { content: { text: `is ${MINT} a rug?` } };
    expect(await action!.validate({}, message)).toBe(true);
    const cb = vi.fn(async () => []);
    const r = await action!.handler({}, message, undefined, undefined, cb);
    expect(r).toMatchObject({ success: true, values: { sentinelAction: 'warn' } });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('guardAction stops a swap on a blocked token and passes an allowed one through', async () => {
    const swap = { name: 'SWAP_SOLANA', description: 'Swap tokens.', validate: async () => true, handler: vi.fn(async () => ({ success: true, text: 'swapped' })) };
    const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
    const blocked = guardAction(swap, createGuard({ fetch: http, pay: mockFetch(() => ({ body: { ...FULL_SAFE, verdict: 'DANGER' } })) }));
    const cb = vi.fn(async () => []);
    const r = await blocked.handler({}, { content: { text: 'swap' } }, undefined, { outputMint: MINT }, cb);
    expect(r).toMatchObject({ success: false });
    expect(swap.handler).not.toHaveBeenCalled();
    const allowed = guardAction(swap, createGuard({ fetch: http, pay: mockFetch(() => ({ body: FULL_SAFE })) }));
    expect(await allowed.handler({}, { content: { text: 'swap' } }, undefined, { outputMint: MINT })).toMatchObject({ success: true, text: 'swapped' });
  });
});

suite('mandate', () => {
  const http = mockFetch(u => (u.includes('/quick/') ? { body: CLEAN } : undefined));
  const pay = () => mockFetch(() => ({ body: FULL_SAFE }));

  it('blocks an over-limit buy before paying for a check', async () => {
    const p = pay();
    const g = createGuard({ fetch: http, pay: p, mandate: { maxPerTrade: 5, maxPerDay: 8 } });
    const buy = vi.fn(async (_m: string, _n: number) => 'ok');
    const safe = g.wrap(buy, m => m, { amountOf: (_m, n) => n });
    await expect(safe(MINT, 6)).rejects.toThrow(/per-trade limit/);
    expect(p).not.toHaveBeenCalled();
    expect(await safe(MINT, 5)).toBe('ok');
    await expect(safe(MINT, 4)).rejects.toThrow(/left today \(3 of 8\)/);
    expect(g.spent()).toEqual({ last24h: 5, remaining: 3 });
  });

  it('does not count a buy that failed or was blocked, and holds the limit under concurrency', async () => {
    const g = createGuard({ fetch: http, pay: pay(), mandate: { maxPerDay: 10 } });
    const failing = g.wrap(async (_m: string, _n: number) => { throw new Error('swap reverted'); }, m => m, { amountOf: (_m, n) => n });
    await expect(failing(MINT, 7)).rejects.toThrow('swap reverted');
    expect(g.spent().last24h).toBe(0);
    const safe = g.wrap(async (_m: string, _n: number) => 'ok', m => m, { amountOf: (_m, n) => n });
    const r = await Promise.allSettled([safe(MINT, 6), safe(MINT, 6)]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('only buys on a full verdict in the allowed bands, needs a size when it has limits, and expires', async () => {
    const quickOnly = createGuard({ fetch: http, policy: { quickSafe: 'allow' }, mandate: { onlyBands: ['SAFE'] } });
    await expect(quickOnly.wrap(async (m: string) => m, m => m)(MINT)).rejects.toThrow(/full SAFE verdict/);
    const sized = createGuard({ fetch: http, pay: pay(), mandate: { maxPerDay: 1 } });
    await expect(sized.wrap(async (m: string) => m, m => m)(MINT)).rejects.toThrow(/amountOf/);
    const old = createGuard({ fetch: http, pay: pay(), mandate: { expiresAt: 1 } });
    await expect(old.wrap(async (m: string) => m, m => m)(MINT)).rejects.toThrow(/expired/);
  });
});
