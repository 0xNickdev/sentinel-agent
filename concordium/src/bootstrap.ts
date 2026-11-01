// Wire the Concordium side from .env: network, accounts, facilitator,
// paywall, audit client, verdict service, demo snapshots. Everything is
// optional so the server comes up in dev with nothing configured and gains
// pieces as keys and deployments appear.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { loadEnv } from '@sentinel/agents';
import { LaunchFeed, type TokenSnapshot } from '@sentinel/engine';
import { AuditClient } from './audit.js';
import { Resolver } from './track.js';
import { LaunchSampler } from './sampler.js';
import { accountFromEnv, nodeClient } from './chain.js';
import type { Network } from './registry.js';
import { VerdictService } from './service.js';
import { facilitatorApp, type PaywallOptions } from './x402.js';

export interface Bootstrap {
  network: Network;
  baseUrl: string;
  cardsDir: string;
  dataDir: string;
  service: VerdictService;
  paywall: PaywallOptions | null;
  facilitatorUrl: string | null;
  audit: boolean;
  /** browser origins allowed to call the API directly (SENTINEL_CORS_ORIGINS, comma-separated); dev defaults to localhost sites */
  corsOrigins: string[];
  /** grades sealed verdicts against outcomes at fixed horizons; null when SENTINEL_RESOLVER=0 */
  resolver: Resolver | null;
  /** judges random live launches on a clock to feed the track; null unless SENTINEL_SAMPLER_EVERY_MIN is set */
  sampler: LaunchSampler | null;
  log: (m: string) => void;
}

export function bootstrapFromEnv(root: string, log: (m: string) => void = m => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`)): Bootstrap {
  loadEnv();
  const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
  const cardsDir = process.env.SENTINEL_CARDS_DIR ?? join(root, 'concordium', 'cards');
  const dataDir = process.env.SENTINEL_DATA_DIR ?? join(root, 'concordium', 'data');
  const baseUrl = process.env.SENTINEL_BASE_URL ?? `http://localhost:${process.env.SENTINEL_GATEWAY_PORT ?? 4020}`;

  // x402: facilitator in-process when we hold the sponsor key, external when a URL is given, off otherwise.
  const sponsor = accountFromEnv('CONCORDIUM_SPONSOR');
  let facilitatorUrl = process.env.X402_FACILITATOR_URL || null;
  if (sponsor && !facilitatorUrl) {
    const port = Number(process.env.X402_FACILITATOR_PORT ?? 4021);
    serve({ fetch: facilitatorApp({ network, sponsor }).fetch, port });
    facilitatorUrl = `http://localhost:${port}`;
    log(`facilitator · ${facilitatorUrl} · sponsor ${sponsor.address.toString()}`);
  }
  const payTo = process.env.CONCORDIUM_PAY_TO || accountFromEnv('CONCORDIUM_OWNER')?.address.toString() || null;
  const paywall: PaywallOptions | null = facilitatorUrl && payTo
    ? { network, payTo, facilitatorUrl, priceMicroCcd: process.env.X402_PRICE_MICROCCD ?? '1000000', routes: ['POST /x402/verdict'] }
    : null;
  if (!paywall) log('paywall · off (set CONCORDIUM_SPONSOR_WALLET or X402_FACILITATOR_URL, plus CONCORDIUM_PAY_TO or CONCORDIUM_OWNER_WALLET)');

  // Audit: needs the deployed contract address and the submitter key.
  const auditFile = join(cardsDir, 'audit-contract.json');
  const submitter = accountFromEnv('CONCORDIUM_SUBMITTER') ?? accountFromEnv('CONCORDIUM_OWNER');
  const registryFile = join(cardsDir, 'registry.json');
  const agentIds = existsSync(registryFile) ? Object.values(JSON.parse(readFileSync(registryFile, 'utf8')) as Record<string, { tokenId: number }>).map(r => r.tokenId) : [];
  const audit = existsSync(auditFile) && submitter
    ? { client: new AuditClient({ client: nodeClient(network, process.env.CONCORDIUM_NODE), network, contract: (JSON.parse(readFileSync(auditFile, 'utf8')) as { contract: { index: number; subindex: number } }).contract, log }), submitter, agentIds, network }
    : null;
  if (!audit) log('audit · off (deploy the contract: node concordium/dist/scripts/deploy-audit.js)');

  // Launch feed: pump.fun creates over Shyft Yellowstone gRPC; optional, and a failing feed only logs.
  let launchFeed: LaunchFeed | null = null;
  if (process.env.SHYFT_GRPC_URL && process.env.SHYFT_GRPC_TOKEN) {
    try { launchFeed = new LaunchFeed({ url: process.env.SHYFT_GRPC_URL, token: process.env.SHYFT_GRPC_TOKEN, log }); } catch (e) { log(`launch · feed disabled: ${e instanceof Error ? e.message : String(e)}`); }
  } else log('launch · off (set SHYFT_GRPC_URL and SHYFT_GRPC_TOKEN for the live launch feed)');

  const service = new VerdictService({ rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', audit, dataDir, launchFeed, log });

  // Demo snapshots: pre-warmed TokenSnapshot JSON files so the demo never waits on RPC.
  const seedDir = process.env.SENTINEL_SEED_SNAPSHOTS;
  if (seedDir && existsSync(seedDir)) {
    for (const f of readdirSync(seedDir).filter(f => f.endsWith('.json'))) {
      try { const s = JSON.parse(readFileSync(join(seedDir, f), 'utf8')) as TokenSnapshot; if (s.mint && s.holders) { service.seed(s); log(`seed · ${s.mint} from ${f}`); } } catch { /* not a snapshot */ }
    }
  }
  // Resolver: the track. Off only when asked; without the audit contract it still grades locally.
  const resolver = process.env.SENTINEL_RESOLVER === '0' ? null : new Resolver({
    service, audit, log,
    ...(process.env.SENTINEL_RESOLVE_EVERY_S ? { intervalMs: Number(process.env.SENTINEL_RESOLVE_EVERY_S) * 1000 } : {}),
    ...(process.env.SENTINEL_RESOLVE_HORIZONS ? { horizons: process.env.SENTINEL_RESOLVE_HORIZONS.split(',').map(Number).filter(n => n > 0) } : {}),
  });
  if (!resolver) log('resolve · off (SENTINEL_RESOLVER=0)');
  // Sampler: unbiased calls for the track. Costs model tokens per run, so it is opt-in with a daily cap.
  const everyMin = Number(process.env.SENTINEL_SAMPLER_EVERY_MIN ?? 0);
  const sampler = everyMin > 0 && launchFeed
    ? new LaunchSampler({ service, everyMin, perDay: Number(process.env.SENTINEL_SAMPLER_PER_DAY ?? 48), log })
    : null;
  log(sampler ? `sample · on: one launch every ${everyMin} min, at most ${process.env.SENTINEL_SAMPLER_PER_DAY ?? 48}/day` : 'sample · off (set SENTINEL_SAMPLER_EVERY_MIN to judge live launches for the track)');
  const corsOrigins = (process.env.SENTINEL_CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3100').split(',').map(s => s.trim()).filter(Boolean);
  return { network, baseUrl, cardsDir, dataDir, service, paywall, facilitatorUrl, audit: Boolean(audit), corsOrigins, resolver, sampler, log };
}
