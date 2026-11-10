import { CopyButton } from "@/components/CopyButton";
import { serverApi, type AgentsResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const MCP_CONFIG = `{
  "mcpServers": {
    "sentinel": {
      "type": "http",
      "url": "https://api.sentinelagent.pro/mcp"
    }
  }
}`;
const PROMPT = `You have the Sentinel MCP server (https://api.sentinelagent.pro/mcp). Use it for every Solana token before money moves.
1. Call sentinel_quick with the mint first. It is free and takes about a second. Its SAFE only means no authority, holder or liquidity rule fired; it never clears a trade on its own.
2. Before any buy, or whenever sentinel_quick is not SAFE, call sentinel_verdict with an idempotency_key unique to this decision and max_price_ccd set to your budget. On a timeout, retry with the same key: you are not charged twice.
3. Treat DANGER or RUGGED as a hard stop. Tell the user the verdict, the risk score, the confidence and the top reason, and link the audit record.
4. Once per session, read sentinel_track and weigh Sentinel by its calibration (Brier and skill), not by its confidence.`;
const SAFE_PAY = `POST /x402/verdict
Idempotency-Key: trade-7f3a-0001        # unique per decision; a retry returns the verdict already paid for
X-Max-Price-CCD: 2                      # or "max_price_ccd" in the body / MCP arguments
{"mint":"<mint>"}

→ 412 {"error":"price_above_max","price_ccd":…,"charged":false}   price above your ceiling, nothing paid
→ 409 {"error":"…still running…","retry_after_seconds":10}         same key in flight, nothing paid
→ 200 + idempotent-replay: true                                   the verdict you already paid for`;
const TOOLS: Array<[string, string, string]> = [
  ["sentinel_verdict", "{ mint, fresh?, idempotency_key?, max_price_ccd? }", "Full swarm verdict: band, risk, confidence, headline, decisive fact, action, reasons, clean signals, what would change it, scorecard, advocate and rebuttal, vetoes, findings, consensus, flags, evidence incl. money flow, attestation (digest, Concordium tx, ML-DSA-65 signature). Paid over x402 when the server has a paywall. Streams progress notifications."],
  ["sentinel_quick", "{ mint }", "Free first look in about a second, no models: mint and freeze authority, Token-2022 extensions, holder concentration, liquidity and market shape, with what was and was not checked. A screen, not a clearance."],
  ["sentinel_agents", "{}", "The nine agents: roles, registry token ids, badge addresses, badge-check URLs, Agent Card URLs."],
  ["sentinel_check_badge", "{ id }", "Verify any Concordium agent badge or list an account's badges via the Agent Registry."],
  ["sentinel_audit", "{ digest? | mint? | limit? }", "Past verdicts with their on-chain audit records and outcomes."],
  ["sentinel_track", "{ limit? }", "The track record: Brier, skill vs base rate, log score, reliability bins, per specialist; graded verdicts with their grade anchors."],
];
const A2A = `POST /a2a\nA2A-Version: 1.0\n\n{"jsonrpc":"2.0","id":1,"method":"SendStreamingMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"data":{"mint":"Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"}}]}}}\n\n→ task · statusUpdate (one per specialist) · artifactUpdate { verdict } · statusUpdate COMPLETED`;
const AUDIT = `sentinel_audit.record { digest: [u8;32], chain, subject, verdict, risk_score: u8, agent_ids: [u64], observed_at: u64 } → seq\nsentinel_audit.view(seq) → Record · count() · info()\nsentinel_audit.grade  { seq, horizon: u32, labels, rugged, liquidity_bps: u16, price_bps: u16, observed_at }\n                      (once per horizon; the record itself is never edited)\nsentinel_audit.grades(seq) → [Grade]`;
const SECTIONS = ["01 MCP", "02 Tools", "03 A2A", "04 x402", "05 Audit", "06 Track", "07 Verify"];

export default async function DocsPage() {
  const a = await fetch(`${serverApi()}/api/agents`, { cache: "no-store" }).then(r => (r.ok ? (r.json() as Promise<AgentsResponse>) : null)).catch(() => null);
  const price = (a?.price ? `${Number(a.price.microCcd) / 1e6} CCD` : "1 CCD") + (a?.price?.plt ? ` or ${Number(a.price.plt.amount) / 1e6} ${a.price.plt.asset}` : "");
  const payTo = a?.price?.payTo ?? "<owner account>";
  const X402 = `POST /x402/verdict  {"mint":"<mint>"}\n→ 402 · PAYMENT-REQUIRED: base64({ "x402Version": 2, "accepts": [{ "scheme": "exact", "network": "ccd:testnet",\n     "amount": "${a?.price?.microCcd ?? "1000000"}", "asset": "CCD", "payTo": "${payTo.slice(0, 12)}…", "extra": { "feePayer": "<sponsor>" } }] })\nPOST /x402/verdict + PAYMENT-SIGNATURE: base64({ signedTransaction, sender })\n→ 200 · PAYMENT-RESPONSE: base64({ success, transaction }) · verdict JSON`;
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 grid gap-10 lg:grid-cols-[200px_1fr]">
      <nav className="hidden lg:block sticky top-24 self-start space-y-2 mono text-sm">
        {SECTIONS.map(s => <a key={s} href={`#${s.slice(3).toLowerCase()}`} className="block text-fg-3 hover:text-fg border-l-2 border-transparent hover:border-red pl-3 transition-colors">{s}</a>)}
      </nav>
      <div className="min-w-0 space-y-14">
        <header><div className="display text-red text-sm">DOCS</div><h1 className="display text-[clamp(40px,7vw,96px)]">CALL SENTINEL</h1><p className="mt-3 text-fg-2 max-w-2xl">Three doors, one swarm. Any MCP client, any A2A agent, any script with an x402-aware fetch. Verdicts cost {price}; discovery, badge checks, audit and track lookups are free.</p></header>

        <Doc id="mcp" title="01 · MCP">
          <p>Streamable HTTP, stateless. Add the server to Claude Desktop, Claude Code or any MCP client; discovery is free, verdicts are paid when a paywall is configured.</p>
          <Code title="mcp config" text={MCP_CONFIG} />
          <Code title="paste into your agent" text={PROMPT} />
          <p>Agents that read before they call: <a className="text-fg underline" href="/llms.txt">/llms.txt</a> has the endpoints, the price, the paying rules and this prompt in one plain-text page.</p>
        </Doc>

        <Doc id="tools" title="02 · Tools">
          <div className="grid gap-2">{TOOLS.map(([n, i, d]) => <div key={n} className="rounded-2xl border border-line-2 p-4"><div className="flex flex-wrap items-baseline gap-3"><span className="mono text-fg">{n}</span><span className="mono text-xs text-fg-4">{i}</span></div><p className="mt-2 text-sm text-fg-2">{d}</p></div>)}</div>
        </Doc>

        <Doc id="a2a" title="03 · A2A">
          <p>A2A v1.0 over JSON-RPC with SSE streaming. The Agent Card at <span className="mono">/.well-known/agent-card.json</span> is the one pinned in the Concordium Agent Registry and carries the badge extension.</p>
          <Code title="SendStreamingMessage" text={A2A} />
        </Doc>

        <Doc id="x402" title="04 · x402">
          <p>Pay per verdict in CCD on Concordium testnet: <span className="text-fg">{price}</span>, paid to <span className="mono text-fg break-all">{payTo}</span>. The 402 response carries the requirements; the client signs a sponsored transfer, our facilitator pays the fee and submits, finality in about ten seconds, verdict in the 200. The paying agent never needs CCD for fees, only for the price.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[["MCP", "Claude, GPT, any MCP client", `tools/call sentinel_verdict · ${price}`], ["A2A", "agents speaking A2A v1.0", "SendMessage with a mint → Task with the verdict artifact"], ["HTTP", "bots and scripts", `POST /x402/verdict · ${price}`]].map(([n, who, how]) => <div key={n} className="rounded-2xl border border-line-2 p-4"><div className="display text-xl">{n}</div><div className="mt-1 text-sm text-fg-3">{who}</div><div className="mt-2 mono text-xs text-fg-2">{how}</div></div>)}
          </div>
          <Code title="plain HTTP" text={X402} />
          <p>Two guards for agents that spend on their own: an idempotency key so a retry after a timeout is never charged twice, and a price ceiling so a price change never surprises the wallet. Both are checked before the 402, so a refused call costs nothing.</p>
          <Code title="paying safely" text={SAFE_PAY} />
          <p><span className="text-fg">Guarantee.</span> A paid SAFE verdict on a token that rugs within 24 hours is refunded to the paying account, automatically. The receipt is recorded only after the x402 payment settles, the resolver&apos;s 24 h grade decides the claim, and the refund goes back in the asset paid (CCD, or EUDemo as a PLT transfer) with a memo naming the verdict digest, so anyone can match it on CCDScan. The first one paid out on 9 Nov 2026: a SAFE on PAYDAY was drained within a day and 1 CCD went back automatically. Terms, the pool account and every claim: <a className="text-fg underline" href="https://api.sentinelagent.pro/guarantee">/guarantee</a>.</p>
          <p><span className="text-fg">Sentinel Guard.</span> For trading agents, <span className="mono">sentinelagent-guard</span> wraps all of this in one call that returns allow, warn or block: it checks Sentinel&apos;s badge with the Concordium registry, blocks hard red flags for free, pays only when needed and fails closed. It ships an ElizaOS action and a wrapper that stops an existing swap from buying a blocked token. <a className="text-fg underline" href="https://github.com/0xNickdev/sentinel-agent/tree/main/guard">guard/</a></p>
        </Doc>

        <Doc id="audit" title="05 · Audit trail">
          <p>Each verdict is canonicalised and hashed (sha256 over chain, mint, snapshot time, evidence, verdict). The digest, the subject, the band, the score and the agents' registry ids are appended to the <span className="mono">sentinel_audit</span> contract on Concordium testnet. The contract has no update and no delete; outcomes are added beside a record with <span className="mono">grade</span>, once per horizon. EU AI Act Art. 12 record keeping, readable by anyone on CCDScan.</p>
          <Code title="contract entrypoints" text={AUDIT} />
        </Doc>

        <Doc id="track" title="06 · Track record">
          <p>Every sealed verdict is scored against what the token did at 1h, 24h and 7d. <span className="mono">riskScore/100</span> is read as the forecast P(rug); a rug is liquidity down more than 99%, no trades left, the labels of arXiv:2608.20271, or a pool under 1% of market cap. The report gives the Brier score, the skill against the base rate, the log score, a reliability diagram and the same per specialist, so a calling agent can weigh Sentinel the way Sentinel weighs its own agents. Live at <a className="text-fg underline" href="/track">/track</a>, over MCP as <span className="mono">sentinel_track</span>, and as JSON at <span className="mono">/track</span>.</p>
        </Doc>

        <Doc id="verify" title="07 · Verify a verdict">
          <p>Two independent proofs. On-chain: the stored verdict JSON must hash to the digest in the Concordium record. Offline: the ML-DSA-65 (FIPS 204) signature over <span className="mono">sha256(digest ‖ mint ‖ verdict ‖ score ‖ at)</span> with context <span className="mono">sentinel.verdict/1</span>, public key at <span className="mono">/.well-known/sentinel-keys.json</span>. Post-quantum by design: the chains sign with Ed25519, the proof that a verdict came from Sentinel does not depend on it. Every audit record has a button that runs this check in your browser.{a?.attestation ? ` Current key: ${a.attestation.alg}, ${a.attestation.publicKey.slice(0, 16)}…` : ""}</p>
        </Doc>
      </div>
    </div>
  );
}

function Doc({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="space-y-4 text-fg-2 leading-7 scroll-mt-24"><h2 className="display text-2xl text-fg">{title}</h2>{children}</section>;
}
function Code({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-line-2 bg-bg-1 overflow-hidden"><div className="flex items-center justify-between px-4 h-10 border-b border-line mono text-xs text-fg-3"><span>{title}</span><CopyButton text={text} /></div><pre className="p-4 mono text-[12px] leading-5 overflow-x-auto text-fg-2 whitespace-pre-wrap">{text}</pre></div>;
}
