import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58Decode, challengeMessage, checkContext, unwrapPresentation, verifySolanaSignature } from '../src/idproof.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

function solanaWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: base58Encode(raw), sign: (m: string) => sign(null, Buffer.from(m, 'utf8'), privateKey).toString('hex') };
}

describe('creator proof: Solana wallet binding', () => {
  it('decodes a Solana address to 32 bytes', () => {
    expect(base58Decode('11111111111111111111111111111111')).toEqual(new Uint8Array(32));
    expect(base58Decode('So11111111111111111111111111111111111111112').length).toBe(32);
  });
  it('accepts the wallet signature over the challenge and rejects anything else', () => {
    const w = solanaWallet(), other = solanaWallet();
    const tx = 'ab'.repeat(32);
    const msg = challengeMessage(w.address, tx);
    expect(msg).toContain(w.address);
    expect(msg).toContain(tx);
    expect(verifySolanaSignature(w.address, msg, w.sign(msg))).toBe(true);
    expect(verifySolanaSignature(w.address, challengeMessage(w.address, 'cd'.repeat(32)), w.sign(msg))).toBe(false);
    expect(verifySolanaSignature(w.address, msg, other.sign(msg))).toBe(false);
    expect(verifySolanaSignature(w.address, msg, 'zz')).toBe(false);
    expect(verifySolanaSignature('not-base58!', msg, w.sign(msg))).toBe(false);
  });
});

describe('creator proof: presentation context', () => {
  const given = [{ label: 'Nonce', context: 'aa' }, { label: 'ConnectionID', context: 'c1' }, { label: 'ResourceID', context: 'https://sentinelagent.pro' }, { label: 'ContextString', context: 'sentinel:creator:W' }];
  const request = { context: { given, requested: ['BlockHash'] } };
  const pres = (over: Partial<{ given: typeof given; block: string }> = {}) => ({ presentationContext: { given: over.given ?? [...given].reverse(), requested: [{ label: 'BlockHash', context: over.block ?? 'B1' }] } });
  it('accepts the issued context bound to the anchor block', () => expect(() => checkContext(request, pres(), 'b1')).not.toThrow());
  it('rejects another nonce, wallet or block', () => {
    expect(() => checkContext(request, pres({ given: given.map(g => g.label === 'Nonce' ? { ...g, context: 'bb' } : g) }), 'B1')).toThrow(/context/);
    expect(() => checkContext(request, pres({ given: given.map(g => g.label === 'ContextString' ? { ...g, context: 'sentinel:creator:X' } : g) }), 'B1')).toThrow(/context/);
    expect(() => checkContext(request, pres({ block: 'B2' }), 'B1')).toThrow(/block/);
  });
});

describe('creator proof: wallet answer shapes', () => {
  const vp = { type: ['VerifiablePresentation', 'ConcordiumVerifiablePresentationV1'], presentationContext: { type: 'x', given: [], requested: [] }, verifiableCredential: [], proof: {} };
  it('accepts the object, a JSON string, or a wrapper', () => {
    expect(unwrapPresentation(vp)).toEqual(vp);
    expect(unwrapPresentation(JSON.stringify(vp))).toEqual(vp);
    expect(unwrapPresentation({ verifiablePresentation: vp })).toEqual(vp);
    expect(unwrapPresentation({ result: JSON.stringify(vp) })).toEqual(vp);
    expect(unwrapPresentation({ verifiablePresentationJson: JSON.stringify(vp) })).toEqual(vp);
  });
});
