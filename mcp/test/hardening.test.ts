import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rugToken, verifyVerdict } from '@sentinel/agents';
import { VerdictService } from '@sentinel/concordium';
import { sentinelApp } from '../src/app.js';
import { rateLimit } from '../src/hardening.js';
import { fakeLLM } from './fake-llm.js';

describe('edge hardening', () => {
  it('rate limits per client and answers 429 with retry-after', async () => {
    let t = 0;
    const app = new Hono().use(rateLimit({ perMinute: 2, now: () => t, key: c => c.req.header('x-client') ?? 'a' })).get('/x', c => c.text('ok'));
    expect((await app.request('/x')).status).toBe(200);
    expect((await app.request('/x')).status).toBe(200);
    const limited = await app.request('/x');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await app.request('/x', { headers: { 'x-client': 'b' } })).status).toBe(200);
    t += 60_000;
    expect((await app.request('/x')).status).toBe(200);
  });

  it('rejects oversized bodies, sets security headers, publishes the PQ key and signs verdicts', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', llm: fakeLLM({ holders: 90, snipers: 90, funding: 90, creator: 90, contract: 90, market: 90, flows: 90 }, { verdict: 'DANGER', riskScore: 90 }) });
    const rug = rugToken(); service.seed(rug);
    const app = sentinelApp({ service, cardsDir: mkdtempSync(join(tmpdir(), 'c-')), network: 'testnet', baseUrl: 'https://sentinel.example', corsOrigins: ['https://site.example'] });
    const big = await app.request('/x402/verdict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: 'x'.repeat(300_000) }) });
    expect(big.status).toBe(413);
    const health = await app.request('/healthz', { headers: { origin: 'https://site.example' } });
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('access-control-allow-origin')).toBe('https://site.example');
    const keys = await (await app.request('/.well-known/sentinel-keys.json')).json() as { attestation: { alg: string; publicKey: string } };
    expect(keys.attestation.alg).toBe('ML-DSA-65');
    expect(keys.attestation.publicKey).toBe(service.keys.publicKeyHex);
    const res = await app.request('/x402/verdict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: rug.mint }) });
    const v = await res.json() as Parameters<typeof verifyVerdict>[0] & { attestation: { signature: Parameters<typeof verifyVerdict>[1] } };
    expect(verifyVerdict(v, v.attestation.signature, keys.attestation.publicKey)).toBe(true);
    expect(verifyVerdict({ ...v, verdict: 'SAFE' }, v.attestation.signature, keys.attestation.publicKey)).toBe(false);
    const agents = await (await app.request('/api/agents')).json() as { agents: unknown[] };
    expect(agents.agents).toHaveLength(9);
  });

  it('streams swarm events over SSE and ends with the verdict', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', llm: fakeLLM({ holders: 10, snipers: 10, funding: 10, creator: 10, contract: 10, market: 10, flows: 10 }, { verdict: 'SAFE', riskScore: 10 }) });
    const rug = rugToken(); service.seed(rug);
    const app = sentinelApp({ service, cardsDir: mkdtempSync(join(tmpdir(), 'c-')), network: 'testnet', baseUrl: 'https://sentinel.example' });
    const res = await app.request(`/stream/verdict?mint=${rug.mint}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = (await res.text()).split('\n\n').filter(Boolean).map(b => b.split('\n')[0]!.replace('event: ', ''));
    expect(events[0]).toBe('swarm_start');
    expect(events.filter(e => e === 'agent_finding')).toHaveLength(7);
    expect(events.at(-1)).toBe('verdict');
    const bad = await (await app.request('/stream/verdict?mint=nope')).text();
    expect(bad).toContain('event: error');
  });
});
