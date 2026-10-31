// Sentinel as an A2A v1.0 agent: JSON-RPC over HTTP with SSE streaming. A
// client sends a message with a mint; it gets a Task that moves through
// submitted → working (one status update per specialist finding) → completed,
// with the verdict as a data artifact. The Agent Card carries the Concordium
// badge extension, so peers can verify who they are talking to first.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import {
  DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext, validateVersion,
  type AgentExecutor, type ExecutionEventBus, type RequestContext,
} from '@a2a-js/sdk/server';
import { TaskState, Role, type AgentCard, type AgentExtension, type Message, type Part } from '@a2a-js/sdk';
import { isMint, type StoredVerdict, type VerdictService } from '@sentinel/concordium';
import type { McpOptions } from './mcp-server.js';
import { verdictView } from './mcp-server.js';

const MINT_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/;

/** Find a mint in text or data parts. */
export function mintFromMessage(msg: Message | undefined): string | null {
  for (const p of msg?.parts ?? []) {
    const c = p.content;
    if (!c) continue;
    if (c.$case === 'data') { const d = c.value as { mint?: string } | undefined; if (d?.mint && isMint(d.mint)) return d.mint; }
    if (c.$case === 'text') { const m = c.value.match(MINT_RE); if (m && isMint(m[0])) return m[0]; }
  }
  return null;
}

const text = (value: string): Part => ({ content: { $case: 'text', value }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const data = (value: unknown): Part => ({ content: { $case: 'data', value }, metadata: undefined, filename: '', mediaType: 'application/json' });
const agentMessage = (taskId: string, contextId: string, parts: Part[]): Message => ({ messageId: randomUUID(), taskId, contextId, role: Role.ROLE_AGENT, parts, metadata: undefined, extensions: [], referenceTaskIds: [] });
const now = () => new Date().toISOString();

export class SentinelExecutor implements AgentExecutor {
  constructor(private readonly o: McpOptions) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = ctx;
    const user = ctx.userMessage;
    const status = (state: TaskState, msg?: string) => bus.publish({ kind: 'statusUpdate', data: { taskId, contextId, status: { state, message: msg ? agentMessage(taskId, contextId, [text(msg)]) : undefined, timestamp: now() }, metadata: undefined } });

    if (!ctx.task) bus.publish({ kind: 'task', data: { id: taskId, contextId, status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: now() }, artifacts: [], history: user ? [user] : [], metadata: undefined } });
    const mint = mintFromMessage(user);
    if (!mint) {
      status(TaskState.TASK_STATE_INPUT_REQUIRED, 'Send a Solana token mint address (base58) as text, or a data part {"mint": "..."}.');
      bus.finished();
      return;
    }
    status(TaskState.TASK_STATE_WORKING, `Sentinel swarm started on ${mint}: seven specialists and a judge.`);
    try {
      const v: StoredVerdict = await this.o.service.verdict(mint, ev => {
        if (ev.type === 'veto') status(TaskState.TASK_STATE_WORKING, `veto ${ev.veto.code} (${ev.veto.agent}): ${ev.veto.message}`);
        else if (ev.type === 'agent_finding') status(TaskState.TASK_STATE_WORKING, `${ev.finding.agentName}: risk ${ev.finding.riskScore}, confidence ${ev.finding.confidence}. ${ev.finding.summary}`);
        else if (ev.type === 'debate_start') status(TaskState.TASK_STATE_WORKING, `debate between ${ev.agents.join(' and ')} (spread ${ev.spread})`);
        else if (ev.type === 'consensus') status(TaskState.TASK_STATE_WORKING, `consensus: weighted ${ev.consensus.weightedScore}, spread ${ev.consensus.spread}, suggests ${ev.consensus.suggestedBand}`);
        else if (ev.type === 'judge_start') status(TaskState.TASK_STATE_WORKING, `judge (${ev.model}) deliberating`);
      });
      const view = verdictView(v, this.o);
      bus.publish({ kind: 'artifactUpdate', data: { taskId, contextId, append: false, lastChunk: true, metadata: undefined, artifact: { artifactId: v.attestation.digest, name: 'verdict', description: `Sentinel verdict ${v.verdict} ${v.riskScore}/100 for ${mint}`, parts: [data(view), text(`${v.verdict} · risk ${v.riskScore}/100 · confidence ${v.confidence}\n${v.reasoning}`)], metadata: { digest: v.attestation.digest, concordiumTx: v.attestation.concordiumTx }, extensions: [] } } });
      status(TaskState.TASK_STATE_COMPLETED, `${v.verdict} · risk ${v.riskScore}/100 · confidence ${v.confidence}`);
    } catch (e) {
      status(TaskState.TASK_STATE_FAILED, e instanceof Error ? e.message : String(e));
    } finally {
      bus.finished();
    }
  }

  async cancelTask(): Promise<void> { /* verdicts are short; nothing to cancel */ }
}

