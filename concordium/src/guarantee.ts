// The verdict guarantee: a paid SAFE that turns out to be a rug is refunded, automatically.
//
// 1. A paid verdict is recorded only after the x402 payment has settled: the receipt holds the payer, the
//    settlement transaction, the amount and the verdict digest (a call that never settled can never be refunded).
// 2. When the resolver grades that verdict at the guarantee horizon (24 h), the book closes the receipt:
//    SAFE + rugged → the price goes back to the payer as a CCD transfer whose memo names the verdict digest;
//    anything else → closed, kept.
// 3. Everything is public at GET /guarantee: the terms, the pool account, every receipt and every refund.
//
// The pool is an ordinary account Sentinel funds; Protocol-Level Locks will hold it on-chain once they ship.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { AccountAddress } from '@concordium/web-sdk';
import { explorerTx, transferCcd, type Account } from './chain.js';
import type { Network } from './registry.js';
import type { StoredVerdict } from './service.js';

export interface GuaranteeTerms {
  /** bands the guarantee covers */
  bands: string[];
  /** horizon (seconds) whose grade decides the claim; must be one the resolver grades */
  horizon: number;
  /** share of the price refunded, 0..1 */
  share: number;
}
export const DEFAULT_TERMS: GuaranteeTerms = { bands: ['SAFE'], horizon: 86_400, share: 1 };

export interface Receipt {
  digest: string;
  mint: string;
  verdict: string;
  payer: string;
  paymentTx: string;
  /** smallest unit of the asset (microCCD for CCD) */
  amount: string;
  asset: string;
  at: number;
}
export interface Closure { digest: string; paymentTx: string; status: 'refunded' | 'kept' | 'failed'; refundTx: string | null; amount: string; at: number; reason: string }

export interface GuaranteeOptions {
  network: Network;
  /** the account refunds are paid from; null runs the book read-only (claims are reported, never paid) */
  pool: Account | null;
  client: ConcordiumGRPCNodeClient | null;
  lookup: (digest: string) => StoredVerdict | null | undefined;
  dataDir?: string | null;
  terms?: Partial<GuaranteeTerms>;
  log?: (m: string) => void;
  now?: () => number;
  /** injected in tests */
  transfer?: (to: string, amount: bigint, memo: string) => Promise<{ hash: string }>;
}

const DIGEST = /^[0-9a-f]{64}$/;
const span = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

