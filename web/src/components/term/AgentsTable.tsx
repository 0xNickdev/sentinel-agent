"use client";
import { useEffect, useState } from "react";
import { AGENTS, getJSON, short, type AgentsResponse, type Verdict, type VerdictSummary } from "@/lib/api";
import { CopyButton } from "@/components/CopyButton";
import { KV, Label } from "./Log";

const DOMAIN: Record<string, string> = Object.fromEntries(AGENTS.map(a => [a.id, a.domain]));
DOMAIN.gateway = "MCP · A2A · x402 entry point";
DOMAIN.judge = "weighs the seven under the consensus rule";

/** `ps`-style table of the agents with their registry tokens and badges, plus how to verify them. */
export function AgentsTable() {
  const [a, setA] = useState<AgentsResponse | null>(null);
  const [err, setErr] = useState(false);
  const [models, setModels] = useState<Verdict["models"] | null>(null);
  useEffect(() => {
    getJSON<AgentsResponse>("/api/agents").then(setA).catch(() => setErr(true));
    // The models the swarm currently runs on, read from the latest stored verdict.
    getJSON<VerdictSummary[]>("/verdicts?limit=1").then(l => (l[0] ? getJSON<Verdict>(`/verdicts/${l[0].digest}`) : null)).then(v => v && setModels(v.models)).catch(() => undefined);
  }, []);
  const gw = a?.agents.find(x => x.key === "gateway");
  const check = gw?.badgeCheck ?? "https://agent-registry-mcp.concordium.com/v1/check-badge/<badge>";
  const curl = `GET ${check}\n\n# over MCP (Concordium Agent Registry)\n{"method":"tools/call","params":{"name":"check_badge","arguments":{"id":"${gw?.badge ?? "<badge>"}","network":"testnet"}}}\n\n# Sentinel's own MCP exposes the same check\n{"method":"tools/call","params":{"name":"sentinel_check_badge","arguments":{"id":"${gw?.badge ?? "<badge>"}"}}}`;
  return (
    <div>
      <Label>agents · {a ? `${a.agents.length} agents · ${a.network} · ${a.agents.filter(x => x.badge).length} badged` : err ? "api unreachable" : "loading"}</Label>
      <div className="tt-wrap"><table className="tt w-full">
        <thead><tr><th>id</th><th>name</th><th>domain</th><th>model</th><th className="text-right">token</th><th>badge</th><th>check</th><th>card</th></tr></thead>
        <tbody>
          {!a && <tr><td colSpan={8} className="text-fg-4">{err ? "the Sentinel API is not reachable; agents cannot be listed" : "…"}</td></tr>}
          {a?.agents.map(x => (
            <tr key={x.key} className="row">
              <td className="text-fg">{x.key}</td>
              <td className="text-fg-2">{x.name}</td>
              <td className="wrap text-fg-3">{DOMAIN[x.key] ?? x.role}</td>
              <td className="text-fg-3">{x.key === "judge" ? models?.judge ?? "judge" : x.key === "gateway" ? models?.engine ?? "—" : models?.specialist ?? "specialist"}</td>
              <td className="text-right">{x.tokenId != null ? `#${x.tokenId}` : <span className="text-fg-4">pending</span>}</td>
              <td>{x.badge ? <span title={x.badge}>{short(x.badge, 6)}</span> : <span className="text-fg-4">pending</span>}</td>
              <td>{x.badgeCheck ? <a className="act" href={x.badgeCheck} target="_blank" rel="noreferrer">[check ↗]</a> : <span className="text-fg-4">—</span>}</td>
              <td><a className="act" href={x.card} target="_blank" rel="noreferrer">[card ↗]</a></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="text-fg-4 mt-2">pending: the agents are minted into the CIS-8004 registry on testnet before submission; token ids and badge addresses appear here as soon as the server reports them.{a?.attestation ? ` verdict signatures: ${a.attestation.alg}, public key ${short(a.attestation.publicKey, 10)}.` : ""}</div>

      <Label>how to verify</Label>
      <KV k="01 resolve">badge token address → CIS-8004 Agent Registry on Concordium testnet (&lt;12802,0&gt;)</KV>
      <KV k="02 check">agent_of(token_id) → owner account; status must be Active</KV>
      <KV k="03 hash">fetch the Agent Card at agent_uri, sha256 the bytes, compare to the on-chain metadata_hash</KV>
      <KV k="04 trust">the owner account is Concordium-ID backed: one verified human is accountable for every verdict</KV>
      <div className="text-fg-4 mt-2">honest framing: the badge proves an accountable, verified owner exists. it does not prove a verdict is right. the audit trail and the ML-DSA-65 signature prove what we said; confidence tells you how sure we were.</div>

      <Label>check from any agent <CopyButton text={curl} /></Label>
      <pre className="whitespace-pre-wrap text-fg-2">{curl}</pre>
    </div>
  );
}
