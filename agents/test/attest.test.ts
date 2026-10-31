import { describe, expect, it } from 'vitest';
import { keysFromSeed, randomSeedHex, signVerdict, verifyVerdict } from '../src/attest.js';

const v = { mint: 'Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU', verdict: 'RUGGED', riskScore: 88, at: 1_700_000_000, attestation: { digest: 'c9'.repeat(32) } };

describe('post-quantum attestation (ML-DSA-65)', () => {
  it('signs and verifies, and keys are deterministic from the seed', () => {
    const seed = randomSeedHex();
    const k1 = keysFromSeed(seed), k2 = keysFromSeed(seed);
    expect(k1.publicKeyHex).toBe(k2.publicKeyHex);
    const sig = signVerdict(k1, v);
    expect(sig.alg).toBe('ML-DSA-65');
    expect(verifyVerdict(v, sig)).toBe(true);
    expect(verifyVerdict(v, sig, k1.publicKeyHex)).toBe(true);
  });
  it('rejects a tampered verdict, a wrong key and a malformed signature', () => {
    const keys = keysFromSeed(randomSeedHex());
    const sig = signVerdict(keys, v);
    expect(verifyVerdict({ ...v, verdict: 'SAFE' }, sig)).toBe(false);
    expect(verifyVerdict({ ...v, riskScore: 10 }, sig)).toBe(false);
    expect(verifyVerdict(v, sig, keysFromSeed(randomSeedHex()).publicKeyHex)).toBe(false);
    expect(verifyVerdict(v, { ...sig, signature: sig.signature.slice(0, 100) })).toBe(false);
    expect(verifyVerdict(v, { ...sig, alg: 'Ed25519' as 'ML-DSA-65' })).toBe(false);
  });
  it('refuses a seed of the wrong length', () => {
    expect(() => keysFromSeed('abcd')).toThrow(/32 bytes/);
  });
});
