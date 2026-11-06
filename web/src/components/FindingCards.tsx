"use client";
import { useState } from "react";
import type { Finding, Verdict } from "@/lib/api";
import { AgentViz, RiskDots, agentFacts } from "./AgentViz";

type Weight = Verdict["scorecard"][number]["weight"];
const ORDER: Record<Weight, number> = { decisive: 0, supporting: 1, discounted: 2, ignored: 3 };
const WEIGHT_CLS: Record<Weight, string> = { decisive: "text-red", supporting: "text-fg", discounted: "text-fg-3", ignored: "text-fg-4" };
const COLS = "md:grid-cols-[minmax(150px,1.1fr)_120px_minmax(180px,1.6fr)_minmax(220px,1.5fr)_20px]";

/**
 * One table for the whole swarm: a row per agent, the same columns in every row
 * (who, risk and how much it counted, the picture, the numbers), the words folded under the row.
 * Rows that decided the verdict come first.
 */
export function FindingCards({ v, notable = 4, glass = false }: { v: Verdict; notable?: number; glass?: boolean }) {
  if (!v.findings.length) return null;
  const card = new Map(v.scorecard.map(s => [s.agent, s]));
  const rows = [...v.findings].sort((a, b) => (ORDER[card.get(a.agent)?.weight ?? "supporting"] - ORDER[card.get(b.agent)?.weight ?? "supporting"]) || b.riskScore - a.riskScore);
  return (
    <div className={`rounded-2xl border border-line-2 overflow-hidden ${glass ? "bg-black/60" : ""}`}>
      <div className={`hidden md:grid ${COLS} gap-4 px-4 h-9 items-center mono text-[10px] text-fg-4 border-b border-line`}>
        <span>AGENT</span><span>RISK · WEIGHT</span><span>WHAT IT SAW</span><span>KEY NUMBERS</span><span />
      </div>
      <div className="divide-y divide-line">
        {rows.map(f => <Row key={f.agent} f={f} v={v} weight={card.get(f.agent)?.weight} why={card.get(f.agent)?.why} notable={notable} />)}
      </div>
    </div>
  );
}

function Row({ f, v, weight, why, notable }: { f: Finding; v: Verdict; weight?: Weight; why?: string; notable: number }) {
  const [open, setOpen] = useState(false);
  const hot = f.riskScore >= 65;
  const facts = agentFacts(f.agent, v.evidence);
  const viz = AgentViz({ agent: f.agent, e: v.evidence });
  return (
    <div className={hot ? "bg-red/[0.04]" : ""}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`w-full text-left grid grid-cols-[1fr_auto] ${COLS} gap-x-4 gap-y-3 px-4 py-3.5 items-center hover:bg-white/[0.02] transition-colors`}>
        <div className="min-w-0">
          <div className={`display text-xs ${hot ? "text-red" : "text-fg"}`}>{f.agentName.toUpperCase()}</div>
          <div className="mt-1 mono text-[10px] text-fg-4">{f.label.replace(/_/g, " ")}{f.agentRegistryId ? ` · #${f.agentRegistryId}` : ""}</div>
        </div>
        <div className="md:order-none text-right md:text-left">
          <div className="flex items-baseline gap-2 justify-end md:justify-start">
            <span className={`display-num text-2xl leading-none ${hot ? "text-red" : ""}`}>{f.riskScore}</span>
            {f.revised && <span className="mono text-[10px] text-fg-4">was {f.revised.riskScore}</span>}
          </div>
          <div className="mt-1.5 hidden md:block"><RiskDots score={f.riskScore} confidence={f.confidence} size="sm" /></div>
          {weight && <div className={`mt-1 mono text-[10px] ${WEIGHT_CLS[weight]}`}>{weight}</div>}
        </div>
        <div className="col-span-2 md:col-span-1 min-w-0">{viz ?? <div className="h-6 flex items-center mono text-[10px] text-fg-4 border border-dashed border-line-2 rounded-md px-2 truncate">{emptyWhy(f.agent)}</div>}</div>
        <dl className="col-span-2 md:col-span-1 grid grid-cols-3 gap-2">
          {facts.map(([k, val, bad]) => (
            <div key={k} className="min-w-0"><dt className="mono text-[9px] text-fg-4 truncate">{k}</dt><dd className={`mono text-xs truncate ${bad ? "text-red" : "text-fg"}`}>{val}</dd></div>
          ))}
        </dl>
        <span className={`hidden md:block mono text-fg-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-4 md:grid-cols-[1.4fr_1fr] text-sm">
          <div>
            <div className="mono text-[10px] text-fg-4 mb-1">AGENT SAYS</div>
            <p className="text-fg-2 leading-6">{f.summary}</p>
            {notable > 0 && f.notable.length > 0 && <ul className="mt-2 mono text-[11px] text-fg-3 space-y-1">{f.notable.slice(0, notable).map((n, i) => <li key={i}>· {n}</li>)}</ul>}
          </div>
          <div>
            {why && <><div className="mono text-[10px] text-fg-4 mb-1">JUDGE · <span className={weight ? WEIGHT_CLS[weight] : ""}>{weight}</span></div><p className="text-fg-2 leading-6">{why}</p></>}
            <div className="mt-2 mono text-[10px] text-fg-4">confidence {f.confidence.toFixed(2)} · weight {f.weight} · {(f.ms / 1000).toFixed(1)}s · {f.model}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function emptyWhy(agent: string) {
  return ({ holders: "no holders yet", snipers: "no snipers or bundles", funding: "no wallets traced", creator: "creator has not traded", contract: "contract not read", market: "no market data", flows: "no money moved" } as Record<string, string>)[agent] ?? "no data";
}
