import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { PUMP_CREATE_DISCRIMINATOR, PUMP_CREATE_V2_DISCRIMINATOR, PUMP_FUN_PROGRAM, base58, decodePumpCreate, launchesFromUpdate, sanitiseLabel } from '../src/solana/geyser.js';

const str = (s: string) => { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
const key = (seed: number) => { const b = new Uint8Array(32); b[0] = seed; b[31] = 7; return b; };

const MINT = key(1), CREATOR = key(9);
const keys = [MINT, key(2), key(3), key(4), key(5), key(6), key(7), CREATOR, new PublicKey(PUMP_FUN_PROGRAM).toBytes()];
const keysB58 = keys.map(base58);
const data = Buffer.concat([PUMP_CREATE_DISCRIMINATOR, str("Sentinel\u0000 Dog"), str("SDOG\u200b"), str('https://x/y.json'), Buffer.from(CREATOR)]);
const ix = { programIdIndex: 8, accounts: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 8]), data: new Uint8Array(data) };

describe('pump.fun create decoder', () => {
  it('base58 matches web3.js', () => { expect(base58(keys[8]!)).toBe(PUMP_FUN_PROGRAM); expect(base58(MINT)).toBe(new PublicKey(MINT).toBase58()); });
  it('decodes mint, creator, name, symbol and sanitises labels', () => {
    const d = decodePumpCreate(ix, keysB58);
    expect(d).toEqual({ mint: base58(MINT), creator: base58(CREATOR), name: 'Sentinel Dog', symbol: 'SDOG' });
  });
  it('ignores other programs and other discriminators', () => {
    expect(decodePumpCreate({ ...ix, programIdIndex: 0 }, keysB58)).toBeNull();
    const other = new Uint8Array(data); other[0] ^= 0xff;
    expect(decodePumpCreate({ ...ix, data: other }, keysB58)).toBeNull();
    expect(decodePumpCreate({ ...ix, data: new Uint8Array(data.subarray(0, 10)) }, keysB58)).toBeNull();
  });
  it('decodes create_v2 (creator at account 5, also embedded in data) and falls back to the account when data is short', () => {
    const v2 = Buffer.concat([PUMP_CREATE_V2_DISCRIMINATOR, str('Looksmax CATE'), str('BPCATE'), str('https://ipfs.io/x'), Buffer.from(CREATOR), Buffer.alloc(10)]);
    const v2keys = [MINT, key(2), key(3), key(4), key(5), CREATOR, key(6), key(7), keys[8]!].map(base58);
    const v2ix = { programIdIndex: 8, accounts: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), data: new Uint8Array(v2) };
    expect(decodePumpCreate(v2ix, v2keys)).toEqual({ mint: base58(MINT), creator: base58(CREATOR), name: 'Looksmax CATE', symbol: 'BPCATE' });
    const short = Buffer.concat([PUMP_CREATE_V2_DISCRIMINATOR, str('A'), str('B')]);
    expect(decodePumpCreate({ ...v2ix, data: new Uint8Array(short) }, v2keys)?.creator).toBe(base58(CREATOR));
  });
  it('sanitiseLabel caps at 32 printable chars', () => { expect(sanitiseLabel('a'.repeat(50))).toHaveLength(32); expect(sanitiseLabel('  x\ty  ')).toBe('x y'); });
  it('launchesFromUpdate walks outer and inner instructions, skips failed txs', () => {
    const sig = new Uint8Array(64).fill(3);
    const update = (err: unknown) => ({ filters: ['pump'], createdAt: undefined, transaction: { slot: '12345', bankId: '0', transaction: { signature: sig, isVote: false, index: '0', transaction: { signatures: [sig], message: { header: undefined, accountKeys: keys, recentBlockhash: new Uint8Array(32), instructions: [{ programIdIndex: 0, accounts: new Uint8Array(), data: new Uint8Array() }], versioned: false, addressTableLookups: [] } }, meta: { err, innerInstructions: [{ index: 0, instructions: [{ ...ix, stackHeight: 2 }] }], loadedWritableAddresses: [], loadedReadonlyAddresses: [] } } } }) as never;
    const [ev] = launchesFromUpdate(update(undefined), 1700000000);
    expect(ev).toMatchObject({ mint: base58(MINT), symbol: 'SDOG', slot: 12345, at: 1700000000, signature: base58(sig) });
    expect(launchesFromUpdate(update({ err: new Uint8Array([1]) }))).toEqual([]);
  });
});
