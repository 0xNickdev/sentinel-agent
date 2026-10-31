// Concordium Agent Registry (CIS-8004) through the hosted MCP service.
// The service builds Agent Cards and sign-ready contract parameters and
// verifies badges; it holds no keys. We sign and submit ourselves (see
// chain.ts). Every Sentinel agent (six specialists + judge + the gateway)
// gets its own card and its own NFT under the owner's verified account.
import { createHash } from 'node:crypto';

export const REGISTRY_MCP = 'https://agent-registry-mcp.concordium.com/mcp';
export const REGISTRY_REST = 'https://agent-registry-mcp.concordium.com/v1';
export type Network = 'testnet' | 'mainnet' | 'devnet';

export const CONTRACTS: Record<Network, { cis8004: { index: number; subindex: number }; cis8: { index: number; subindex: number }; explorer: string }> = {
  testnet: { cis8004: { index: 12802, subindex: 0 }, cis8: { index: 12801, subindex: 0 }, explorer: 'https://testnet.ccdscan.io' },
  mainnet: { cis8004: { index: 10082, subindex: 0 }, cis8: { index: 10081, subindex: 0 }, explorer: 'https://ccdscan.io' },
  devnet: { cis8004: { index: 0, subindex: 0 }, cis8: { index: 0, subindex: 0 }, explorer: '' },
};

let rpcId = 0;

/** One JSON-RPC call to the hosted MCP server; returns the tool's text payload parsed as JSON. */
export async function callRegistryTool<T = unknown>(name: string, args: Record<string, unknown>, opts: { fetch?: typeof fetch; endpoint?: string } = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const res = await f(opts.endpoint ?? REGISTRY_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`registry mcp ${name}: HTTP ${res.status}`);
  const raw = await res.text();
  const line = raw.split('\n').find(l => l.startsWith('data:'));
  const rpc = JSON.parse(line ? line.slice(5) : raw) as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message: string } };
  if (rpc.error) throw new Error(`registry mcp ${name}: ${rpc.error.message}`);
  const text = rpc.result?.content?.find(c => c.type === 'text')?.text ?? '';
  if (rpc.result?.isError) throw new Error(`registry mcp ${name}: ${text}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`registry mcp ${name}: ${text}`); }
}

// ── Agent Cards ─────────────────────────────────────────────────────────
export interface AgentCardInput {
  name: string;
  description: string;
  /** public URL where the card JSON will be served, byte-exact */
  agentUri: string;
  ownerAccount: string;
  skills: Array<{ id: string; name: string; description: string; tags: string[] }>;
  services?: Record<string, string>;
  provider?: { organization: string; url?: string };
  documentationUrl?: string;
  /** on-chain token id once minted; null before */
  tokenId?: number | null;
  agentWallet?: string | null;
}

export interface BuiltCard {
  network: Network;
  agent_card_json: string;
  metadata_hash_hex: string;
  token_address: string | null;
  agent_uri: string;
  owner_account: string;
  notes?: string[];
}

export async function buildAgentCard(network: Network, input: AgentCardInput, opts?: { fetch?: typeof fetch }): Promise<BuiltCard> {
  const card = await callRegistryTool<BuiltCard>('build_agent_card', {
    network,
    name: input.name,
    description: input.description,
    agent_uri: input.agentUri,
    owner_account: input.ownerAccount,
    skills: input.skills,
    ...(input.services ? { services: input.services } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.documentationUrl ? { documentation_url: input.documentationUrl } : {}),
    token_id: input.tokenId ?? null,
    agent_wallet: input.agentWallet ?? null,
  }, opts ?? {});
  // Trust but verify: the hash we pin on-chain must be the hash of the bytes we host.
  const local = sha256Hex(card.agent_card_json);
  if (local !== card.metadata_hash_hex) throw new Error(`card hash mismatch: service ${card.metadata_hash_hex}, local ${local}`);
  return card;
}

export const sha256Hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

// ── Sign-ready contract parameters ──────────────────────────────────────
export interface BuiltUpdate {
  network: Network;
  contract_address: { index: number; subindex: number };
  receive_name: string;
  parameter_hex: string;
  parameter_json?: unknown;
  suggested_energy?: number;
  sender?: string;
}

export function buildRegister(network: Network, sender: string, agentUri: string, metadataHashHex: string, opts?: { fetch?: typeof fetch }) {
  return callRegistryTool<BuiltUpdate>('build_register', { network, sender, agent_uri: agentUri, metadata_hash_hex: metadataHashHex }, opts ?? {});
}

export function buildSetAgentUri(network: Network, sender: string, tokenId: number, agentUri: string, metadataHashHex: string, opts?: { fetch?: typeof fetch }) {
  return callRegistryTool<BuiltUpdate>('build_set_agent_uri', { network, sender, token_id: tokenId, agent_uri: agentUri, metadata_hash_hex: metadataHashHex }, opts ?? {});
}

// ── Lookups and verification ────────────────────────────────────────────
export interface AgentRecord {
  token_id?: number | string;
  token_address?: string;
  owner?: string;
  agent_uri?: string | null;
  metadata_hash?: string | null;
  status?: 'Active' | 'Revoked' | string;
  [k: string]: unknown;
}

export const agentOf = (network: Network, tokenId: number, opts?: { fetch?: typeof fetch }) =>
  callRegistryTool<AgentRecord | null>('agent_of', { network, token_id: tokenId }, opts ?? {});

export const agentsByOwner = (network: Network, owner: string, opts?: { fetch?: typeof fetch }) =>
  callRegistryTool<{ agents?: AgentRecord[]; [k: string]: unknown }>('agents_by_owner', { network, owner }, opts ?? {});

export const tokenAddress = (network: Network, tokenId: number, opts?: { fetch?: typeof fetch }) =>
  callRegistryTool<{ token_address: string }>('token_address', { contract_index: CONTRACTS[network].cis8004.index, contract_subindex: 0, token_id: tokenId }, opts ?? {});

/** The badge check consumers run before trusting a Sentinel verdict. */
export const checkBadge = (badgeOrAccount: string, network?: Network, opts?: { fetch?: typeof fetch }) =>
  callRegistryTool<Record<string, unknown>>('check_badge', { id: badgeOrAccount, ...(network ? { network } : {}) }, opts ?? {});

export const verifyAgentCard = (network: Network, tokenId: number, opts?: { fetch?: typeof fetch }) =>
  callRegistryTool<{ match: boolean | null; [k: string]: unknown }>('verify_agent_card', { network, token_id: tokenId, fetch: true }, opts ?? {});

/** Badge-check URL to print next to a verdict. */
export const badgeCheckUrl = (badge: string) => `${REGISTRY_REST}/check-badge/${badge}`;
