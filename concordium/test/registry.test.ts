import { describe, expect, it } from 'vitest';
import { agentCards, SENTINEL_AGENT_KEYS } from '../src/agents-manifest.js';
import { buildAgentCard, callRegistryTool, sha256Hex } from '../src/registry.js';

const sse = (payload: unknown) => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } })}\n\n`;
const fakeFetch = (body: string, status = 200): typeof fetch => (async () => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

describe('registry MCP client', () => {
  it('parses an SSE-framed tool result', async () => {
    const r = await callRegistryTool<{ ok: boolean }>('network_status', { network: 'testnet' }, { fetch: fakeFetch(sse({ ok: true })) });
    expect(r).toEqual({ ok: true });
  });
  it('parses a plain JSON tool result and surfaces tool errors', async () => {
    const plain = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"x":1}' }] } });
    expect(await callRegistryTool('t', {}, { fetch: fakeFetch(plain) })).toEqual({ x: 1 });
    const err = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'config error: missing string `agent_uri`' }] } });
    await expect(callRegistryTool('build_agent_card', {}, { fetch: fakeFetch(err) })).rejects.toThrow(/missing string/);
    await expect(callRegistryTool('t', {}, { fetch: fakeFetch('', 503) })).rejects.toThrow(/HTTP 503/);
  });
  it('refuses a card whose hash does not match the bytes', async () => {
    const card = '{"name":"Sentinel"}';
    const good = sse({ network: 'testnet', agent_card_json: card, metadata_hash_hex: sha256Hex(card), token_address: null, agent_uri: 'https://x/c.json', owner_account: 'acc' });
    const built = await buildAgentCard('testnet', { name: 'Sentinel', description: 'd', agentUri: 'https://x/c.json', ownerAccount: 'acc', skills: [] }, { fetch: fakeFetch(good) });
    expect(built.metadata_hash_hex).toBe(sha256Hex(card));
    const bad = sse({ network: 'testnet', agent_card_json: card, metadata_hash_hex: '00'.repeat(32), token_address: null, agent_uri: 'https://x/c.json', owner_account: 'acc' });
    await expect(buildAgentCard('testnet', { name: 'Sentinel', description: 'd', agentUri: 'https://x/c.json', ownerAccount: 'acc', skills: [] }, { fetch: fakeFetch(bad) })).rejects.toThrow(/hash mismatch/);
  });
});

describe('agent manifest', () => {
  it('describes all eight agents with unique card URIs and skill ids within the registry limits', () => {
    const cards = agentCards({ baseUrl: 'https://sentinel.example', ownerAccount: '3whdieGHx43KKRwQYbC5pAUdmWZ61B7yreNRU9i36MtdCvajR8' });
    expect(Object.keys(cards).sort()).toEqual([...SENTINEL_AGENT_KEYS].sort());
    const uris = Object.values(cards).map(c => c.agentUri);
    expect(new Set(uris).size).toBe(uris.length);
    expect(cards.gateway.agentUri).toBe('https://sentinel.example/.well-known/agent-card.json');
    for (const c of Object.values(cards)) {
      expect(c.name.length).toBeLessThanOrEqual(128);
      expect(c.description.length).toBeLessThanOrEqual(2048);
      expect(c.skills.length).toBeGreaterThan(0);
    }
    expect(cards.gateway.services).toMatchObject({ mcp: 'https://sentinel.example/mcp', a2a: 'https://sentinel.example/a2a' });
  });
});
