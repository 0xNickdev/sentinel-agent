// A demo trading agent that asks before it buys. It is the scenario the
// hackathon brief describes: an agent checks another agent's Verified by
// Concordium badge, pays it per call over x402, and acts on the answer.
// It never trades: it prints the decision it would take and why.
//   node dist/scripts/trader-agent.js [mint] [gatewayUrl]
// Without a mint it takes the newest live pump.fun launch from the gateway.
// Needs CONCORDIUM_PAYER_WALLET (or _ADDRESS + _KEY) with testnet CCD.
import { loadEnv } from '@sentinel/agents';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { accountFromEnv } from '../chain.js';
import { checkBadge, type Network } from '../registry.js';
import { payingFetch, paymentExplorer } from '../x402.js';

loadEnv();
const args = process.argv.slice(2);
const gateway = (args.find(a => a.startsWith('http')) ?? process.env.SENTINEL_GATEWAY_URL ?? 'https://api.sentinelagent.pro').replace(/\/$/, '');
let mint = args.find(a => !a.startsWith('http'));
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const payer = accountFromEnv('CONCORDIUM_PAYER');
if (!payer) { console.error('CONCORDIUM_PAYER_WALLET (or CONCORDIUM_PAYER_ADDRESS + _KEY) is required'); process.exit(1); }
const say = (m: string) => console.error(`trader › ${m}`);

// 1. Who am I about to pay? Read the oracle's Agent Card and check its badge against the Concordium registry.
const card = await (await fetch(`${gateway}/.well-known/agent-card.json`)).json() as { name?: string; capabilities?: { extensions?: Array<{ uri: string; params?: { tokenAddress?: string; token_address?: string; badge?: string } }> } };
const ext = card.capabilities?.extensions?.find(e => e.uri.includes('concordium-badge'));
// The card carries a CAIP-19 id (ccd:<genesis>/cis-2:<token address>); the registry check takes the bare token address.
const badgeId = (ext?.params?.tokenAddress ?? ext?.params?.token_address ?? ext?.params?.badge)?.split(":").pop();
if (!badgeId) { say(`${card.name ?? gateway} shows no Verified by Concordium badge: not paying an unaccountable oracle`); process.exit(2); }
const badge = await checkBadge(badgeId, network);
if (!badge.badge_valid) { say(`badge ${badgeId} does not verify (${JSON.stringify(badge.issues)}): not paying`); process.exit(2); }
say(`${card.name} carries a valid Verified by Concordium badge (token ${badge.token_id}, owner ${String((badge.on_chain as { owner_account?: string } | undefined)?.owner_account ?? '').slice(0, 8)}…, card hash matches the chain)`);

// 2. What am I about to buy?
if (!mint) {
  const live = await (await fetch(`${gateway}/launches?limit=10`)).json() as { launches: Array<{ mint: string; symbol: string; at: number }> };
  const pick = live.launches.find(l => Date.now() / 1000 - l.at > 60) ?? live.launches[0];
  if (!pick) { say('no live launch to look at'); process.exit(1); }
  mint = pick.mint;
  say(`candidate: $${pick.symbol || '?'} ${mint}, launched ${Math.round(Date.now() / 1000 - pick.at)}s ago`);
} else say(`candidate: ${mint}`);

// 3. Pay for the verdict. The first call answers 402 with the price; the x402 client signs a CCD transfer and retries.
const t0 = Date.now();
const res = await payingFetch(network, payer)(`${gateway}/x402/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint }) });
if (!res.ok) { say(`verdict request failed: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
const receipt = res.headers.get('PAYMENT-RESPONSE');
const settled = receipt ? decodePaymentResponseHeader(receipt) as { transaction?: string } : null;
const v = await res.json() as { verdict: string; riskScore: number; confidence: number; headline?: string; decisive?: string; topReasons?: string[]; attestation?: { digest: string; concordiumTx: string | null } };
say(`paid ${settled?.transaction ? paymentExplorer(network, settled.transaction) ?? settled.transaction : '(no receipt)'} · answer in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// 4. Decide. A plain, auditable rule: buy only a SAFE call the oracle is reasonably sure of.
const buy = v.verdict === 'SAFE' && v.confidence >= 0.6;
say(`${v.verdict} · risk ${v.riskScore}/100 · confidence ${v.confidence}`);
if (v.headline) say(v.headline);
for (const r of (v.topReasons ?? []).slice(0, 3)) say(`  · ${r}`);
say(buy ? 'DECISION: would buy (SAFE with confidence ≥ 0.6)' : `DECISION: skip (${v.verdict === 'SAFE' ? 'confidence below 0.6' : `oracle says ${v.verdict}`})`);
if (v.attestation?.concordiumTx) say(`the call I acted on is sealed on Concordium: ${paymentExplorer(network, v.attestation.concordiumTx) ?? v.attestation.concordiumTx}`);
console.log(JSON.stringify({ mint, decision: buy ? 'buy' : 'skip', verdict: v.verdict, riskScore: v.riskScore, confidence: v.confidence, digest: v.attestation?.digest, paidTx: settled?.transaction ?? null }, null, 2));
