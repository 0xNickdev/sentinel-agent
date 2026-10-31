// `node dist/cli.js <mint>` — run the deterministic engine against a live
// Solana mint and print the evidence. Reads SOLANA_RPC_URL from the env.
import { SolanaAdapter } from './solana/adapter.js';
import { analyze } from './signals/index.js';
import { verdictDigest } from './digest.js';

const mint = process.argv[2];
if (!mint) { console.error('usage: sentinel-engine <mint>'); process.exit(1); }
const adapter = new SolanaAdapter({ rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', log: (m) => console.error('·', m) });
const t0 = Date.now();
const snap = await adapter.snapshot(mint);
const evidence = analyze(snap);
console.log(JSON.stringify({ mint, creator: snap.creator, trades: snap.trades.length, holders: snap.holders.length, evidence, digest: verdictDigest({ chain: 'solana', mint, at: snap.at, evidence }), ms: Date.now() - t0 }, null, 2));