export class GuaranteeBook {
  readonly terms: GuaranteeTerms;
  private readonly receipts = new Map<string, Receipt>();
  private readonly closures = new Map<string, Closure>();
  private readonly file: string | null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly o: GuaranteeOptions) {
    this.terms = { ...DEFAULT_TERMS, ...o.terms };
    this.file = o.dataDir ? join(o.dataDir, 'guarantee.jsonl') : null;
    if (this.file && existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as { receipt?: Receipt; closure?: Closure };
        if (e.receipt) this.receipts.set(e.receipt.paymentTx, e.receipt);
        if (e.closure) this.closures.set(e.closure.paymentTx, e.closure);
      }
    }
  }

  private persist(e: { receipt?: Receipt; closure?: Closure }) {
    if (!this.file) return;
    mkdirSync(this.o.dataDir!, { recursive: true });
    appendFileSync(this.file, JSON.stringify(e) + '\n');
  }

  /** Record a settled payment for a verdict. Idempotent on the settlement transaction. */
  record(r: Omit<Receipt, 'at' | 'mint' | 'verdict'> & { at?: number }): Receipt | null {
    if (!DIGEST.test(r.digest) || !/^[0-9a-f]{64}$/i.test(r.paymentTx) || this.receipts.has(r.paymentTx)) return null;
    try { AccountAddress.fromBase58(r.payer); } catch { return null; }
    const v = this.o.lookup(r.digest);
    if (!v) return null;
    const receipt: Receipt = { ...r, mint: v.mint, verdict: v.verdict, at: r.at ?? this.now() };
    this.receipts.set(r.paymentTx, receipt);
    this.persist({ receipt });
    this.o.log?.(`guarantee · receipt ${v.verdict} ${v.mint.slice(0, 6)} · ${r.payer.slice(0, 8)}… paid ${r.amount} ${r.asset}`);
    return receipt;
  }

  private now() { return this.o.now?.() ?? Math.floor(Date.now() / 1000); }

  /** Close every receipt whose verdict has been graded at the guarantee horizon. */
  async tick(): Promise<Closure[]> {
    if (this.running) return [];
    this.running = true;
    const made: Closure[] = [];
    try {
      for (const r of this.receipts.values()) {
        const prev = this.closures.get(r.paymentTx);
        if (prev && prev.status !== 'failed') continue;
        const v = this.o.lookup(r.digest);
        const outcome = v?.outcomes?.find(x => x.horizon === this.terms.horizon);
        if (!v || !outcome) continue;
        const covered = this.terms.bands.includes(v.verdict);
        const base = { digest: r.digest, paymentTx: r.paymentTx, at: this.now() };
        if (!covered || !outcome.rugged) {
          const c: Closure = { ...base, status: 'kept', refundTx: null, amount: '0', reason: !covered ? `${v.verdict} is not covered` : `alive at +${this.terms.horizon}s` };
          this.close(c, made);
          continue;
        }
        const amount = (BigInt(r.amount) * BigInt(Math.round(this.terms.share * 1000))) / 1000n;
        if (r.asset !== 'CCD') { this.close({ ...base, status: 'failed', refundTx: null, amount: amount.toString(), reason: `refunds in ${r.asset} are not enabled yet` }, made); continue; }
        if (!this.o.transfer && !(this.o.pool && this.o.client)) { this.close({ ...base, status: 'failed', refundTx: null, amount: amount.toString(), reason: 'no refund pool configured' }, made); continue; }
        // Memo names the verdict, so anyone can match a refund on the explorer to the call it answers.
        const memo = `sentinel refund ${r.digest}`;
        try {
          const tx = this.o.transfer ? await this.o.transfer(r.payer, amount, memo) : await transferCcd(this.o.client!, this.o.network, this.o.pool!, r.payer, amount, memo);
          this.close({ ...base, status: 'refunded', refundTx: tx.hash, amount: amount.toString(), reason: `SAFE, rugged by +${this.terms.horizon}s: ${outcome.labels.join(', ') || 'rug'}` }, made);
        } catch (e) {
          this.close({ ...base, status: 'failed', refundTx: null, amount: amount.toString(), reason: `refund failed, retried next tick: ${e instanceof Error ? e.message : String(e)}` }, made);
        }
      }
    } finally { this.running = false; }
    return made;
  }

  private close(c: Closure, made: Closure[]) {
    const prev = this.closures.get(c.paymentTx);
    this.closures.set(c.paymentTx, c);
    // A failure is retried every tick; log and persist it once, not on every retry.
    if (c.status === 'failed' && prev?.status === 'failed' && prev.reason === c.reason) return;
    this.persist({ closure: c });
    made.push(c);
    this.o.log?.(`guarantee · ${c.status} ${c.digest.slice(0, 8)}${c.refundTx ? ` · ${explorerTx(this.o.network, c.refundTx)}` : ''} · ${c.reason}`);
  }

  report(limit = 50) {
    const rows = [...this.receipts.values()].sort((a, b) => b.at - a.at);
    const closed = [...this.closures.values()];
    const refunded = closed.filter(c => c.status === 'refunded');
    return {
      terms: { ...this.terms, statement: `A paid ${this.terms.bands.join('/')} verdict on a token that rugs within ${span(this.terms.horizon)} is refunded${this.terms.share < 1 ? ` (${this.terms.share * 100}%)` : ''} to the paying account, automatically.` },
      pool: this.o.pool ? { account: this.o.pool.address.toString(), explorer: `https://${this.o.network === 'mainnet' ? '' : 'testnet.'}ccdscan.io/?dcount=1&dentity=account&daddress=${this.o.pool.address.toString()}` } : null,
      counts: {
        paid: rows.length,
        covered: rows.filter(r => this.terms.bands.includes(r.verdict)).length,
        open: rows.filter(r => !this.closures.has(r.paymentTx) || this.closures.get(r.paymentTx)!.status === 'failed').length,
        kept: closed.filter(c => c.status === 'kept').length,
        refunded: refunded.length,
        refundedAmount: refunded.reduce((s, c) => s + BigInt(c.amount), 0n).toString(),
      },
      receipts: rows.slice(0, limit).map(r => ({ ...r, closure: this.closures.get(r.paymentTx) ?? null })),
    };
  }

  /** What one verdict's buyers can claim; null when nobody paid for it. */
  forDigest(digest: string) {
    const rs = [...this.receipts.values()].filter(r => r.digest === digest);
    return rs.length ? rs.map(r => ({ payer: r.payer, paymentTx: r.paymentTx, amount: r.amount, asset: r.asset, closure: this.closures.get(r.paymentTx) ?? null })) : null;
  }

  start(everyMs = 5 * 60_000): void {
    if (this.timer) return;
    const run = () => { this.tick().catch(e => this.o.log?.(`guarantee · ${e instanceof Error ? e.message : e}`)); };
    this.timer = setInterval(run, everyMs);
    this.timer.unref?.();
    setTimeout(run, 5_000).unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

/** x402 PAYMENT-RESPONSE header → settled payer and transaction, or null. */
export function settledPayment(header: string | null | undefined): { payer: string; transaction: string } | null {
  if (!header) return null;
  try {
    const r = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { success?: boolean; payer?: string; transaction?: string };
    return r.success && r.payer && r.transaction ? { payer: r.payer, transaction: r.transaction } : null;
  } catch { return null; }
}
