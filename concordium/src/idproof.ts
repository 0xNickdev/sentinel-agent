// Verified creators: bind a Solana creator wallet to a Concordium ID zero-knowledge proof.
//
// This is the Concordium "Verify and Access" protocol (Verifiable Presentations V1) run in-process with
// @concordium/web-sdk instead of the Docker verifier service, so the API stays one Node process:
//   1. request  — Sentinel builds a verification request (age >= 18 from a trusted identity provider), bound to the
//                 wallet through its context string, and anchors it on Concordium (CCDVRA, a RegisterData tx).
//   2. sign     — the creator signs a challenge naming that anchor with the Solana wallet (Phantom signMessage).
//   3. present  — the creator's Concordium wallet answers the request with a ZK presentation (no attribute revealed).
//   4. verify   — Sentinel checks the Solana signature, verifies the presentation against the chain, and anchors the
//                 audit record (CCDVAA). Only the wallet, the claim, the time and the two anchors are stored.
// Every verdict on a token whose creator is that wallet then carries a `verified_creator` finding.
import { createPublicKey, randomBytes, randomUUID, verify as edVerify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlockHash, IdentityProviderDID, TransactionHash } from '@concordium/web-sdk';
import { VerifiablePresentationV1, VerificationAuditRecordV1, VerificationRequestV1 } from '@concordium/web-sdk/wasm';
import type { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import type { CreatorProof } from '@sentinel/engine';
import { explorerTx, type Account } from './chain.js';
import type { Network } from './registry.js';

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 → bytes (Bitcoin alphabet, as Solana uses). */
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

/** Verify an ed25519 signature by a Solana wallet over a UTF-8 message. */
export function verifySolanaSignature(wallet: string, message: string, signatureHex: string): boolean {
  try {
    const raw = base58Decode(wallet);
    if (raw.length !== 32 || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/** The exact text the creator signs with the Solana wallet. Names the anchored request, so a signature cannot be replayed. */
export const challengeMessage = (wallet: string, requestTx: string) =>
  `Sentinel creator proof\nwallet: ${wallet}\nrequest: ${requestTx}\n\nI bind this wallet to a Concordium ID proof (age 18+). No personal data is shared.`;

type Ctx = { label: string; context: unknown };
const ctxKey = (c: Ctx) => `${c.label}=${typeof c.context === 'string' ? c.context : JSON.stringify(c.context)}`;

/** Reject a presentation whose context differs from the request we anchored, or that names another block. */
export function checkContext(request: { context: { given: Ctx[]; requested: string[] } }, presentation: { presentationContext: { given: Ctx[]; requested: Ctx[] } }, anchorBlockHash: string): void {
  const pc = presentation.presentationContext;
  const want = new Set(request.context.given.map(ctxKey));
  const got = new Set(pc.given.map(ctxKey));
  if (want.size !== got.size || [...want].some(k => !got.has(k))) throw new Error('presentation context does not match the request (nonce, connection, resource or context string)');
  const labels = pc.requested.map(c => c.label).sort().join(',');
  if (labels !== [...request.context.requested].sort().join(',')) throw new Error('presentation fills different context items than requested');
  const block = pc.requested.find(c => c.label === 'BlockHash')?.context;
  if (typeof block !== 'string' || block.toLowerCase() !== anchorBlockHash.toLowerCase()) throw new Error('presentation is not bound to the block of the request anchor');
}

/** Wallets hand the presentation back as an object, a JSON string, or wrapped; reduce it to the V1 JSON. */
export function unwrapPresentation(p: unknown, depth = 0): unknown {
  if (depth > 3) return p;
  if (typeof p === 'string') { try { return unwrapPresentation(JSON.parse(p), depth + 1); } catch { return p; } }
  if (p && typeof p === 'object' && !('presentationContext' in p)) {
    for (const k of ['verifiablePresentationJson', 'verifiablePresentation', 'presentation', 'result', 'proof']) {
      const v = (p as Record<string, unknown>)[k];
      if (v && (typeof v === 'string' || (typeof v === 'object' && 'presentationContext' in (v as object)) || typeof v === 'object')) {
        const u = unwrapPresentation(v, depth + 1);
        if (u && typeof u === 'object' && 'presentationContext' in u) return u;
      }
    }
  }
  return p;
}

/** Keys only, never values: enough to debug a wallet's answer without logging proofs. */
const shapeOf = (p: unknown): string => typeof p !== 'object' || p === null ? typeof p : `{${Object.keys(p).slice(0, 12).join(',')}}`;

export interface CreatorProofRecord extends CreatorProof {
  /** id of the off-chain verification audit record (VAR) */
  auditRecordId: string;
  requestExplorer: string;
  auditExplorer: string;
}

interface Pending { wallet: string; request: VerificationRequestV1.Type; expires: number }

export interface CreatorProofsOptions {
  grpc: ConcordiumGRPCNodeClient;
  network: Network;
  /** pays the two anchor fees (RegisterData); the creator pays nothing */
  verifier: Account;
  /** shown to the wallet as the resource the proof is for */
  resourceId: string;
  /** identity providers whose credentials are accepted (default: the network's idp:0..3) */
  issuers?: number[];
  /** directory for creator-proofs.jsonl (proofs) and audit-records.jsonl (VARs); memory-only when omitted */
  dataDir?: string | null;
  /** a request stays answerable this long (default 15 min) */
  ttlMs?: number;
  log?: (m: string) => void;
}

export class CreatorProofs {
  private readonly byWallet = new Map<string, CreatorProofRecord>();
  private readonly pending = new Map<string, Pending>();
  private readonly file: string | null;
  private readonly varFile: string | null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly sdkNetwork: 'Testnet' | 'Mainnet';

  constructor(private readonly o: CreatorProofsOptions) {
    this.sdkNetwork = o.network === 'mainnet' ? 'Mainnet' : 'Testnet';
    this.file = o.dataDir ? join(o.dataDir, 'creator-proofs.jsonl') : null;
    this.varFile = o.dataDir ? join(o.dataDir, 'audit-records.jsonl') : null;
    if (o.dataDir) {
      mkdirSync(o.dataDir, { recursive: true });
      if (this.file && existsSync(this.file)) for (const line of readFileSync(this.file, 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line) as CreatorProofRecord; this.byWallet.set(r.wallet, r); }
    }
  }

  /** The proof bound to a wallet, if any. */
  get(wallet: string | null | undefined): CreatorProofRecord | null { return wallet ? this.byWallet.get(wallet) ?? null : null; }

  /** All proofs, newest first. */
  all(): CreatorProofRecord[] { return [...this.byWallet.values()].sort((a, b) => b.verifiedAt - a.verifiedAt); }

  /** The verifier account sends one anchor at a time so nonces never collide. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async anchorMeta() {
    const { nonce } = await this.o.grpc.getNextAccountNonce(this.o.verifier.address);
    return { sender: this.o.verifier.address, sequenceNumber: nonce, signer: this.o.verifier.signer };
  }

  /** Step 1: build and anchor a verification request bound to `wallet`. */
  async request(wallet: string, connectionId?: string): Promise<{ request: VerificationRequestV1.JSON; requestTx: string; requestExplorer: string; message: string; expiresAt: number }> {
    if (!SOLANA_RE.test(wallet) || base58Decode(wallet).length !== 32) throw new Error('not a Solana wallet address');
    const issuers = (this.o.issuers ?? [0, 1, 2, 3]).map(i => new IdentityProviderDID(this.sdkNetwork, i));
    // The Concordium ID App proves from the identity credential only; browser wallets may use either.
    const builder = VerificationRequestV1.claimsBuilder();
    const claims = (connectionId ? builder.addIdentityClaims(issuers, b => b.addMinimumAge(18)) : builder.addAccountOrIdentityClaims(issuers, b => b.addMinimumAge(18))).getClaims();
    // The Concordium ID App matches a request to its WalletConnect session by ConnectionID = the session topic.
    if (connectionId !== undefined && !/^[0-9a-f]{64}$/i.test(connectionId)) throw new Error('connectionId must be a WalletConnect session topic');
    const context = VerificationRequestV1.createSimpleContext(new Uint8Array(randomBytes(32)), connectionId ?? randomUUID(), this.o.resourceId, `sentinel:creator:${wallet}`);
    const request = await this.serial(async () => VerificationRequestV1.createAndAnchor(this.o.grpc, await this.anchorMeta(), context, claims, { app: 'sentinel', purpose: 'creator-proof' }));
    const requestTx = TransactionHash.toHexString(request.transactionRef);
    const expiresAt = Date.now() + (this.o.ttlMs ?? 15 * 60_000);
    this.pending.set(requestTx, { wallet, request, expires: expiresAt });
    for (const [k, p] of this.pending) if (p.expires < Date.now()) this.pending.delete(k);
    this.o.log?.(`idproof · request ${requestTx.slice(0, 12)}… for ${wallet.slice(0, 6)}…`);
    return { request: request.toJSON(), requestTx, requestExplorer: explorerTx(this.o.network, requestTx), message: challengeMessage(wallet, requestTx), expiresAt };
  }

  /** Step 4: check both signatures, verify the ZK presentation against the chain, anchor the audit record, store the binding. */
  async verify(input: { requestTx: string; presentation: unknown; solanaSignature: string }): Promise<CreatorProofRecord> {
    const p = this.pending.get(input.requestTx);
    if (!p || p.expires < Date.now()) throw new Error('unknown or expired request: start again');
    if (!verifySolanaSignature(p.wallet, challengeMessage(p.wallet, input.requestTx), input.solanaSignature)) throw new Error('the Solana signature does not match the wallet');
    let presentation: VerifiablePresentationV1.Type;
    const raw = unwrapPresentation(input.presentation);
    try {
      presentation = VerifiablePresentationV1.fromJSON(raw as VerifiablePresentationV1.JSON);
    } catch (e) {
      this.o.log?.(`idproof · malformed presentation, shape: ${shapeOf(input.presentation)}`);
      throw new Error(`malformed presentation: ${e instanceof Error ? e.message : String(e)}`);
    }
    // The request anchor must be on chain and match what we issued.
    const anchor = await VerificationRequestV1.verifyAnchor(p.request, this.o.grpc);
    // web-sdk 12.0.2 calls its own context comparison without awaiting it, so we enforce it here: same nonce,
    // connection, resource and context string as issued, and the BlockHash the wallet filled in must be the block
    // that holds our request anchor (that is what makes the proof fresh and single-use).
    checkContext(p.request.toJSON(), presentation.toJSON(), BlockHash.toHexString(anchor.blockHash));
    const id = randomUUID();
    const out = await this.serial(async () => VerificationAuditRecordV1.createAndAnchor(id, p.request, presentation, this.o.grpc, { metadata: await this.anchorMeta(), info: { app: 'sentinel', wallet: p.wallet } }, { network: this.sdkNetwork }));
    if (out.type === 'failed') throw new Error(`proof rejected: ${out.error.message}`);
    this.pending.delete(input.requestTx);
    const auditTx = TransactionHash.toHexString(out.result.anchorTransactionRef);
    const record: CreatorProofRecord = {
      wallet: p.wallet, claims: ['age>=18'], verifiedAt: Math.floor(Date.now() / 1000), requestTx: input.requestTx, auditTx, auditRecordId: id,
      requestExplorer: explorerTx(this.o.network, input.requestTx), auditExplorer: explorerTx(this.o.network, auditTx),
    };
    this.byWallet.set(p.wallet, record);
    if (this.file) appendFileSync(this.file, JSON.stringify(record) + '\n');
    // The VAR holds the request and the ZK presentation (no attribute values): kept so anyone can re-check the CCDVAA hash.
    if (this.varFile) appendFileSync(this.varFile, JSON.stringify(out.result.record.toJSON()) + '\n');
    this.o.log?.(`idproof · verified ${p.wallet.slice(0, 6)}… · audit ${auditTx.slice(0, 12)}…`);
    return record;
  }
}
