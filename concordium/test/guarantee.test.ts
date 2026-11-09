import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cborText } from '../src/chain.js';
import { GuaranteeBook, settledPayment } from '../src/guarantee.js';
import type { StoredVerdict } from '../src/service.js';

const PAYER = '4XB5Fr1jgcp9SuqTQQwyfiY7L6CncUQuvG1dY83ASpN9S4ZDhh';
const D1 = 'a'.repeat(64), D2 = 'b'.repeat(64), D3 = 'c'.repeat(64);
const TX = (n: number) => n.toString(16).padStart(64, '0');

function verdicts() {
  const vs = new Map<string, Partial<StoredVerdict>>([
    [D1, { mint: 'Mint1', verdict: 'SAFE', outcomes: [] }],
    [D2, { mint: 'Mint2', verdict: 'SAFE', outcomes: [] }],
    [D3, { mint: 'Mint3', verdict: 'DANGER', outcomes: [] }],
  ]);
  const grade = (d: string, rugged: boolean) => { vs.get(d)!.outcomes = [{ horizon: 86_400, rugged, labels: rugged ? ['tvl_rug'] : [] } as never]; };
  return { lookup: (d: string) => vs.get(d) as StoredVerdict | undefined, grade };
}

describe('GuaranteeBook', () => {
  it('refunds a paid SAFE that rugs, keeps one that lives and anything not covered', async () => {
    const { lookup, grade } = verdicts();
    const transfer = vi.fn(async () => ({ hash: TX(99) }));
    const book = new GuaranteeBook({ network: 'testnet', pool: null, client: null, lookup, transfer });
    book.record({ digest: D1, payer: PAYER, paymentTx: TX(1), amount: '1000000', asset: 'CCD' });
    book.record({ digest: D2, payer: PAYER, paymentTx: TX(2), amount: '1000000', asset: 'CCD' });
    book.record({ digest: D3, payer: PAYER, paymentTx: TX(3), amount: '1000000', asset: 'CCD' });
    expect(await book.tick()).toEqual([]);          // nothing graded yet: every claim stays open
    grade(D1, true); grade(D2, false); grade(D3, true);
    const closed = await book.tick();
    expect(closed.map(c => [c.digest, c.status])).toEqual([[D1, 'refunded'], [D2, 'kept'], [D3, 'kept']]);
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledWith(PAYER, 1_000_000n, `sentinel refund ${D1}`);
    expect(await book.tick()).toEqual([]);          // closed claims are never paid twice
    expect(book.report().counts).toMatchObject({ paid: 3, covered: 2, refunded: 1, kept: 2, open: 0, refundedAmount: '1000000' });
  });

  it('records only real settlements for known verdicts, once', () => {
    const { lookup } = verdicts();
    const book = new GuaranteeBook({ network: 'testnet', pool: null, client: null, lookup });
    expect(book.record({ digest: D1, payer: PAYER, paymentTx: TX(1), amount: '1', asset: 'CCD' })).not.toBeNull();
    expect(book.record({ digest: D1, payer: PAYER, paymentTx: TX(1), amount: '1', asset: 'CCD' })).toBeNull();
    expect(book.record({ digest: 'f'.repeat(64), payer: PAYER, paymentTx: TX(2), amount: '1', asset: 'CCD' })).toBeNull();
    expect(book.record({ digest: D1, payer: 'not-an-account', paymentTx: TX(3), amount: '1', asset: 'CCD' })).toBeNull();
  });

  it('retries a failed refund and survives a restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'guarantee-'));
    const { lookup, grade } = verdicts();
    const transfer = vi.fn().mockRejectedValueOnce(new Error('node down')).mockResolvedValue({ hash: TX(42) });
    const book = new GuaranteeBook({ network: 'testnet', pool: null, client: null, lookup, transfer, dataDir });
    book.record({ digest: D1, payer: PAYER, paymentTx: TX(1), amount: '500000', asset: 'CCD' });
    grade(D1, true);
    expect((await book.tick())[0]!.status).toBe('failed');
    const again = new GuaranteeBook({ network: 'testnet', pool: null, client: null, lookup, transfer, dataDir });
    expect((await again.tick())[0]).toMatchObject({ status: 'refunded', refundTx: TX(42), amount: '500000' });
    const third = new GuaranteeBook({ network: 'testnet', pool: null, client: null, lookup, transfer, dataDir });
    expect(await third.tick()).toEqual([]);
    expect(transfer).toHaveBeenCalledTimes(2);
  });

  it('reads the settled payer from the x402 receipt and encodes memos as CBOR text', () => {
    const h = Buffer.from(JSON.stringify({ success: true, payer: PAYER, transaction: TX(7) })).toString('base64');
    expect(settledPayment(h)).toEqual({ payer: PAYER, transaction: TX(7) });
    expect(settledPayment(Buffer.from('{"success":false}').toString('base64'))).toBeNull();
    expect(cborText('hi')).toEqual(Buffer.from([0x62, 0x68, 0x69]));
    expect(cborText(`sentinel refund ${D1}`).subarray(0, 2)).toEqual(Buffer.from([0x78, 80]));
  });
});
