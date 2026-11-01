// The Sentinel server: Agent Cards + x402 verdicts + audit (gateway), MCP at
// /mcp, A2A at /a2a. Reads .env; every Concordium piece is optional in dev.
//   node mcp/dist/scripts/serve.js
import { serve } from '@hono/node-server';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapFromEnv } from '@sentinel/concordium';
import { sentinelApp } from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const b = bootstrapFromEnv(root);
const app = sentinelApp({ service: b.service, cardsDir: b.cardsDir, network: b.network, baseUrl: b.baseUrl, paywall: b.paywall, corsOrigins: b.corsOrigins, log: b.log });
// Hosts such as Railway assign the port through PORT.
const port = Number(process.env.SENTINEL_GATEWAY_PORT ?? process.env.PORT ?? 4020);
b.resolver?.start();
b.sampler?.start();
serve({ fetch: app.fetch, port }, () => {
  b.log(`sentinel · http://localhost:${port} · public ${b.baseUrl}`);
  b.log(`  MCP  ${b.baseUrl}/mcp${b.paywall ? ` (sentinel_verdict paid: ${Number(b.paywall.priceMicroCcd) / 1e6} CCD)` : ' (free)'}`);
  b.log(`  A2A  ${b.baseUrl}/a2a · card ${b.baseUrl}/.well-known/agent-card.json`);
  b.log(`  x402 POST ${b.baseUrl}/x402/verdict · audit ${b.audit ? 'on' : 'off'}`);
  b.log(`  track ${b.baseUrl}/track · resolver ${b.resolver ? `on (${b.resolver.horizons.map(h => `${h}s`).join(', ')})` : 'off'}`);
});
