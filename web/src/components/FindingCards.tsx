"use client";
import { useState } from "react";
import type { Finding, Verdict } from "@/lib/api";
import { AgentViz, RiskDots } from "./AgentViz";

/** One card per specialist: a risk meter, a chart of what the agent read, then its words (folded to three lines). */
export function FindingCards({ findings, notable = 0, cols = "sm:grid-cols-2 lg:grid-cols-3", glass = false, evidence }: { findings: Finding[]; notable?: number; cols?: string; glass?: boolean; evidence?: Verdict["evidence"] }) {
  if (!findings.length) return null;
  return (
    <div className={`grid gap-2 ${cols}`}>
      {findings.map(f => <Card key={f.agent} f={f} notable={notable} glass={glass} evidence={evidence} />)}
    </div>
  );
}

function Card({ f, notable, glass, evidence }: { f: Finding; notable: number; glass: boolean; evidence?: Verdict["evidence"] }) {
  const [open, setOpen] = useState(false);
  const hot = f.riskScore >= 65;
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${hot ? "border-red/70" : "border-line-2"} ${glass ? "bg-black/60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="display text-xs">{f.agentName.toUpperCase()}</span>
        <span className={`display-num text-xl ${hot ? "text-red" : ""}`}>{f.riskScore}{f.revised ? <span className="text-fg-4 text-xs"> · was {f.revised.riskScore}</span> : null}</span>
      </div>
      <RiskDots score={f.riskScore} confidence={f.confidence} />
      {evidence && <AgentViz agent={f.agent} e={evidence} />}
      <button type="button" onClick={() => setOpen(o => !o)} className="text-left" aria-expanded={open}>
        <p className={`text-sm text-fg-2 leading-6 ${open ? "" : "line-clamp-3"}`}>{f.summary}</p>
        {!open && f.summary.length > 140 && <span className="mono text-[10px] text-fg-4 hover:text-fg">more</span>}
      </button>
      {open && notable > 0 && f.notable.length > 0 && <ul className="mono text-[11px] text-fg-3 space-y-1">{f.notable.slice(0, notable).map((n, i) => <li key={i}>· {n}</li>)}</ul>}
      <div className="mt-auto mono text-[10px] text-fg-4">{f.label.replace(/_/g, " ")} · conf {f.confidence.toFixed(2)} · w {f.weight} · {(f.ms / 1000).toFixed(1)}s{f.agentRegistryId ? ` · #${f.agentRegistryId}` : ""}</div>
    </div>
  );
}
