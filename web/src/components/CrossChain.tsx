"use client";
import { useEffect, useState } from "react";
import { ccdscanTx, getJSON, short, type AgentsResponse } from "@/lib/api";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(hex: string): string {
  let n = BigInt(`0x${hex || "0"}`);
  let out = "";
  const Z = BigInt(0), F = BigInt(58);
  while (n > Z) { out = B58[Number(n % F)] + out; n /= F; }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2) out = `1${out}`;
  return out;
}

/** /agents: how a Solana-side caller gets from Sentinel's key to the verified human behind it (CIS-8 → CIS-8004). */
export function CrossChain() {
  const [d, setD] = useState<AgentsResponse | null>(null);
  useEffect(() => { getJSON<AgentsResponse>("/api/agents").then(setD).catch(() => undefined); }, []);
  const b = d?.cis8;
  const gateway = d?.agents.find(a => a.key === "gateway");
  const solana = b ? base58(b.externalKey.public_key_hex) : null;
  const linkTx = b?.agentLinks ? Object.values(b.agentLinks)[0] : null;
  const steps = [
    { k: "SOLANA KEY", v: solana ? short(solana, 6) : "—", d: "Sentinel's own ed25519 key on Solana, held by the operator.", href: solana ? `https://solscan.io/account/${solana}` : null },
    { k: "CIS-8", v: b ? `${b.contract.index}.${b.contract.subindex}` : "—", d: "External Key Registry: the key signed a binding to the owner's Concordium account, verified on-chain.", href: b ? ccdscanTx(b.registerTx) : null },
    { k: "VERIFIED HUMAN", v: b ? short(b.owner, 6) : "—", d: "The owner account is backed by a Concordium identity: a real person, revocably anonymous under Privacy Guardians.", href: null },
    { k: "AGENT", v: gateway?.badge ? `#${gateway.tokenId}` : "—", d: "CIS-8004 Agent Registry: the gateway agent points its external reference at the same key.", href: linkTx ? ccdscanTx(linkTx) : gateway?.badgeCheck ?? null },
  ];
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="display text-sm text-red">ACROSS CHAINS</div><h2 className="display text-[clamp(28px,4vw,48px)] mt-3 leading-none">FROM A SOLANA KEY TO A PERSON</h2></div>
        <p className="text-fg-2 max-w-md text-sm">Anyone on Solana can resolve Sentinel's key without trusting us: <span className="mono text-fg">owner_of_key</span> gives the verified owner, <span className="mono text-fg">agent_by_external_reference</span> gives the agent and its badge.</p>
      </div>
      <ol className="mt-6 grid gap-3 md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.k} className="relative rounded-2xl border border-line-2 bg-bg-1 p-5">
            <div className="flex items-center justify-between"><span className="display text-xs text-fg-4">{String(i + 1).padStart(2, "0")} · {s.k}</span>{i < steps.length - 1 && <span className="hidden md:block text-red" aria-hidden="true">→</span>}</div>
            <div className="display-num text-xl mt-4 break-all">{s.v}</div>
            <p className="text-xs text-fg-3 mt-2">{s.d}</p>
            {s.href && <a className="mono text-[11px] text-fg-2 hover:text-fg underline decoration-line-2 mt-3 inline-block" href={s.href} target="_blank" rel="noreferrer">on-chain ↗</a>}
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-2xl border border-line p-4 text-sm text-fg-3">
        <span className="display text-xs text-fg-4 mr-2">REPUTATION FROM OUTCOMES</span>
        Each agent's registry metadata carries <span className="mono text-fg">trackRecord</span>: its graded Brier score from <a className="underline decoration-line-2" href="/track">/track</a>. ERC-8004 reputation comes from feedback anyone can fake; ours comes from verdicts sealed before the outcome.
      </div>
    </section>
  );
}
