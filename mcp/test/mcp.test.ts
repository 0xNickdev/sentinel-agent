import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { rugToken, cleanToken } from '@sentinel/agents';
import { VerdictService } from '@sentinel/concordium';
import { sentinelApp } from '../src/app.js';
import { fakeLLM } from './fake-llm.js';

function makeApp() {
  const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1', llm: fakeLLM({ holders: 20, snipers: 90, funding: 95, creator: 90, contract: 100, market: 60, flows: 95 }, { verdict: 'DANGER', riskScore: 85 }) });
  const rug = rugToken(); service.seed(rug);
  const clean = cleanToken(); service.seed(clean);
  const cardsDir = mkdtempSync(join(tmpdir(), 'cards-'));
  writeFileSync(join(cardsDir, 'gateway.json'), JSON.stringify({ name: 'Sentinel', capabilities: { extensions: [{ uri: 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1', required: false, params: { tokenAddress: null } }] } }));
  writeFileSync(join(cardsDir, 'registry.json'), JSON.stringify({ gateway: { tokenId: 1001, tokenAddress: 'BadgeGateway111', agentUri: 'https://sentinel.example/.well-known/agent-card.json' } }));
  const app = sentinelApp({ service, cardsDir, network: 'testnet', baseUrl: 'https://sentinel.example' });
  return { app, service, rug, clean };
}

async function connect(app: ReturnType<typeof makeApp>['app']) {
  const transport = new StreamableHTTPClientTransport(new URL('http://sentinel.local/mcp'), { fetch: ((url: string | URL | Request, init?: RequestInit) => app.request(url instanceof Request ? url : url.toString(), init)) as typeof fetch });
  const client = new Client({ name: 'test-agent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

describe('MCP surface', () => {
  it('lists the five tools and describes the agents with badges', async () => {
    const { app } = makeApp();
    const client = await connect(app);
    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name).sort()).toEqual(['sentinel_agents', 'sentinel_audit', 'sentinel_check_badge', 'sentinel_track', 'sentinel_verdict']);
    const agents = await client.callTool({ name: 'sentinel_agents', arguments: {} }) as { structuredContent: { agents: Array<{ key: string; badge: string | null; badgeCheck: string | null }> } };
    expect(agents.structuredContent.agents).toHaveLength(9);
    const gw = agents.structuredContent.agents.find(a => a.key === 'gateway')!;
    expect(gw.badge).toBe('BadgeGateway111');
    expect(gw.badgeCheck).toContain('/check-badge/BadgeGateway111');
    await client.close();
  });

  it('returns a structured verdict with progress notifications and stores it for audit lookup', async () => {
    const { app, rug } = makeApp();
    const client = await connect(app);
    const progress: string[] = [];
    const logs: string[] = [];
    client.setNotificationHandler((await import('@modelcontextprotocol/sdk/types.js')).LoggingMessageNotificationSchema, n => { logs.push(String(n.params.data)); });
    const res = await client.callTool({ name: 'sentinel_verdict', arguments: { mint: rug.mint } }, undefined, { onprogress: p => { progress.push(p.message ?? ''); } }) as { structuredContent: { verdict: string; riskScore: number; vetoes: Array<{ code: string }>; attestation: { digest: string }; findings: unknown[] } };
    expect(res.structuredContent.verdict).toBe('DANGER');
    expect(res.structuredContent.vetoes.map(v => v.code).sort()).toEqual(['dev_cashed_out', 'freeze_authority_live', 'mint_authority_live']);
    expect(res.structuredContent.findings).toHaveLength(7);
    expect(progress.length).toBeGreaterThanOrEqual(7);
    expect(logs.some(l => l.startsWith('veto mint_authority_live'))).toBe(true);
    const audit = await client.callTool({ name: 'sentinel_audit', arguments: { digest: res.structuredContent.attestation.digest } }) as { structuredContent: { mint: string } };
    expect(audit.structuredContent.mint).toBe(rug.mint);
    const bad = await client.callTool({ name: 'sentinel_verdict', arguments: { mint: 'not-a-mint' } }) as { isError?: boolean };
    expect(bad.isError).toBe(true);
    await client.close();
  });
});

describe('A2A surface', () => {
  it('serves a v1 card with the badge extension and runs a task to completion', async () => {
    const { app, rug } = makeApp();
    const card = await (await app.request('/a2a')).json() as { name: string; supportedInterfaces: Array<{ url: string; protocolBinding: string }>; capabilities: { extensions: Array<{ uri: string }> } };
    expect(card.name).toBe('Sentinel');
    expect(card.supportedInterfaces[0]).toMatchObject({ url: 'https://sentinel.example/a2a', protocolBinding: 'JSONRPC' });
    expect(card.capabilities.extensions[0]?.uri).toContain('concordium-badge');

    const res = await app.request('/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: `Is ${rug.mint} a rug?` }] } } }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { result?: { task?: { status?: { state: string }; artifacts?: Array<{ name: string; parts: Array<{ data?: { verdict: string } }> }> } }; error?: unknown };
    expect(body.error).toBeUndefined();
    const task = body.result?.task as { status?: { state: string; message?: { parts?: Array<{ text?: string }> } } } | undefined;
    expect(task?.status?.state, task?.status?.message?.parts?.[0]?.text).toBe('TASK_STATE_COMPLETED');
    expect(task?.artifacts?.[0]?.name).toBe('verdict');
    expect(task?.artifacts?.[0]?.parts[0]?.data?.verdict).toBe('DANGER');
  });

  it('asks for input when no mint is given and streams status updates', async () => {
    const { app } = makeApp();
    const res = await app.request('/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'SendMessage', params: { message: { messageId: 'm2', role: 'ROLE_USER', parts: [{ text: 'hello' }] } } }) });
    const body = await res.json() as { result?: { task?: { status?: { state: string } } } };
    expect(body.result?.task?.status?.state).toBe('TASK_STATE_INPUT_REQUIRED');
    const { rug } = makeApp();
    const stream = await app.request('/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'SendStreamingMessage', params: { message: { messageId: 'm3', role: 'ROLE_USER', parts: [{ data: { mint: rug.mint } }] } } }) });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const events = (await stream.text()).split('\n\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)) as { result?: Record<string, unknown> });
    expect(events.length).toBeGreaterThan(5);
    const kinds = events.map(e => Object.keys(e.result ?? {})[0]);
    expect(kinds[0]).toBe('task');
    expect(kinds).toContain('statusUpdate');
    expect(kinds).toContain('artifactUpdate');
  });
});
