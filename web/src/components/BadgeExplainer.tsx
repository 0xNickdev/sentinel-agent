"use client";
import { useEffect, useState } from "react";
import { getJSON, type AgentsResponse } from "@/lib/api";
import { CopyButton } from "./CopyButton";

export function BadgeExplainer() {
  const [a, setA] = useState<AgentsResponse | null>(null);
  useEffect(() => { getJSON<AgentsResponse>("/api/agents").then(setA).catch(() => undefined); }, []);
  const gw = a?.agents.find(x => x.key === "gateway");
  const steps = [
    ["resolve", "Badge token address → CIS-8004 registry on Concordium testnet (<12802,0>)"],
    ["check", "agent_of(token_id): owner account, status must be Active"],
    ["hash", "Fetch the Agent Card at agent_uri, sha256 the bytes, compare to the on-chain metadata_hash"],
    ["trust", "The owner account is ID-backed: a verified human is accountable for this agent"],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-line-2 p-6">
        <div className="display text-sm text-red">HOW TO VERIFY US</div>
        <ol className="mt-4 space-y-3">{steps.map(([k, v], i) => <li key={k} className="flex gap-3"><span className="display-num text-fg-3 w-6">{String(i + 1).padStart(2, "0")}</span><div><div className="text-fg">{k}</div><div className="text-sm text-fg-3">{v}</div></div></li>)}</ol>
        <p className="mt-4 text-sm text-fg-3">Honest framing: the badge proves an accountable, verified owner exists. It does not prove a verdict is right. The audit trail and the signature prove what we said; confidence tells you how sure we were.</p>
      </div>
      <div className="rounded-2xl border border-line-2 bg-bg-1 overflow-hidden">
        <div className="flex items-center justify-between px-4 h-10 border-b border-line mono text-xs text-fg-3"><span>check from any agent</span><CopyButton text={gw?.badgeCheck ?? "https://agent-registry-mcp.concordium.com/v1/check-badge/<badge>"} label="Copy URL" /></div>
        <pre className="p-4 mono text-[12px] leading-5 overflow-x-auto text-fg-2">{`GET ${gw?.badgeCheck ?? "https://agent-registry-mcp.concordium.com/v1/check-badge/<badge>"}\n\n# or over MCP\n{"method":"tools/call","params":{"name":"check_badge","arguments":{"id":"${gw?.badge ?? "<badge>"}","network":"testnet"}}}\n\n# Sentinel's own MCP exposes the same check\n{"method":"tools/call","params":{"name":"sentinel_check_badge","arguments":{"id":"${gw?.badge ?? "<badge>"}"}}}`}</pre>
        <div className="px-4 pb-4 mono text-xs text-fg-4">{gw?.badge ? `registered · token #${gw.tokenId} · ${gw.badge}` : "registration on testnet pending: badge addresses appear here once the agents are minted"}{a?.attestation ? ` · verdict signatures ${a.attestation.alg}` : ""}</div>
      </div>
    </div>
  );
}
