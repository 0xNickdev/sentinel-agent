// Demo payer: an agent that holds testnet CCD buys one verdict over x402.
//   node dist/scripts/pay-for-verdict.js <mint> [gatewayUrl]
// Needs CONCORDIUM_PAYER_WALLET (or _ADDRESS + _KEY). Prints the 402 → paid → verdict trace.
import { loadEnv } from '@sentinel/agents';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { accountFromEnv } from '../chain.js';
import type { Network } from '../registry.js';
import { payingFetch, paymentExplorer } from '../x402.js';

loadEnv();
const [mint, gateway = process.env.SENTINEL_GATEWAY_URL ?? 'http://localhost:4020'] = process.argv.slice(2);
if (!mint) { console.error('usage: pay-for-verdict <mint> [gatewayUrl]'); process.exit(1); }
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const payer = accountFromEnv('CONCORDIUM_PAYER');
if (!payer) { console.error('CONCORDIUM_PAYER_WALLET is required'); process.exit(1); }

const probe = await fetch(`${gateway}/x402/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint }) });
console.error(`without payment: HTTP ${probe.status}${probe.status === 402 ? ' Payment Required' : ''}`);

const t0 = Date.now();
const res = await payingFetch(network, payer)(`${gateway}/x402/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint }) });
console.error(`with payment: HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const receipt = res.headers.get('PAYMENT-RESPONSE');
if (receipt) {
  const settled = decodePaymentResponseHeader(receipt) as { transaction?: string; network?: string; success?: boolean };
  console.error(`settled: ${settled.success} tx ${settled.transaction} ${settled.transaction ? paymentExplorer(network, settled.transaction) ?? '' : ''}`);
}
const verdict = await res.json();
console.log(JSON.stringify(verdict, null, 2));
