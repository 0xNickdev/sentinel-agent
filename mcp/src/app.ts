// The whole Sentinel surface in one Hono app: cards + x402 (gateway), MCP, A2A.
// The MCP endpoint is paywalled only for `tools/call sentinel_verdict`, so
// discovery (initialize, tools/list, sentinel_agents, badge checks) stays free.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { acceptedPayment, gatewayApp, paywall, settledPayment, type CreatorProofs, type GuaranteeBook, type PaywallOptions, type VerdictService, type Network } from '@sentinel/concordium';
import { rateLimit } from './hardening.js';
import { badgeExtension, mountA2A } from './a2a.js';
import { agentDirectory, mountMcp, verdictView, type McpOptions } from './mcp-server.js';
import { IdempotencyStore, llmsTxt, paidCallGuard } from './onboarding.js';

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
  /** Concordium ID proofs for creator wallets; the /id routes answer 503 without it */
  creatorProofs?: CreatorProofs | null;
  /** the verdict guarantee; paid verdicts are recorded once their payment settles */
  guarantee?: GuaranteeBook | null;
  /** public site, linked from /llms.txt (default https://sentinelagent.pro) */
  siteUrl?: string;
  log?: (m: string) => void;
}

export function sentinelApp(o: SentinelAppOptions): Hono {
  const registryFile = join(o.cardsDir, 'registry.json');
  const registry = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) as McpOptions['registry'] : undefined;
  const gatewayCard = join(o.cardsDir, 'gateway.json');
  // CIS-8 binding of Sentinel's Solana key to the owner (cis8-bind.ts); shown on the agents page.
  const cis8File = join(o.cardsDir, 'cis8.json');
  const cis8 = existsSync(cis8File) ? JSON.parse(readFileSync(cis8File, 'utf8')) as Record<string, unknown> : null;
  const mcpOpts: McpOptions = { service: o.service, network: o.network, baseUrl: o.baseUrl, ...(registry ? { registry } : {}), priceMicroCcd: o.paywall?.priceMicroCcd ?? null };

  const app = new Hono();
  // Edge hygiene first: headers, request size, origins, abuse throttling.
  app.use(secureHeaders({ crossOriginResourcePolicy: 'cross-origin', contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }));
  app.use(bodyLimit({ maxSize: 256 * 1024, onError: c => c.json({ error: 'request body too large' }, 413) }));
  if (o.corsOrigins?.length) app.use(cors({ origin: o.corsOrigins, allowHeaders: ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'a2a-version', 'payment-signature'], exposeHeaders: ['payment-required', 'payment-response', 'mcp-session-id'], maxAge: 600 }));
  if (o.rateLimitPerMinute !== 0) app.use(rateLimit({ perMinute: o.rateLimitPerMinute ?? 60, skip: c => c.req.method === 'GET' && (c.req.path.startsWith('/.well-known/') || c.req.path === '/healthz') }));
  // Paid doors: idempotent retries and a caller-set price ceiling, checked before the x402 gate so neither ever charges.
  const guard = paidCallGuard({ service: o.service, store: new IdempotencyStore(), priceMicroCcd: o.paywall?.priceMicroCcd ?? null, view: v => verdictView(v, mcpOpts) });
  app.use('/mcp', guard);
  app.use('/x402/verdict', guard);
  const llms = llmsTxt({ baseUrl: o.baseUrl, siteUrl: o.siteUrl ?? 'https://sentinelagent.pro', network: o.network, priceMicroCcd: o.paywall?.priceMicroCcd ?? null, payTo: o.paywall?.payTo ?? null });
  app.get('/llms.txt', c => c.text(llms, 200, { 'cache-control': 'public, max-age=300' }));
  // Guarantee receipts: after the x402 layer has settled (PAYMENT-RESPONSE carries payer and transaction), read the
  // verdict digest from the answer and record who paid for it. Unsettled or replayed calls carry no receipt.
  const book = o.guarantee ?? null;
  if (book && o.paywall) {
    const price = o.paywall.priceMicroCcd;
    const recordPaid: MiddlewareHandler = async (c, next) => {
      await next();
      const paid = settledPayment(c.res.headers.get('payment-response'));
      if (!paid) return;
      // The MCP answer may be an SSE stream: read a clone in the background, never hold the response.
      void c.res.clone().text().then(text => {
        const digest = /"digest"\s*:\s*"([0-9a-f]{64})"/.exec(text)?.[1];
        // The payer chose CCD or the PLT price; the PAYMENT-SIGNATURE header says which, so the refund matches it.
        const acc = acceptedPayment(c.req.header('payment-signature'));
        if (digest) book.record({ digest, payer: paid.payer, paymentTx: paid.transaction, amount: acc?.amount ?? price, asset: acc?.asset ?? 'CCD' });
        else o.log?.(`guarantee · settled ${paid.transaction.slice(0, 8)} but no verdict digest in the answer`);
      }).catch(e => o.log?.(`guarantee · receipt failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    app.use('/mcp', recordPaid);
    app.use('/x402/verdict', recordPaid);
  }
  app.get('/guarantee', c => (book ? c.json(book.report(Number(c.req.query('limit') ?? 50))) : c.json({ error: 'the guarantee needs the paywall' }, 404)));
  app.get('/guarantee/:digest', c => {
    if (!book) return c.json({ error: 'the guarantee needs the paywall' }, 404);
    const d = c.req.param('digest');
    return c.json({ digest: d, terms: book.terms, buyers: book.forDigest(d) ?? [] });
  });
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
  app.get('/api/agents', c => c.json({ network: o.network, agents: agentDirectory(mcpOpts), price: o.paywall ? { microCcd: o.paywall.priceMicroCcd, payTo: o.paywall.payTo, ...(o.paywall.plt ? { plt: o.paywall.plt } : {}) } : null, attestation: { alg: 'ML-DSA-65', publicKey: o.service.keys.publicKeyHex }, cis8 }));
  // Fast tier: engine rules only, no models, free and rate limited like every unpaid route.
  app.get('/quick/:mint', async c => {
    const mint = c.req.param('mint');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return c.json({ error: 'not a Solana mint' }, 400);
    try { return c.json(await o.service.quick(mint), 200, { 'cache-control': 'public, max-age=30' }); }
    catch (e) { o.log?.(`quick · ${mint.slice(0, 6)} failed: ${e instanceof Error ? e.message : String(e)}`); return c.json({ error: 'quick check failed' }, 502); }
  });
  // Verified creators (Concordium Verify and Access, in-process). Free: the sponsor pays both anchors.
  const ids = o.creatorProofs ?? null;
  const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  app.get('/id/creator/:wallet', c => {
    const w = c.req.param('wallet');
    if (!SOL.test(w)) return c.json({ error: 'not a Solana address' }, 400);
    const r = ids?.get(w) ?? null;
    return c.json({ wallet: w, verified: Boolean(r), proof: r });
  });
  app.get('/id/proofs', c => c.json({ enabled: Boolean(ids), proofs: (ids?.all() ?? []).slice(0, 50) }));
  app.post('/id/request', async c => {
    if (!ids) return c.json({ error: 'creator proofs are not enabled on this server' }, 503);
    const body = await c.req.json().catch(() => null) as { wallet?: string; connectionId?: string } | null;
    if (!body?.wallet || !SOL.test(body.wallet)) return c.json({ error: 'body must be {"wallet": "<Solana address>", "connectionId"?: "<WalletConnect topic>"}' }, 400);
    if (body.connectionId !== undefined && !/^[0-9a-f]{64}$/i.test(body.connectionId)) return c.json({ error: 'connectionId must be a WalletConnect session topic (64 hex)' }, 400);
    try { return c.json(await ids.request(body.wallet, body.connectionId)); }
    catch (e) { o.log?.(`idproof · request failed: ${e instanceof Error ? e.message : String(e)}`); return c.json({ error: e instanceof Error ? e.message : 'request failed' }, 502); }
  });
  app.post('/id/verify', async c => {
    if (!ids) return c.json({ error: 'creator proofs are not enabled on this server' }, 503);
    const body = await c.req.json().catch(() => null) as { requestTx?: string; presentation?: unknown; solanaSignature?: string } | null;
    if (!body?.requestTx || !/^[0-9a-f]{64}$/i.test(body.requestTx) || !body.presentation || typeof body.solanaSignature !== 'string') return c.json({ error: 'body must be {requestTx, presentation, solanaSignature}' }, 400);
    try { return c.json({ verified: true, proof: await ids.verify({ requestTx: body.requestTx, presentation: body.presentation, solanaSignature: body.solanaSignature }) }); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); o.log?.(`idproof · verify failed: ${m}`); return c.json({ verified: false, error: m }, 422); }
  });
  mountMcp(app, '/mcp', mcpOpts);
  // A2A JSON-RPC lives at /a2a (GET there returns the live A2A card). /.well-known/agent-card.json is the registered card,
  // served byte-exact by the gateway below: the registry pins its sha256, so nothing may generate it on the fly.
  mountA2A(app, ['/a2a'], mcpOpts, badgeExtension(existsSync(gatewayCard) ? readFileSync(gatewayCard, 'utf8') : null));
  if (!existsSync(gatewayCard)) mountA2A(app, ['/.well-known/agent-card.json'], mcpOpts, null);
  // The gateway serves GET /.well-known/agent-card.json (registry card, byte-exact) and x402 + verdict listing routes.
  app.route('/', gatewayApp({ cardsDir: o.cardsDir, service: o.service, paywall: o.paywall ?? null, ...(o.publicStream === undefined ? {} : { publicStream: o.publicStream }), ...(o.log ? { log: o.log } : {}) }));
  return app;
}
