// Sentinel as an MCP server (Streamable HTTP, stateless). Four tools:
//   sentinel_verdict      run the swarm on a mint (paid over x402 when a paywall is on); streams progress
//   sentinel_agents       who the agents are, their registry ids and badge-check URLs
//   sentinel_check_badge  verify any Concordium agent badge before trusting it
//   sentinel_audit        look up a past verdict and its on-chain audit record
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Hono } from 'hono';
import { z } from 'zod';
import { SPECIALISTS, type SwarmEvent } from '@sentinel/agents';
import { badgeCheckUrl, checkBadge, isMint, type Network, type StoredVerdict, type VerdictService, trackReport } from '@sentinel/concordium';

export interface AgentDirectory {
  key: string;
  name: string;
  role: string;
  tokenId: number | null;
  badge: string | null;
  badgeCheck: string | null;
  card: string;
  /** last setAgentURI (card pin) and the trackRecord metadata write, Concordium tx hashes */
  cardTx?: string | null;
  trackRecordTx?: string | null;
}

export interface McpOptions {
  service: VerdictService;
  network: Network;
  baseUrl: string;
  /** cards/registry.json contents once agents are registered */
  registry?: Record<string, { tokenId: number; tokenAddress: string; agentUri: string; refreshTx?: string; setUriTx?: string; metadataTxs?: Record<string, string> }>;
  /** price shown to clients; null when verdicts are free */
  priceMicroCcd?: string | null;
  version?: string;
}

const ROLES: Record<string, string> = Object.fromEntries(SPECIALISTS.map(s => [s.id, s.domain]));
ROLES.gateway = 'entry point: MCP, A2A and x402 surface of the swarm';
ROLES.judge = 'weighs the specialists under the consensus rule and writes the verdict';

export function agentDirectory(o: McpOptions): AgentDirectory[] {
  const keys = ['gateway', 'judge', ...SPECIALISTS.map(s => s.id)];
  return keys.map(key => {
    const reg = o.registry?.[key];
    return {
      key,
      name: key === 'gateway' ? 'Sentinel' : key === 'judge' ? 'Sentinel Judge' : `Sentinel ${SPECIALISTS.find(s => s.id === key)?.name ?? key}`,
      role: ROLES[key] ?? key,
      tokenId: reg?.tokenId ?? null,
      badge: reg?.tokenAddress ?? null,
      badgeCheck: reg ? badgeCheckUrl(reg.tokenAddress) : null,
      card: key === 'gateway' ? `${o.baseUrl}/.well-known/agent-card.json` : `${o.baseUrl}/agents/${key}/agent-card.json`,
      cardTx: reg?.refreshTx ?? reg?.setUriTx ?? null,
      trackRecordTx: reg?.metadataTxs?.trackRecord ?? null,
    };
  });
}

/** The compact, machine-first view of a verdict that tools return. */
export function verdictView(v: StoredVerdict, o: McpOptions) {
  return {
    schema: v.schema,
    chain: v.chain,
    mint: v.mint,
    verdict: v.verdict,
    riskScore: v.riskScore,
    confidence: v.confidence,
    headline: v.headline,
    decisive: v.decisive,
    action: v.action,
    reasoning: v.reasoning,
    topReasons: v.topReasons,
    cleanSignals: v.cleanSignals,
    whatWouldChange: v.whatWouldChange,
    scorecard: v.scorecard,
    dissent: v.dissent,
    advocate: v.advocate ? { arguesFor: v.advocate.arguesFor, thesis: v.advocate.thesis, points: v.advocate.points, weakestLink: v.advocate.weakestLink } : null,
    rebuttal: v.rebuttal,
    vetoes: v.vetoes.map(x => ({ code: x.code, agent: x.agent, message: x.message })),
    findings: v.findings.map(f => ({ agent: f.agent, riskScore: f.riskScore, confidence: f.confidence, label: f.label, summary: f.summary, agentRegistryId: f.agentRegistryId, ...(f.revised ? { revisedFrom: f.revised.riskScore } : {}) })),
    consensus: { rule: v.consensus.rule, weightedScore: v.consensus.weightedScore, spread: v.consensus.spread, debateRounds: v.consensus.debateRounds, completeness: v.consensus.completeness.score },
    council: v.council ? { scores: v.council.scores, rankings: v.council.rankings.map(r => ({ by: r.by, ranked: r.ranked })) } : null,
    flags: v.flags.map(f => f.code),
    models: v.models,
    observedAt: v.at,
    attestation: { digest: v.attestation.digest, concordiumTx: v.attestation.concordiumTx, explorer: o.service.auditLink(v), auditSeq: v.stored.auditSeq },
    /** how the token turned out after this verdict, per horizon (filled in by the resolver; graded on Concordium beside the record) */
    outcomes: (v.outcomes ?? []).map(x => ({ horizon: x.horizon, rugged: x.rugged, labels: x.labels, liquidityBps: x.liquidityBps, priceBps: x.priceBps, at: x.at, concordiumTx: x.concordiumTx })),
    verifyBadge: o.registry?.gateway ? badgeCheckUrl(o.registry.gateway.tokenAddress) : null,
    timing: v.timing,
    timeline: v.timeline,
  };
}

