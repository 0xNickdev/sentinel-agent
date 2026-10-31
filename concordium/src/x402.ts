// x402 on Concordium: the gateway charges per verdict (402 → pay → answer),
// the facilitator sponsors and submits the payer's transaction, the client
// shows how any agent pays. All three use @x402/concordium's `exact` scheme
// with V1 sponsored transactions, so the paying agent never needs CCD for fees.
import { Hono } from 'hono';
import { CONCORDIUM_MAINNET_CAIP2, CONCORDIUM_TESTNET_CAIP2, getExplorerTxUrl, toConcordiumFacilitatorSigner } from '@x402/concordium';
import { ExactConcordiumScheme as ExactConcordiumClient } from '@x402/concordium/exact/client';
import { ExactConcordiumScheme as ExactConcordiumFacilitator } from '@x402/concordium/exact/facilitator';
import { ExactConcordiumScheme as ExactConcordiumServer } from '@x402/concordium/exact/server';
import { x402Facilitator } from '@x402/core/facilitator';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import type { Account } from './chain.js';
import type { Network } from './registry.js';

export const caip2 = (network: Network) => (network === 'mainnet' ? CONCORDIUM_MAINNET_CAIP2 : CONCORDIUM_TESTNET_CAIP2);
export const GRPC_HOST: Record<Network, string> = { testnet: 'grpc.testnet.concordium.com', mainnet: 'grpc.mainnet.concordium.software', devnet: 'grpc.devnet.concordium.com' };

// ── Facilitator: /supported /verify /settle ───────────────────────────────
export interface FacilitatorOptions { network: Network; sponsor: Account; requireFinalization?: boolean }

export function facilitatorApp(o: FacilitatorOptions): Hono {
  const signer = toConcordiumFacilitatorSigner(o.sponsor.address.toString(), o.sponsor.signer, { host: GRPC_HOST[o.network], port: 20000, useTls: true, network: caip2(o.network) });
  const facilitator = new x402Facilitator().register(caip2(o.network), new ExactConcordiumFacilitator({ signer, requireFinalization: o.requireFinalization ?? true }));
  const app = new Hono();
  app.get('/supported', c => c.json(facilitator.getSupported()));
  app.post('/verify', async c => {
    const { paymentPayload, paymentRequirements } = await c.req.json();
    return c.json(await facilitator.verify(paymentPayload, paymentRequirements));
  });
  app.post('/settle', async c => {
    const { paymentPayload, paymentRequirements } = await c.req.json();
    return c.json(await facilitator.settle(paymentPayload, paymentRequirements));
  });
  app.get('/healthz', c => c.json({ ok: true, sponsor: o.sponsor.address.toString(), network: caip2(o.network) }));
  return app;
}

// ── Resource server side: middleware that puts a price on routes ─────────
export interface PaywallOptions {
  network: Network;
  /** account that receives the payments (the Sentinel owner) */
  payTo: string;
  facilitatorUrl: string;
  /** price per verdict in microCCD (1 CCD = 1_000_000) */
  priceMicroCcd: string;
  /** route patterns, e.g. "POST /x402/verdict" */
  routes: string[];
  description?: string;
}

export function paywall(o: PaywallOptions) {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: o.facilitatorUrl })).register(caip2(o.network), new ExactConcordiumServer());
  const routes = Object.fromEntries(o.routes.map(r => [r, {
    accepts: [{ scheme: 'exact', network: caip2(o.network), payTo: o.payTo, price: { amount: o.priceMicroCcd, asset: 'CCD' } }],
    description: o.description ?? 'Sentinel swarm verdict',
    mimeType: 'application/json',
  }]));
  return paymentMiddleware(routes, server);
}

// ── Paying client: any agent that holds CCD on testnet ───────────────────
export function payingFetch(network: Network, payer: Account): typeof fetch {
  // CCD is not one of x402's default (USD-stable) assets, so allow it explicitly for the paying agent.
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: caip2(network), client: new ExactConcordiumClient({ accountAddress: payer.address, signer: payer.signer }, { grpcUrl: `${GRPC_HOST[network]}:20000`, useTls: true }) }],
    spendControls: { allowedAssets: true },
  } as Parameters<typeof wrapFetchWithPaymentFromConfig>[1]) as typeof fetch;
}

export const paymentExplorer = (network: Network, txHash: string) => getExplorerTxUrl(caip2(network), txHash);
