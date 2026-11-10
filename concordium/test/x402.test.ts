import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAccount } from '../src/chain.js';
import { gatewayApp } from '../src/gateway.js';
import { VerdictService } from '../src/service.js';
import { caip2, facilitatorApp, parsePltPrice, paywall, preferAsset } from '../src/x402.js';

// A throwaway key: valid shape, no funds, never used on-chain.
const payer = loadAccount({ address: '3whdieGHx43KKRwQYbC5pAUdmWZ61B7yreNRU9i36MtdCvajR8', privateKeyHex: '11'.repeat(32), label: 'test' });

describe('x402 wiring', () => {
  it('maps networks to CAIP-2 ids', () => {
    expect(caip2('testnet')).toMatch(/^ccd:/);
    expect(caip2('mainnet')).toBe('ccd:9dd9ca4d19e9393877d2c44b70f89acb');
    expect(caip2('testnet')).not.toBe(caip2('mainnet'));
  });
  it('the facilitator advertises the sponsor on /supported and /healthz', async () => {
    const app = facilitatorApp({ network: 'testnet', sponsor: payer });
    const health = await app.request('/healthz');
    expect(await health.json()).toMatchObject({ ok: true, sponsor: payer.address.toString() });
    const supported = await (await app.request('/supported')).json() as { kinds: Array<{ scheme: string; network: string; extra?: { feePayer?: string } }>; signers?: Record<string, string[]> };
    expect(supported.kinds[0]).toMatchObject({ scheme: 'exact', network: caip2('testnet') });
    expect(supported.kinds[0]?.extra?.feePayer).toBe(payer.address.toString());
  });
  // The resource server pulls /supported from the facilitator at start, so run ours on a loopback port.
  let facilitator: ReturnType<typeof serve>;
  let facilitatorUrl = '';
  beforeAll(async () => {
    const port = await new Promise<number>(resolve => { facilitator = serve({ fetch: facilitatorApp({ network: 'testnet', sponsor: payer }).fetch, port: 0, hostname: '127.0.0.1' }, info => resolve(info.port)); });
    facilitatorUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(() => facilitator.close());

  it('the gateway answers 402 with payment requirements and the sponsor as fee payer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cards-'));
    writeFileSync(join(dir, 'gateway.json'), '{"name":"Sentinel"}');
    const app = gatewayApp({
      cardsDir: dir, service: new VerdictService({ rpcUrl: 'http://127.0.0.1:1' }),
      paywall: { network: 'testnet', payTo: payer.address.toString(), facilitatorUrl, priceMicroCcd: '1000000', routes: ['POST /x402/verdict'] },
    });
    const card = await app.request('/.well-known/agent-card.json');
    expect(card.status).toBe(200);
    expect(await card.text()).toBe('{"name":"Sentinel"}');
    expect((await app.request('/agents/holders/agent-card.json')).status).toBe(404);
    const res = await app.request('/x402/verdict', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ mint: 'x' }) });
    expect(res.status).toBe(402);
    // x402 v2 carries the requirements in the PAYMENT-REQUIRED header (base64 JSON); the body is a short error.
    expect(await res.json()).toEqual({ error: 'Payment required' });
    const required = decodePaymentRequiredHeader(res.headers.get('payment-required')!) as { x402Version: number; accepts: Array<{ scheme: string; network: string; payTo: string; amount?: string; asset?: string; extra?: { feePayer?: string } }> };
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: caip2('testnet'), payTo: payer.address.toString(), amount: '1000000', asset: 'CCD' });
    expect(required.accepts[0]?.extra?.feePayer).toBe(payer.address.toString());
  });
  it('offers a PLT price next to CCD, paid to the pool, and a payer can prefer it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cards-'));
    writeFileSync(join(dir, 'gateway.json'), '{"name":"Sentinel"}');
    const pool = '47jp7qLdXqug9E2f4o32YMRLY8SyftB67gVqEbvx1YKbfq29nw';
    const app = gatewayApp({
      cardsDir: dir, service: new VerdictService({ rpcUrl: 'http://127.0.0.1:1' }),
      paywall: { network: 'testnet', payTo: payer.address.toString(), facilitatorUrl, priceMicroCcd: '1000000', routes: ['POST /x402/verdict'], plt: { asset: 'EUDemo', amount: '10000', payTo: pool } },
    });
    const res = await app.request('/x402/verdict', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ mint: 'x' }) });
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get('payment-required')!) as { accepts: Array<{ asset: string; amount: string; payTo: string }> };
    expect(required.accepts.map(a => [a.asset, a.amount, a.payTo])).toEqual([['CCD', '1000000', payer.address.toString()], ['EUDemo', '10000', pool]]);
    expect(preferAsset('EUDemo')(2, required.accepts)[0]!.asset).toBe('EUDemo');
    expect(preferAsset(null)(2, required.accepts)[0]!.asset).toBe('CCD');
  });
  it('parses X402_PRICE_PLT', () => {
    expect(parsePltPrice('EUDemo:10000')).toEqual({ asset: 'EUDemo', amount: '10000' });
    expect(parsePltPrice('EUDemo:0')).toBeNull();
    expect(parsePltPrice('EUDemo')).toBeNull();
    expect(parsePltPrice(undefined)).toBeNull();
  });
  it('paywall builds a middleware', () => {
    expect(typeof paywall({ network: 'testnet', payTo: payer.address.toString(), facilitatorUrl: 'http://127.0.0.1:1', priceMicroCcd: '1', routes: ['POST /x'] })).toBe('function');
  });
});