export function createMcpServer(o: McpOptions): McpServer {
  const server = new McpServer({ name: 'sentinel', version: o.version ?? '0.1.0' }, { capabilities: { logging: {} } });
  const price = o.priceMicroCcd ? `${Number(o.priceMicroCcd) / 1e6} CCD per call over x402 (HTTP 402 on this endpoint; use an x402-aware fetch)` : 'free on this deployment';

  server.registerTool('sentinel_verdict', {
    title: 'Sentinel verdict',
    description: `Is this Solana token a rug? Seven specialist agents (holders, snipers & bundles, funding graph, creator, contract & liquidity, market, money flow) analyse deterministic on-chain evidence and a judge issues SAFE / CAUTION / DANGER / RUGGED with a risk score, confidence, reasons and dissent. The verdict is hashed and anchored on Concordium (audit trail) and every agent carries a Verified by Concordium badge. Price: ${price}. Progress streams as notifications when you pass a progressToken.`,
    inputSchema: { mint: z.string().describe('Solana token mint address (base58)'), fresh: z.boolean().optional().describe('Re-run even if a verdict from the last 5 minutes exists') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ mint, fresh }, extra) => {
    if (!isMint(mint)) return { isError: true, content: [{ type: 'text', text: `not a Solana mint address: ${mint}` }] };
    const token = extra._meta?.progressToken;
    let step = 0;
    const total = 9;
    const notify = async (message: string) => {
      step = Math.min(step + 1, total);
      const tasks: Promise<void>[] = [extra.sendNotification({ method: 'notifications/message', params: { level: 'info', logger: 'sentinel', data: message } })];
      if (token !== undefined) tasks.push(extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: step, total, message } }));
      await Promise.all(tasks).catch(() => undefined);
    };
    const onEvent = (ev: SwarmEvent) => {
      if (ev.type === 'veto') void notify(`veto ${ev.veto.code} (${ev.veto.agent})`);
      else if (ev.type === 'agent_finding') void notify(`${ev.finding.agentName}: risk ${ev.finding.riskScore}, confidence ${ev.finding.confidence}. ${ev.finding.summary}`);
      else if (ev.type === 'debate_start') void notify(`debate: ${ev.agents.join(' vs ')} (spread ${ev.spread})`);
      else if (ev.type === 'consensus') void notify(`consensus: weighted ${ev.consensus.weightedScore}, spread ${ev.consensus.spread}, suggests ${ev.consensus.suggestedBand}`);
      else if (ev.type === 'judge_start') void notify(`judge (${ev.model}) deliberating`);
    };
    try {
      const v = await o.service.verdict(mint, onEvent, fresh ? { fresh: true } : {});
      const view = verdictView(v, o);
      return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }], structuredContent: view };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
    }
  });

  server.registerTool('sentinel_agents', {
    title: 'Sentinel agents',
    description: 'The agents behind Sentinel: roles, Concordium Agent Registry token ids, Verified by Concordium badge addresses and badge-check URLs, and the Agent Card of each. Call this to verify who you are dealing with before buying a verdict.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const agents = agentDirectory(o);
    return { content: [{ type: 'text', text: JSON.stringify({ network: o.network, agents }, null, 2) }], structuredContent: { network: o.network, agents } };
  });

  server.registerTool('sentinel_check_badge', {
    title: 'Check a Concordium badge',
    description: 'Verify a Verified by Concordium badge (CIS-8004 agent NFT) or list the badges of an account, through the Concordium Agent Registry: on-chain record, Active status, card hash match. Works for any agent, not only Sentinel.',
    inputSchema: { id: z.string().describe('Badge token address (base58) or Concordium account address') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ id }) => {
    try {
      const r = await checkBadge(id, o.network);
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: r };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
    }
  });

  server.registerTool('sentinel_quick', {
    title: 'Sentinel quick check (free, no models)',
    description: 'Fast first look at a Solana token in about a second for fresh launches (a few seconds for large tokens): mint and freeze authority, Token-2022 extensions, holder concentration, liquidity and market shape, scored by the same deterministic rules the swarm starts from. No LLM, free, cached 60 s. It does NOT read snipers, bundles, the funding graph, the creator or money flows: call sentinel_verdict (paid) for the full, signed, on-chain-anchored verdict. Returns verdict SAFE/CAUTION/DANGER, riskScore 0-100, flags, vetoes, what was and was not checked, and the last full verdict on this mint if one exists.',
    inputSchema: { mint: z.string().describe('Solana token mint address (base58)') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ mint }) => {
    try {
      const q = await o.service.quick(mint.trim());
      return { content: [{ type: 'text', text: JSON.stringify(q, null, 2) }], structuredContent: q as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: 'text', text: `quick check failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  });

  server.registerTool('sentinel_track', {
    title: 'Sentinel track record',
    description: 'How good are Sentinel\'s calls? Every verdict is sealed on Concordium before the outcome and graded after it (1h, 24h, 7d) with published labels: TVL rug = liquidity down more than 99%, idle = no trades left. Returns Brier score, log score, skill against the base rate, a reliability diagram and per-specialist scores, plus recent graded verdicts. riskScore/100 is the forecast probability of rug. Use this before trusting a verdict.',
    inputSchema: { limit: z.number().optional().describe('how many recent graded verdicts to include (default 20)') },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    const report = trackReport(o.service.all(), undefined, limit ?? 20);
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }], structuredContent: report as unknown as Record<string, unknown> };
  });

  server.registerTool('sentinel_audit', {
    title: 'Sentinel audit lookup',
    description: 'Fetch a past Sentinel verdict by digest or by mint, with its Concordium audit record (transaction and explorer link). Without arguments returns the most recent verdicts.',
    inputSchema: { digest: z.string().optional().describe('sha256 digest from a verdict attestation'), mint: z.string().optional().describe('token mint; returns the latest verdict for it'), limit: z.number().optional().describe('how many recent verdicts to list when no digest or mint is given') },
    annotations: { readOnlyHint: true },
  }, async ({ digest, mint, limit }) => {
    if (digest || mint) {
      const v = o.service.lookup({ ...(digest ? { digest } : {}), ...(mint ? { mint } : {}) });
      if (!v) return { isError: true, content: [{ type: 'text', text: 'no verdict found' }] };
      const view = verdictView(v, o);
      return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }], structuredContent: view };
    }
    const recent = o.service.recent(limit ?? 20).map(v => ({ mint: v.mint, verdict: v.verdict, riskScore: v.riskScore, confidence: v.confidence, at: v.stored.at, digest: v.attestation.digest, concordiumTx: v.attestation.concordiumTx }));
    return { content: [{ type: 'text', text: JSON.stringify(recent, null, 2) }], structuredContent: { recent } };
  });

  return server;
}

/** Mount the MCP endpoint. Stateless: a fresh server + transport per request, progress rides the request's SSE stream. */
export function mountMcp(app: Hono, path: string, o: McpOptions) {
  app.all(path, async c => {
    const server = createMcpServer(o);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined } as unknown as ConstructorParameters<typeof WebStandardStreamableHTTPServerTransport>[0]);
    await server.connect(transport);
    const cleanup = () => { void transport.close().then(() => server.close()).catch(() => undefined); };
    const res = await transport.handleRequest(c.req.raw);
    // SSE bodies keep streaming after handleRequest returns: tear down only once the body has been fully sent.
    if (!res.body) { cleanup(); return res; }
    return new Response(res.body.pipeThrough(new TransformStream({ flush: cleanup })), { status: res.status, headers: res.headers });
  });
}
