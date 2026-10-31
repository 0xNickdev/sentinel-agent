// The Sentinel agents as the registry sees them: one Agent Card each. The
// swarm's specialists stay narrow, so each card advertises exactly one skill;
// the gateway card advertises the MCP and A2A services other agents call.
import type { AgentCardInput } from './registry.js';

export const SENTINEL_AGENT_KEYS = ['gateway', 'judge', 'holders', 'snipers', 'funding', 'creator', 'contract', 'market', 'flows'] as const;
export type SentinelAgentKey = (typeof SENTINEL_AGENT_KEYS)[number];

export interface ManifestOptions {
  /** public base URL where cards and services are hosted, no trailing slash */
  baseUrl: string;
  ownerAccount: string;
  provider?: { organization: string; url?: string };
}

const cardUri = (base: string, key: SentinelAgentKey) => (key === 'gateway' ? `${base}/.well-known/agent-card.json` : `${base}/agents/${key}/agent-card.json`);

export function agentCards(o: ManifestOptions): Record<SentinelAgentKey, AgentCardInput> {
  const provider = o.provider ?? { organization: 'Sentinel', url: o.baseUrl };
  const common = { ownerAccount: o.ownerAccount, provider, documentationUrl: `${o.baseUrl}/docs` };
  const specialist = (key: SentinelAgentKey, name: string, description: string, tags: string[]): AgentCardInput => ({
    ...common,
    name: `Sentinel ${name}`,
    description,
    agentUri: cardUri(o.baseUrl, key),
    skills: [{ id: `sentinel.${key}`, name, description, tags: ['solana', 'rug-detection', ...tags] }],
    services: { a2a: `${o.baseUrl}/a2a/${key}` },
  });
  return {
    gateway: {
      ...common,
      name: 'Sentinel',
      description: 'Accountable anti-rug oracle for Solana tokens: a swarm of six specialist agents and a judge returns a verdict (SAFE / CAUTION / DANGER / RUGGED) with evidence, confidence and an on-chain audit record. Pay per query over x402.',
      agentUri: cardUri(o.baseUrl, 'gateway'),
      skills: [
        { id: 'sentinel.verdict', name: 'Token verdict', description: 'Is this Solana token a rug? Full swarm verdict with evidence, agent findings, consensus and audit digest.', tags: ['solana', 'rug-detection', 'risk', 'x402'] },
        { id: 'sentinel.audit', name: 'Audit lookup', description: 'Fetch a past verdict by digest or mint and its Concordium audit record.', tags: ['audit', 'eu-ai-act'] },
      ],
      services: { mcp: `${o.baseUrl}/mcp`, a2a: `${o.baseUrl}/a2a`, x402: `${o.baseUrl}/x402/verdict` },
    },
    judge: specialist('judge', 'Judge', 'Weighs the seven specialist findings under the consensus rule (veto, confidence-weighted mean, debate) and writes the verdict and the audit record.', ['consensus', 'judge']),
    holders: specialist('holders', 'Holders', 'Holder concentration and whale structure, program vaults excluded.', ['holders', 'concentration']),
    snipers: specialist('snipers', 'Snipers & Bundles', 'Launch-moment buying: snipers in the first slots and same-slot coordinated bundles.', ['snipers', 'bundles', 'launch']),
    funding: specialist('funding', 'Funding Graph', 'First-funder tracing of top wallets; clusters and the creator circle, exchanges excluded.', ['funding-graph', 'clusters', 'insiders']),
    creator: specialist('creator', 'Creator', 'Creator behaviour on this token and track record across past launches; Concordium ID proof when present.', ['creator', 'history', 'identity']),
    contract: specialist('contract', 'Contract & Liquidity', 'Mint and freeze authorities, Token-2022 extensions, liquidity lock and depth.', ['authorities', 'token-2022', 'liquidity']),
    market: specialist('market', 'Market', 'Trade shape and aggregator view: liquidity, volume, drained pools, manufactured volume.', ['market', 'liquidity', 'volume']),
    flows: specialist('flows', 'Money Flow', 'Where the proceeds went: SOL out of the creator and selling insiders after the sell, followed up to three hops to exchanges, funders and hubs.', ['money-flow', 'outflows', 'exchanges']),
  };
}
