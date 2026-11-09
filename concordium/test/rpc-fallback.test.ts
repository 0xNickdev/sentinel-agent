import { describe, expect, it } from 'vitest';
import { VerdictService } from '../src/index.js';

type Snap = { mint: string; from: string };
const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function service(primary: Array<() => Snap>, fallback: () => Snap) {
  const log: string[] = [];
  const s = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', fallbackRpcUrl: 'http://127.0.0.1:2', rpcRetryMs: 1, log: m => log.push(m) });
  let calls = 0;
  const inner = s as unknown as { adapter: { snapshot: () => Promise<Snap> }; fallback: { snapshot: () => Promise<Snap> } };
  inner.adapter.snapshot = async () => primary[calls++]!();
  inner.fallback.snapshot = async () => fallback();
  return { s, log, calls: () => calls };
}

describe('rpc fallback', () => {
  it('uses the fallback when the primary is rate limited', async () => {
    const { s } = service([() => { throw new Error('429 Too Many Requests'); }], () => ({ mint: MINT, from: 'fallback' }));
    expect(await s.snapshot(MINT)).toEqual({ mint: MINT, from: 'fallback' });
  });

  it('retries the primary when the fallback refuses a call the primary serves', async () => {
    const { s, log, calls } = service(
      [() => { throw new Error('429 Too Many Requests'); }, () => ({ mint: MINT, from: 'primary' })],
      () => { throw new Error('422 Unprocessable Entity: getTokenLargestAccounts On DezXAZ… blocked'); },
    );
    expect(await s.snapshot(MINT)).toEqual({ mint: MINT, from: 'primary' });
    expect(calls()).toBe(2);
    expect(log.some(m => m.includes('fallback rpc failed'))).toBe(true);
  });

  it('does not use the fallback for errors that are not refusals', async () => {
    const { s, calls } = service([() => { throw new Error('account not found'); }], () => ({ mint: MINT, from: 'fallback' }));
    await expect(s.snapshot(MINT)).rejects.toThrow('account not found');
    expect(calls()).toBe(1);
  });
});
