"use client";
import { useEffect, useState } from "react";
import { getJSON, type AgentsResponse, type VerdictSummary } from "@/lib/api";

/** One status line from the live store: tokens judged · rugs called · on Concordium · agents verified. */
export function StatLine() {
  const [v, setV] = useState<VerdictSummary[] | null>(null);
  const [a, setA] = useState<AgentsResponse | null>(null);
  useEffect(() => {
    getJSON<VerdictSummary[]>("/verdicts?limit=200").then(setV).catch(() => setV([]));
    getJSON<AgentsResponse>("/api/agents").then(setA).catch(() => undefined);
  }, []);
  const latest = v ? v.filter((x, i, arr) => arr.findIndex(y => y.mint === x.mint) === i) : null;
  const rugs = latest?.filter(x => x.verdict === "DANGER" || x.verdict === "RUGGED").length ?? 0;
  const anchored = v?.filter(x => x.concordiumTx).length ?? 0;
  const n = (x: number | undefined | null) => (v ? String(x ?? 0) : "…");
  const verified = a ? `${a.agents.filter(x => x.badge).length}/${a.agents.length}` : "…";
  return (
    <div className="pt-3 text-fg-3 flex flex-wrap gap-x-2">
      <span>tokens judged <span className="text-fg">{n(latest?.length)}</span></span><span className="text-fg-4">·</span>
      <span>rugs called <span className="text-red">{n(rugs)}</span></span><span className="text-fg-4">·</span>
      <span>on Concordium <span className="text-fg">{n(anchored)}</span></span><span className="text-fg-4">·</span>
      <span>agents verified <span className="text-fg">{verified}</span>{a && !a.agents.some(x => x.badge) ? <span className="text-fg-4"> (registration pending)</span> : null}</span>
      {a && <><span className="text-fg-4">·</span><span>{a.network}</span></>}
    </div>
  );
}
