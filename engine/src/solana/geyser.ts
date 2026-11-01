// Real-time launch feed: pump.fun `create` instructions straight off a
// Yellowstone Geyser gRPC stream (Shyft), decoded into LaunchEvents so a token
// can be judged a minute after it exists. Reconnects with backoff; the
// decoder is pure so it can be unit-tested with a hand-built instruction.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type * as yellowstone from '@triton-one/yellowstone-grpc';

// The gRPC client is a native module (napi). It is loaded on first connect, not at import, so a host without the
// platform binary loses only the launch feed, never the whole server.
// The package ships CJS-shaped types without "type": "module", so TS sees the class at `default.default`
// while Node loads the ESM build where it is `default`. Resolve whichever shape the runtime gives us.
type ClientClass = typeof yellowstone.default.default;
let clientClass: Promise<ClientClass> | null = null;
const loadClient = (): Promise<ClientClass> => (clientClass ??= import('@triton-one/yellowstone-grpc').then(m => {
  const r = m as unknown as { default: ClientClass | { default: ClientClass } };
  return typeof r.default === 'function' ? r.default : r.default.default;
}));
type SubscribeRequest = yellowstone.SubscribeRequest;
type SubscribeUpdate = yellowstone.SubscribeUpdate;

export const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const anchorDiscriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
/** Anchor discriminator of pump.fun `create` (legacy, SPL Token mints). */
export const PUMP_CREATE_DISCRIMINATOR = anchorDiscriminator('create');
/** pump.fun `create_v2` (Token-2022 mints, what the program emits since 2026). */
export const PUMP_CREATE_V2_DISCRIMINATOR = anchorDiscriminator('create_v2');

export interface LaunchEvent {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  signature: string;
  slot: number;
  /** unix seconds when we saw it */
  at: number;
}

export interface LaunchFeedOptions {
  /** gRPC endpoint, e.g. https://grpc.eu.shyft.to (TLS inferred from the scheme) */
  url: string;
  token: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  log?: (m: string) => void;
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i]! << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let s = '';
  for (const b of bytes) { if (b !== 0) break; s += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) s += ALPHABET[digits[i]!];
  return s;
}

/** Printable ASCII/Unicode letters only, trimmed, at most 32 chars. */
export function sanitiseLabel(s: string, max = 32): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\ufeff]/g, "").trim().slice(0, max);
}

function readBorshString(buf: Uint8Array, off: number): { value: string; next: number } | null {
  if (off + 4 > buf.length) return null;
  const len = buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24);
  if (len < 0 || off + 4 + len > buf.length) return null;
  return { value: new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(off + 4, off + 4 + len)), next: off + 4 + len };
}

export interface RawInstruction { programIdIndex: number; accounts: Uint8Array; data: Uint8Array }

/**
 * Decode a pump.fun `create` or `create_v2` instruction. Both start with
 * mint, mint_authority, bonding_curve, associated_bonding_curve, global; the
 * creator (`user`) is account 7 in `create` and account 5 in `create_v2`.
 * Data after the discriminator: Borsh strings name, symbol, uri, then the
 * creator pubkey (present in every current build; used when available).
 */
export function decodePumpCreate(ix: RawInstruction, accountKeys: string[]): Pick<LaunchEvent, 'mint' | 'creator' | 'name' | 'symbol'> | null {
  if (accountKeys[ix.programIdIndex] !== PUMP_FUN_PROGRAM) return null;
  if (ix.data.length < 8) return null;
  const isV1 = PUMP_CREATE_DISCRIMINATOR.every((b, i) => ix.data[i] === b);
  const isV2 = !isV1 && PUMP_CREATE_V2_DISCRIMINATOR.every((b, i) => ix.data[i] === b);
  if (!isV1 && !isV2) return null;
  const userIndex = isV1 ? 7 : 5;
  if (ix.accounts.length <= userIndex) return null;
  const name = readBorshString(ix.data, 8);
  if (!name) return null;
  const symbol = readBorshString(ix.data, name.next);
  if (!symbol) return null;
  const uri = readBorshString(ix.data, symbol.next);
  const mint = accountKeys[ix.accounts[0]!];
  const creator = uri && uri.next + 32 <= ix.data.length ? base58(ix.data.subarray(uri.next, uri.next + 32)) : accountKeys[ix.accounts[userIndex]!];
  if (!mint || !creator) return null;
  return { mint, creator, name: sanitiseLabel(name.value), symbol: sanitiseLabel(symbol.value, 16) };
}

