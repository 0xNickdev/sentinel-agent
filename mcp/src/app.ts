// The whole Sentinel surface in one Hono app: cards + x402 (gateway), MCP, A2A.
// The MCP endpoint is paywalled only for `tools/call sentinel_verdict`, so
// discovery (initialize, tools/list, sentinel_agents, badge checks) stays free.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { gatewayApp, paywall, type PaywallOptions, type VerdictService, type Network } from '@sentinel/concordium';
import { rateLimit } from './hardening.js';
import { badgeExtension, mountA2A } from './a2a.js';
import { agentDirectory, mountMcp, type McpOptions } from './mcp-server.js';

export interface SentinelAppOptions {
  service: VerdictService;
  cardsDir: string;
  network: Network;
  baseUrl: string;
  paywall?: PaywallOptions | null;
  /** browser origins allowed to call the API (the showcase site); empty = same-origin only */
  corsOrigins?: string[];
  /** requests per minute per client IP on unpaid routes (default 60; 0 disables) */
  rateLimitPerMinute?: number;
  publicStream?: boolean;
  log?: (m: string) => void;
}

export function sentinelApp(o: SentinelAppOptions): Hono {
  const registryFile = join(o.cardsDir, 'registry.json');
  const registry = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) as McpOptions['registry'] : undefined;
  const gatewayCard = join(o.cardsDir, 'gateway.json');
  const mcpOpts: McpOptions = { service: o.service, network: o.network, baseUrl: o.baseUrl, ...(registry ? { registry } : {}), priceMicroCcd: o.paywall?.priceMicroCcd ?? null };

  const app = new Hono();
  // Edge hygiene first: headers, request size, origins, abuse throttling.
  app.use(secureHeaders({ crossOriginResourcePolicy: 'cross-origin', contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }));
  app.use(bodyLimit({ maxSize: 256 * 1024, onError: c => c.json({ error: 'request body too large' }, 413) }));
  if (o.corsOrigins?.length) app.use(cors({ origin: o.corsOrigins, allowHeaders: ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'a2a-version', 'payment-signature'], exposeHeaders: ['payment-required', 'payment-response', 'mcp-session-id'], maxAge: 600 }));
  if (o.rateLimitPerMinute !== 0) app.use(rateLimit({ perMinute: o.rateLimitPerMinute ?? 60, skip: c => c.req.method === 'GET' && (c.req.path.startsWith('/.well-known/') || c.req.path === '/healthz') }));
  if (o.paywall) {
    // Pay per verdict, not per protocol message: only MCP tools/call sentinel_verdict goes through the x402 gate.
    const gate = paywall({ ...o.paywall, routes: ['POST /mcp'], description: 'Sentinel swarm verdict (MCP tools/call sentinel_verdict)' });
    app.use('/mcp', async (c, next) => {
      if (c.req.method !== 'POST') return next();
      const body = await c.req.raw.clone().json().catch(() => null) as { method?: string; params?: { name?: string } } | null;
      const paid = body?.method === 'tools/call' && body.params?.name === 'sentinel_verdict';
      return paid ? gate(c, next) : next();
    });
  }
  // REST twin of the sentinel_agents tool for the showcase site.
  app.get('/api/agents', c => c.json({ network: o.network, agents: agentDirectory(mcpOpts), price: o.paywall ? { microCcd: o.paywall.priceMicroCcd, payTo: o.paywall.payTo } : null, attestation: { alg: 'ML-DSA-65', publicKey: o.service.keys.publicKeyHex } }));
  mountMcp(app, '/mcp', mcpOpts);
  // A2A JSON-RPC lives at /a2a (GET there returns the live A2A card). /.well-known/agent-card.json is the registered card,
  // served byte-exact by the gateway below: the registry pins its sha256, so nothing may generate it on the fly.
  mountA2A(app, ['/a2a'], mcpOpts, badgeExtension(existsSync(gatewayCard) ? readFileSync(gatewayCard, 'utf8') : null));
  if (!existsSync(gatewayCard)) mountA2A(app, ['/.well-known/agent-card.json'], mcpOpts, null);
  // The gateway serves GET /.well-known/agent-card.json (registry card, byte-exact) and x402 + verdict listing routes.
  app.route('/', gatewayApp({ cardsDir: o.cardsDir, service: o.service, paywall: o.paywall ?? null, ...(o.publicStream === undefined ? {} : { publicStream: o.publicStream }), ...(o.log ? { log: o.log } : {}) }));
  return app;
}
