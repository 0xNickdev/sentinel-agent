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
  /**
   * A second price in a protocol-level token, offered next to CCD (e.g. EUDemo, the allow-listed EU test stablecoin).
   * `amount` is in the token's smallest unit. `payTo` must be on the token's allow list when it has one; it is the
   * guarantee pool, so a refund leaves from the account that took the payment.
   */
  plt?: { asset: string; amount: string; payTo: string } | null;
}

/** `X402_PRICE_PLT=EUDemo:10000` → { asset: 'EUDemo', amount: '10000' } (0.01 EUDemo at 6 decimals). */
export function parsePltPrice(v: string | undefined | null): { asset: string; amount: string } | null {
  const m = /^\s*([A-Za-z0-9._-]{1,128})\s*:\s*(\d+)\s*$/.exec(v ?? '');
  return m && BigInt(m[2]!) > 0n ? { asset: m[1]!, amount: m[2]! } : null;
}

export function paywall(o: PaywallOptions) {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: o.facilitatorUrl })).register(caip2(o.network), new ExactConcordiumServer());
  const routes = Object.fromEntries(o.routes.map(r => [r, {
    accepts: [
      { scheme: 'exact', network: caip2(o.network), payTo: o.payTo, price: { amount: o.priceMicroCcd, asset: 'CCD' } },
      ...(o.plt ? [{ scheme: 'exact', network: caip2(o.network), payTo: o.plt.payTo, price: { amount: o.plt.amount, asset: o.plt.asset } }] : []),
    ],
    description: o.description ?? 'Sentinel swarm verdict',
    mimeType: 'application/json',
  }]));
  return paymentMiddleware(routes, server);
}

// ── Paying client: any agent that holds CCD on testnet ───────────────────
/** Put the offers in `asset` first, so a gateway that prices in CCD and a PLT is paid in the one the agent holds. */
export const preferAsset = (asset: string | null | undefined) => <R extends { asset: string }>(_v: number, reqs: R[]): R[] =>
  asset ? [...reqs.filter(r => r.asset === asset), ...reqs.filter(r => r.asset !== asset)] : reqs;

export function payingFetch(network: Network, payer: Account, opts: { asset?: string | null } = {}): typeof fetch {
  // CCD and EUDemo are not among x402's default (USD-stable) assets, so allow them explicitly for the paying agent.
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: caip2(network), client: new ExactConcordiumClient({ accountAddress: payer.address, signer: payer.signer }, { grpcUrl: `${GRPC_HOST[network]}:20000`, useTls: true }) }],
    policies: [preferAsset(opts.asset)],
    spendControls: { allowedAssets: true },
  } as Parameters<typeof wrapFetchWithPaymentFromConfig>[1]) as typeof fetch;
}

export const paymentExplorer = (network: Network, txHash: string) => getExplorerTxUrl(caip2(network), txHash);
