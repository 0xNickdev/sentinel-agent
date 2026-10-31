// Post-quantum attestation of verdicts. The audit record on Concordium proves
// *when* a digest existed and *which account* submitted it; this signature
// proves the digest came from Sentinel's judge key, and stays verifiable
// offline, by anyone, even against a quantum adversary (ML-DSA-65, FIPS 204,
// via @noble/post-quantum). The Concordium account itself still signs with
// Ed25519: that is the chain's choice, not ours.
import { createHash, randomBytes } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

export const ATTEST_ALG = 'ML-DSA-65';
/** Domain separation so a verdict signature can never be replayed as something else. */
const CONTEXT = new TextEncoder().encode('sentinel.verdict/1');

export interface AttestationKeys { publicKeyHex: string; secretKey: Uint8Array; seedHex: string }

export interface Signature { alg: typeof ATTEST_ALG; publicKey: string; signature: string }

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

/** Deterministic keys from a 32-byte seed (hex). Keep the seed in .env as SENTINEL_PQ_SEED. */
export function keysFromSeed(seedHex: string): AttestationKeys {
  const seed = unhex(seedHex);
  if (seed.length !== 32) throw new Error('SENTINEL_PQ_SEED must be 32 bytes (64 hex chars)');
  const { publicKey, secretKey } = ml_dsa65.keygen(seed);
  return { publicKeyHex: hex(publicKey), secretKey, seedHex };
}

export const randomSeedHex = () => randomBytes(32).toString('hex');

/** Keys from the environment; a fresh ephemeral key in dev when none is configured (verifiable within the process lifetime only). */
export function keysFromEnv(): AttestationKeys & { ephemeral: boolean } {
  const seed = process.env.SENTINEL_PQ_SEED;
  if (seed) return { ...keysFromSeed(seed), ephemeral: false };
  return { ...keysFromSeed(randomSeedHex()), ephemeral: true };
}

/** What is signed: sha256 over (digest ‖ mint ‖ verdict ‖ riskScore ‖ at), so the signature binds the human-readable outcome too. */
export function attestationMessage(v: { mint: string; verdict: string; riskScore: number; at: number; attestation: { digest: string } }): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`${v.attestation.digest}|${v.mint}|${v.verdict}|${v.riskScore}|${v.at}`).digest());
}

export function signVerdict(keys: AttestationKeys, v: Parameters<typeof attestationMessage>[0]): Signature {
  const sig = ml_dsa65.sign(attestationMessage(v), keys.secretKey, { context: CONTEXT });
  return { alg: ATTEST_ALG, publicKey: keys.publicKeyHex, signature: hex(sig) };
}

export function verifyVerdict(v: Parameters<typeof attestationMessage>[0], sig: Signature, expectedPublicKeyHex?: string): boolean {
  if (sig.alg !== ATTEST_ALG) return false;
  if (expectedPublicKeyHex && sig.publicKey !== expectedPublicKeyHex) return false;
  try { return ml_dsa65.verify(unhex(sig.signature), attestationMessage(v), unhex(sig.publicKey), { context: CONTEXT }); } catch { return false; }
}
