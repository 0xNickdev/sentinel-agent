// The Sentinel gateway: serves the Agent Cards byte-exact (what the registry
// hash pins), sells verdicts over x402, and appends every verdict to the audit
// contract through the shared VerdictService. MCP and A2A mount on the same
// app from `mcp/`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { TokenSnapshot } from '@sentinel/engine';
import { ATTEST_ALG, type SwarmEvent } from '@sentinel/agents';
import { SENTINEL_AGENT_KEYS, type SentinelAgentKey } from './agents-manifest.js';
import type { VerdictService } from './service.js';
import { trackReport } from './track.js';
import { paywall, type PaywallOptions } from './x402.js';

export interface GatewayOptions {
  /** directory with the hosted cards: <dir>/gateway.json, <dir>/<key>.json */
  cardsDir: string;
  service: VerdictService;
  paywall?: PaywallOptions | null;
  /** expose GET /stream/verdict (SSE of swarm events, unpaid) for the showcase site; default true */
  publicStream?: boolean;
  log?: (m: string) => void;
}

export const cardPath = (key: SentinelAgentKey) => (key === 'gateway' ? '/.well-known/agent-card.json' : `/agents/${key}/agent-card.json`);

export function gatewayApp(o: GatewayOptions): Hono {
  const app = new Hono();

  // Cards are served from disk, byte for byte: the registry compares sha256 of this body.
  for (const key of SENTINEL_AGENT_KEYS) {
    app.get(cardPath(key), c => {
      const file = join(o.cardsDir, `${key}.json`);
      if (!existsSync(file)) return c.text('card not built yet', 404);
      return c.body(readFileSync(file), 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
    });
  }
  app.get('/healthz', c => c.json({ ok: true, paywall: Boolean(o.paywall) }));
  // Public keys: verify any Sentinel verdict offline (ML-DSA-65 over digest ‖ mint ‖ verdict ‖ score ‖ at).
  app.get('/.well-known/sentinel-keys.json', c => c.json({ attestation: { alg: ATTEST_ALG, publicKey: o.service.keys.publicKeyHex, ephemeral: o.service.keys.ephemeral, context: 'sentinel.verdict/1' } }));

  if (o.publicStream !== false) {
    // Live swarm for the site: one SSE stream per request, events as they happen, verdict last.
    app.get('/stream/verdict', c => {
      const mint = c.req.query('mint') ?? '';
      const fresh = c.req.query('fresh') === '1';
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start: async controller => {
          const send = (ev: SwarmEvent | { type: 'error'; error: string }) => controller.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
          try {
            await o.service.verdict(mint, ev => { if (ev.type !== 'verdict') send(ev); }, fresh ? { fresh: true } : {}).then(v => send({ type: 'verdict', verdict: v }));
          } catch (e) {
            send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
    });
  }
  // Live launches (pump.fun creates off Geyser): JSON snapshot and an SSE stream for the site.
  app.get('/launches', c => c.json({ enabled: o.service.launchFeedEnabled, launches: o.service.launches(Number(c.req.query('limit') ?? 50)) }));
  if (o.publicStream !== false) {
    app.get('/stream/launches', c => {
      if (!o.service.launchFeedEnabled) return c.json({ enabled: false }, 404);
      const encoder = new TextEncoder();
      let off: (() => void) | null = null, ping: NodeJS.Timeout | null = null;
      const stream = new ReadableStream({
        start: controller => {
          const send = (event: string, data: unknown) => { try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { off?.(); } };
          for (const ev of o.service.launches(8).reverse()) send('launch', ev);
          off = o.service.onLaunch(ev => send('launch', ev));
          ping = setInterval(() => send('ping', { at: Date.now() }), 15_000);
        },
        cancel: () => { off?.(); if (ping) clearInterval(ping); },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
    });
  }
  app.get('/verdicts', c => c.json(o.service.recent(Number(c.req.query('limit') ?? 20)).map(summary)));
  // The track: every sealed verdict scored against what happened (Brier, log score, reliability, per specialist).
  app.get('/track', c => c.json(trackReport(o.service.all())));
  app.get('/verdicts/:digest', c => { const v = o.service.lookup({ digest: c.req.param('digest') }); return v ? c.json(v) : c.json({ error: 'unknown digest' }, 404); });

  if (o.paywall) app.use(paywall(o.paywall));

  app.post('/x402/verdict', async c => {
    const body = (await c.req.json().catch(() => ({}))) as { mint?: string; snapshot?: TokenSnapshot; fresh?: boolean };
    const mint = body.mint ?? body.snapshot?.mint;
    if (!mint) return c.json({ error: 'mint required' }, 400);
    try {
      const v = await o.service.verdict(mint, undefined, { ...(body.snapshot ? { snapshot: body.snapshot } : {}), ...(body.fresh ? { fresh: true } : {}) });
      return c.json(v);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  return app;
}

export const summary = (v: { mint: string; verdict: string; riskScore: number; confidence: number; at: number; attestation: { digest: string; concordiumTx: string | null }; stored?: { at: number } }) =>
  ({ mint: v.mint, verdict: v.verdict, riskScore: v.riskScore, confidence: v.confidence, at: v.at, digest: v.attestation.digest, concordiumTx: v.attestation.concordiumTx, storedAt: v.stored?.at ?? null, outcomes: (v as { outcomes?: Array<{ horizon: number; rugged: boolean }> }).outcomes?.map(o => ({ horizon: o.horizon, rugged: o.rugged })) ?? [] });
