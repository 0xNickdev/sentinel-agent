import { CopyButton } from "@/components/CopyButton";
import { Label } from "@/components/term/Log";
import { serverApi, type AgentsResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const MCP_CONFIG = `{
  "mcpServers": {
    "sentinel": { "type": "http", "url": "https://<sentinel-host>/mcp" }
  }
}`;
const PROMPT = `Before trading any Solana token, call sentinel_verdict with its mint. Treat DANGER or RUGGED as a hard stop. Quote the risk score, the confidence and the top reason to the user, and link the audit record.`;
const TOOLS: Array<[string, string, string]> = [
  ["sentinel_verdict", "{ mint, fresh? }", "full swarm verdict: band, risk, confidence, reasons, dissent, vetoes, findings, consensus, flags, attestation (digest, Concordium tx, ML-DSA-65 signature). paid over x402 when the server has a paywall. streams progress notifications."],
  ["sentinel_agents", "{}", "the agents: roles, registry token ids, badge addresses, badge-check URLs, Agent Card URLs."],
  ["sentinel_check_badge", "{ id }", "verify any Concordium agent badge or list an account's badges via the Agent Registry."],
  ["sentinel_audit", "{ digest? | mint? | limit? }", "past verdicts with their on-chain audit records."],
  ["sentinel_track", "{ limit? }", "the track record: Brier, skill vs base rate, reliability, per specialist; graded verdicts with their grade anchors."],
];
const A2A = `POST /a2a\nA2A-Version: 1.0\n\n{"jsonrpc":"2.0","id":1,"method":"SendStreamingMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"data":{"mint":"Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"}}]}}}\n\n→ task · statusUpdate (one per specialist) · artifactUpdate { verdict } · statusUpdate COMPLETED`;
const AUDIT = `sentinel_audit.record { digest: [u8;32], chain, subject, verdict, risk_score: u8, agent_ids: [u64], observed_at: u64 } → seq\nsentinel_audit.view(seq) → Record · count() · info()\nsentinel_audit.grade  { seq, horizon: u32, labels, rugged, liquidity_bps: u16, price_bps: u16, observed_at } (once per horizon; the record is never edited)\nsentinel_audit.grades(seq) → [Grade]`;

/** man sentinel */
export default async function DocsPage() {
  const a = await fetch(`${serverApi()}/api/agents`, { cache: "no-store" }).then(r => (r.ok ? (r.json() as Promise<AgentsResponse>) : null)).catch(() => null);
  const price = a?.price ? `${Number(a.price.microCcd) / 1e6} CCD` : "1 CCD";
  const payTo = a?.price?.payTo ?? "<owner account>";
  const X402 = `POST /x402/verdict HTTP/1.1\nContent-Type: application/json\n\n{"mint":"Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"}\n\nHTTP/1.1 402 Payment Required\nPAYMENT-REQUIRED: base64({ "x402Version": 2, "accepts": [{ "scheme": "exact", "network": "ccd:testnet",\n  "amount": "${a?.price?.microCcd ?? "1000000"}", "asset": "CCD", "payTo": "${payTo.slice(0, 12)}…", "extra": { "feePayer": "<sponsor>" } }] })\n\nPOST /x402/verdict + PAYMENT-SIGNATURE: base64({ signedTransaction, sender })\n\nHTTP/1.1 200 OK\nPAYMENT-RESPONSE: base64({ "success": true, "transaction": "<concordium tx>" })\n{ "verdict": "RUGGED", "riskScore": 88, "confidence": 0.7, ... }`;
  return (
    <div className="max-w-[96ch]">
      <div className="pt-3 text-fg-4 flex justify-between"><span>SENTINEL(1)</span><span>Agent Commands Manual</span><span>SENTINEL(1)</span></div>

      <Man id="name" title="name">
        <p>sentinel — accountable anti-rug verdicts for agents. MCP, A2A and x402 doors; one swarm behind them.</p>
      </Man>

      <Man id="synopsis" title="synopsis">
        <pre className="whitespace-pre-wrap text-fg">{`sentinel_verdict  { mint, fresh? }        → verdict        (${price} over x402)\nsentinel_agents   { }                      → agents, badges (free)\nsentinel_check_badge { id }                → badge status   (free)\nsentinel_audit    { digest? | mint? }      → records        (free)\nsentinel_track    { limit? }               → track record   (free)`}</pre>
      </Man>

      <Man id="mcp" title="mcp" copy={MCP_CONFIG}>
        <p>streamable HTTP, stateless. add the server to Claude Desktop, Claude Code or any MCP client; discovery is free, verdicts are paid when a paywall is configured.</p>
        <Code>{MCP_CONFIG}</Code>
        <p className="mt-2 text-fg-4">agent prompt <CopyButton text={PROMPT} /></p>
        <Code>{PROMPT}</Code>
      </Man>

      <Man id="tools" title="tools">
        {TOOLS.map(([n, i, d]) => <div key={n} className="grid grid-cols-[22ch_1fr] gap-x-2 mb-2"><span><span className="text-fg">{n}</span><div className="text-fg-4">{i}</div></span><span>{d}</span></div>)}
      </Man>

      <Man id="a2a" title="a2a" copy={A2A}>
        <p>A2A v1.0 over JSON-RPC with SSE streaming. the Agent Card at <span className="text-fg">/.well-known/agent-card.json</span> is the one pinned in the Concordium Agent Registry and carries the badge extension.</p>
        <Code>{A2A}</Code>
      </Man>

      <Man id="x402" title="x402" copy={X402}>
        <p>pay per verdict in CCD on Concordium testnet: <span className="text-fg">{price}</span>, pay to <span className="text-fg">{payTo}</span>. the 402 carries the requirements; the client signs a sponsored transfer, our facilitator pays the fee and submits, finality in about ten seconds, verdict in the 200. the paying agent never needs CCD for fees, only for the price. discovery, badge checks and audit lookups are free.</p>
        <div className="grid grid-cols-[6ch_1fr] gap-x-2 mt-2 mb-2"><span className="text-fg">MCP</span><span>Claude, GPT, any MCP client · tools/call sentinel_verdict · {price}</span><span className="text-fg">A2A</span><span>agents speaking A2A v1.0 · SendMessage with a mint → Task with the verdict artifact</span><span className="text-fg">HTTP</span><span>bots and scripts · POST /x402/verdict · {price}</span></div>
        <Code>{X402}</Code>
      </Man>

      <Man id="audit" title="audit" copy={AUDIT}>
        <p>each verdict is canonicalised and hashed (sha256 over chain, mint, snapshot time, evidence, verdict). the digest, the subject, the band, the score and the agents' registry ids are appended to the <span className="text-fg">sentinel_audit</span> contract on Concordium testnet. the contract has no update and no delete. EU AI Act Art. 12 record keeping, readable by anyone on CCDScan.</p>
        <Code>{AUDIT}</Code>
      </Man>

      <Man id="verify" title="verify">
        <p>two independent proofs. on-chain: the stored verdict JSON must hash to the digest in the Concordium record. offline: the ML-DSA-65 (FIPS 204) signature over <span className="text-fg">sha256(digest ‖ mint ‖ verdict ‖ score ‖ at)</span> with context <span className="text-fg">sentinel.verdict/1</span>, public key at <span className="text-fg">/.well-known/sentinel-keys.json</span>. post-quantum by design: the chains sign with Ed25519, the proof that a verdict came from Sentinel does not depend on it. every audit record has a <span className="text-fg">[verify]</span> action that runs this check in your browser.</p>
      </Man>

      <Man id="see-also" title="see also">
        <p><a className="act" href="/audit">audit(1)</a> <a className="act" href="/agents">agents(1)</a> <a className="act" href="https://agent-registry-mcp.concordium.com/docs" target="_blank" rel="noreferrer">concordium-agent-registry(7)</a> <a className="act" href="https://testnet.ccdscan.io" target="_blank" rel="noreferrer">ccdscan(7)</a></p>
      </Man>
    </div>
  );
}

function Man({ id, title, copy, children }: { id: string; title: string; copy?: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-24"><Label>{title}{copy ? <> <CopyButton text={copy} /></> : null}</Label><div className="pl-0 sm:pl-[4ch] text-fg-2 space-y-1">{children}</div></section>;
}
function Code({ children }: { children: string }) {
  return <pre className="whitespace-pre-wrap text-fg-3 border-l border-line-2 pl-3 my-1">{children}</pre>;
}
