// An external agent buys a verdict through MCP: connects with an x402-aware
// fetch, lists tools, checks Sentinel's badge, calls sentinel_verdict and
// prints the streamed progress. Without CONCORDIUM_PAYER_WALLET it runs
// unpaid (works against a dev server with the paywall off).
//   node mcp/dist/scripts/mcp-client-demo.js <mint> [mcpUrl]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadEnv } from '@sentinel/agents';
import { accountFromEnv, payingFetch, type Network } from '@sentinel/concordium';

loadEnv();
const [mint, url = process.env.SENTINEL_MCP_URL ?? 'http://localhost:4020/mcp'] = process.argv.slice(2);
if (!mint) { console.error('usage: mcp-client-demo <mint> [mcpUrl]'); process.exit(1); }
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const payer = accountFromEnv('CONCORDIUM_PAYER');
const f = payer ? payingFetch(network, payer) : fetch;
console.error(payer ? `paying as ${payer.address.toString()} (x402 on ${network})` : 'no payer wallet: calling unpaid');

const client = new Client({ name: 'demo-trading-agent', version: '0.1.0' }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: f as typeof fetch }));
// Progress and log notifications carry the same lines; print log lines only for clients that cannot pass a progressToken.
const showLogs = process.env.SENTINEL_DEMO_LOGS === '1';
client.setNotificationHandler(LoggingMessageNotificationSchema, n => { if (showLogs) console.error(`  · ${String(n.params.data)}`); });

const tools = await client.listTools();
console.error(`tools: ${tools.tools.map(t => t.name).join(', ')}`);
const agents = await client.callTool({ name: 'sentinel_agents', arguments: {} }) as { structuredContent?: { agents: Array<{ key: string; badge: string | null; badgeCheck: string | null }> } };
const gw = agents.structuredContent?.agents.find(a => a.key === 'gateway');
console.error(gw?.badge ? `Sentinel badge ${gw.badge} → ${gw.badgeCheck}` : 'Sentinel not registered yet (no badge)');
if (gw?.badge) {
  const check = await client.callTool({ name: 'sentinel_check_badge', arguments: { id: gw.badge } }) as { structuredContent?: Record<string, unknown> };
  console.error(`badge check: ${JSON.stringify(check.structuredContent).slice(0, 300)}`);
}

const t0 = Date.now();
const res = await client.callTool({ name: 'sentinel_verdict', arguments: { mint } }, undefined, { onprogress: p => console.error(`  [${p.progress}/${p.total ?? '?'}] ${p.message ?? ''}`), timeout: 300_000 }) as { isError?: boolean; structuredContent?: { verdict: string; riskScore: number; confidence: number; attestation: { digest: string; concordiumTx: string | null; explorer: string | null } }; content: Array<{ type: string; text?: string }> };
if (res.isError) { console.error(`error: ${res.content[0]?.text}`); process.exit(1); }
const v = res.structuredContent!;
console.error(`\n${v.verdict} · risk ${v.riskScore}/100 · confidence ${v.confidence} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.error(`digest ${v.attestation.digest}${v.attestation.concordiumTx ? ` · audit ${v.attestation.explorer}` : ' · audit: not anchored (contract not configured)'}`);
console.log(JSON.stringify(v, null, 2));
await client.close();
