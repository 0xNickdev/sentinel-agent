import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { cleanToken, rugToken } from '@sentinel/agents';
import { VerdictService } from '@sentinel/concordium';
import { sentinelApp } from '../src/app.js';
import { IdempotencyStore, paidCallGuard } from '../src/onboarding.js';
import { fakeLLM } from './fake-llm.js';

function makeApp() {
  let judged = 0;
  const llm = fakeLLM({ holders: 20, snipers: 90, funding: 95, creator: 90, contract: 100, market: 60, flows: 95 }, { verdict: 'DANGER', riskScore: 85 });
  const counting: typeof llm = { structured: req => { judged++; return llm.structured(req); } };
  const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', llm: counting });
  const rug = rugToken(); service.seed(rug);
  const clean = cleanToken(); service.seed(clean);
  const cardsDir = mkdtempSync(join(tmpdir(), 'cards-'));
  writeFileSync(join(cardsDir, 'registry.json'), '{}');
  const app = sentinelApp({ service, cardsDir, network: 'testnet', baseUrl: 'https://sentinel.example', rateLimitPerMinute: 0 });
  return { app, service, rug, clean, calls: () => judged };
}

const post = (app: Hono, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/x402/verdict', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('paying safely', () => {
  it('replays a paid verdict for a retried Idempotency-Key instead of running (and charging) again', async () => {
    const { app, rug, calls } = makeApp();
    const first = await post(app, { mint: rug.mint, fresh: true }, { 'idempotency-key': 'order-0001' });
    expect(first.status).toBe(200);
    const v1 = await first.json() as { attestation: { digest: string } };
    const used = calls();
    const again = await post(app, { mint: rug.mint, fresh: true }, { 'idempotency-key': 'order-0001' });
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect((await again.json() as { attestation: { digest: string } }).attestation.digest).toBe(v1.attestation.digest);
    expect(calls()).toBe(used);
  });

  it('refuses a key reused for another mint and a malformed key', async () => {
    const { app, rug, clean } = makeApp();
    expect((await post(app, { mint: rug.mint }, { 'idempotency-key': 'order-0002' })).status).toBe(200);
    const other = await post(app, { mint: clean.mint }, { 'idempotency-key': 'order-0002' });
    expect(other.status).toBe(409);
    expect((await post(app, { mint: rug.mint }, { 'idempotency-key': 'x' })).status).toBe(400);
  });

  it('replays over MCP with the same JSON-RPC shape', async () => {
    const { app, rug, calls } = makeApp();
    const transport = new StreamableHTTPClientTransport(new URL('http://sentinel.local/mcp'), { fetch: ((url: string | URL | Request, init?: RequestInit) => app.request(url instanceof Request ? url : url.toString(), init)) as typeof fetch });
    const client = new Client({ name: 'test-agent', version: '0.0.1' }, { capabilities: {} });
    await client.connect(transport);
    const args = { mint: rug.mint, fresh: true, idempotency_key: 'mcp-order-0001' };
    const a = await client.callTool({ name: 'sentinel_verdict', arguments: args }) as { structuredContent: { attestation: { digest: string } } };
    const used = calls();
    const b = await client.callTool({ name: 'sentinel_verdict', arguments: args }) as { structuredContent: { attestation: { digest: string } } };
    expect(b.structuredContent.attestation.digest).toBe(a.structuredContent.attestation.digest);
    expect(calls()).toBe(used);
    await client.close();
  });

  it('stops before payment when the price is above max_price_ccd', async () => {
    const app = new Hono();
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', llm: fakeLLM({}, { verdict: 'SAFE', riskScore: 5 }) });
    let reachedGate = false;
    app.use('/x402/verdict', paidCallGuard({ service, store: new IdempotencyStore(), priceMicroCcd: '2000000', view: v => v }));
    app.post('/x402/verdict', c => { reachedGate = true; return c.json({ ok: true }); });
    const mint = rugToken().mint;
    const r = await post(app, { mint, max_price_ccd: 1 });
    expect(r.status).toBe(412);
    expect(await r.json()).toMatchObject({ error: 'price_above_max', price_ccd: 2, max_price_ccd: 1, charged: false });
    expect(reachedGate).toBe(false);
    expect((await post(app, { mint }, { 'x-max-price-ccd': '2' })).status).toBe(200);
    expect((await post(app, { mint, max_price_ccd: 'lots' })).status).toBe(400);
  });

  it('serves /llms.txt with the endpoints and the paying rules', async () => {
    const { app } = makeApp();
    const r = await app.request('/llms.txt');
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain('https://sentinel.example/mcp');
    expect(t).toContain('Idempotency-Key');
    expect(t).toContain('max_price_ccd');
  });
});