/** The A2A v1.0 card the handler serves; mirrors the registry card and carries its badge extension. */
export function a2aCard(o: McpOptions, badge?: AgentExtension | null): AgentCard {
  return {
    name: 'Sentinel',
    description: 'Accountable anti-rug oracle for Solana tokens: a swarm of seven specialist agents and a judge returns a verdict (SAFE / CAUTION / DANGER / RUGGED) with evidence, confidence and an on-chain audit record on Concordium.',
    version: o.version ?? '0.1.0',
    supportedInterfaces: [{ url: `${o.baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }],
    provider: { organization: 'Sentinel', url: o.baseUrl },
    documentationUrl: `${o.baseUrl}/docs`,
    capabilities: { streaming: true, pushNotifications: false, extensions: badge ? [badge] : [], extendedAgentCard: false },
    securitySchemes: {},
    securityRequirements: [],
    skills: [
      { id: 'sentinel.verdict', name: 'Token verdict', description: 'Send a Solana mint; receive the swarm verdict with evidence, agent findings, consensus and audit digest.', tags: ['solana', 'rug-detection', 'risk', 'x402'], examples: ['Is Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU a rug?'], inputModes: ['text/plain', 'application/json'], outputModes: ['application/json', 'text/plain'], securityRequirements: [] },
    ],
    signatures: [],
    iconUrl: undefined,
  } as unknown as AgentCard;
}

/** Pull the Concordium badge extension out of a registry-built card, if we have one on disk. */
export function badgeExtension(cardJson: string | null): AgentExtension | null {
  if (!cardJson) return null;
  try {
    const card = JSON.parse(cardJson) as { capabilities?: { extensions?: Array<{ uri: string; description?: string; required?: boolean; params?: Record<string, unknown> }> } };
    const ext = card.capabilities?.extensions?.find(e => e.uri.includes('concordium-badge'));
    return ext ? ({ uri: ext.uri, description: ext.description ?? '', required: ext.required ?? false, params: ext.params ?? {} } as AgentExtension) : null;
  } catch { return null; }
}

export function mountA2A(app: Hono, paths: string[], o: McpOptions, badge: AgentExtension | null) {
  const card = a2aCard(o, badge);
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), new SentinelExecutor(o));
  const transport = new JsonRpcTransportHandler(handler);
  for (const path of paths) {
    app.get(path, async c => c.json(await handler.getAgentCard()));
    app.post(path, async c => {
      const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
      const requestedVersion = c.req.header('A2A-Version') ?? '1.0';
      const context = new ServerCallContext({ requestedVersion, state: new Map<string, unknown>([['headers', Object.fromEntries(c.req.raw.headers)]]) });
      try {
        validateVersion(requestedVersion, await handler.getAgentCard(), 'JSONRPC');
        const result = await transport.handle(body, context);
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          const stream = result as AsyncGenerator<unknown>;
          const encoder = new TextEncoder();
          return new Response(new ReadableStream({
            async start(controller) {
              try { for await (const ev of stream) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
              catch (e) { controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, error: JsonRpcTransportHandler.mapToJSONRPCError(e) })}\n\n`)); }
              finally { controller.close(); }
            },
          }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
        }
        return c.json(result as Record<string, unknown>);
      } catch (e) {
        return c.json({ jsonrpc: '2.0', id: body.id ?? null, error: JsonRpcTransportHandler.mapToJSONRPCError(e) });
      }
    });
  }
}