/** Pull every `create` out of one Geyser transaction update (outer and inner instructions). */
export function launchesFromUpdate(u: SubscribeUpdate, now = Math.floor(Date.now() / 1000)): LaunchEvent[] {
  const tx = u.transaction?.transaction;
  const msg = tx?.transaction?.message;
  if (!tx || !msg || tx.meta?.err) return [];
  const keys = [...msg.accountKeys, ...(tx.meta?.loadedWritableAddresses ?? []), ...(tx.meta?.loadedReadonlyAddresses ?? [])].map(base58);
  const signature = base58(tx.signature);
  const slot = Number(u.transaction?.slot ?? 0);
  const out: LaunchEvent[] = [];
  const seen = new Set<string>();
  const consider = (ix: RawInstruction) => {
    const d = decodePumpCreate(ix, keys);
    if (d && !seen.has(d.mint)) { seen.add(d.mint); out.push({ ...d, signature, slot, at: now }); }
  };
  for (const ix of msg.instructions) consider(ix);
  for (const inner of tx.meta?.innerInstructions ?? []) for (const ix of inner.instructions) consider(ix);
  return out;
}

/** yellowstone CommitmentLevel values (PROCESSED 0, CONFIRMED 1, FINALIZED 2), inlined so importing this file needs no native module. */
const COMMITMENT = { processed: 0, confirmed: 1, finalized: 2 } as const;

export interface LaunchFeedEvents { launch: [LaunchEvent]; error: [Error]; connected: []; }

/**
 * Subscribes to pump.fun transactions over Yellowstone gRPC and emits
 * `launch` events. `start()` returns once the first subscription attempt is
 * made; failures are logged and retried with exponential backoff until `stop()`.
 */
export class LaunchFeed extends EventEmitter<LaunchFeedEvents> {
  private stopped = false;
  private stream: { destroy: () => void } | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;

  constructor(private readonly o: LaunchFeedOptions) { super(); }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stream?.destroy();
    this.stream = null;
  }

  /** Async iteration over launches; ends when `stop()` is called. */
  async *[Symbol.asyncIterator](): AsyncGenerator<LaunchEvent> {
    const queue: LaunchEvent[] = [];
    let wake: (() => void) | null = null;
    const onLaunch = (ev: LaunchEvent) => { queue.push(ev); wake?.(); };
    this.on('launch', onLaunch);
    try {
      while (!this.stopped) {
        if (queue.length) { yield queue.shift()!; continue; }
        await new Promise<void>(r => { wake = r; });
        wake = null;
      }
    } finally {
      this.off('launch', onLaunch);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const request: SubscribeRequest = {
      accounts: {}, slots: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, blockFooter: {}, accountsDataSlice: [],
      transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_FUN_PROGRAM], accountExclude: [], accountRequired: [] } },
      commitment: COMMITMENT[this.o.commitment ?? 'processed'],
    };
    try {
      const Client = await loadClient();
      const client = new Client(this.o.url, this.o.token, undefined);
      await client.connect();
      const stream = await client.subscribe();
      this.stream = stream;
      await new Promise<void>((resolve, reject) => stream.write(request, (e?: Error | null) => (e ? reject(e) : resolve())));
      this.attempt = 0;
      this.o.log?.(`geyser · subscribed to pump.fun creates (${this.o.url})`);
      this.emit('connected');
      stream.on('data', (u: SubscribeUpdate) => { for (const ev of launchesFromUpdate(u)) this.emit('launch', ev); });
      const done = (e?: Error) => { if (this.stream !== stream) return; this.stream = null; if (e) this.emit('error', e); this.retry(e ? e.message : 'stream ended'); };
      stream.on('error', done);
      stream.on('end', () => done());
      stream.on('close', () => done());
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.emit('error', err);
      this.retry(err.message);
    }
  }

  private retry(reason: string) {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.o.log?.(`geyser · ${reason}; reconnecting in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, delay);
  }
}
