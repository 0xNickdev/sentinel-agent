"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getJSON, type AgentsResponse, type TrackReport, type VerdictSummary } from "@/lib/api";

/** Counts as credibility: big dot-matrix numerals from the live verdict store and the track record. */
export function StatStrip() {
  const [v, setV] = useState<VerdictSummary[] | null>(null);
  const [a, setA] = useState<AgentsResponse | null>(null);
  const [t, setT] = useState<TrackReport | null>(null);
  useEffect(() => {
    getJSON<VerdictSummary[]>("/verdicts?limit=500").then(setV).catch(() => setV([]));
    getJSON<AgentsResponse>("/api/agents").then(setA).catch(() => undefined);
    getJSON<TrackReport>("/track").then(setT).catch(() => undefined);
  }, []);
  const latest = v ? v.filter((x, i, arr) => arr.findIndex(y => y.mint === x.mint) === i) : null;
  const rugs = latest?.filter(x => x.verdict === "DANGER" || x.verdict === "RUGGED").length ?? 0;
  const anchored = v?.filter(x => x.concordiumTx).length ?? 0;
  const h = t ? (t.horizons.find(x => x.horizon === 86400 && x.graded > 0) ?? t.horizons.find(x => x.horizon === 3600 && x.graded > 0) ?? t.horizons.find(x => x.graded > 0) ?? null) : null;
  const brier = h?.judge.brier;
  const skill = h?.judge.skill;
  const badged = a?.agents.filter(x => x.badge).length ?? 0;
  const items: Array<{ k: string; v: React.ReactNode; sub?: string; href?: string; red?: boolean }> = [
    { k: "tokens judged", v: latest?.length ?? 0, sub: v ? `${v.length} runs` : undefined },
    { k: "rugs called", v: rugs, sub: "danger + rugged", red: rugs > 0 },
    { k: "verdicts on Concordium", v: anchored, sub: "anchored records" },
    { k: `Brier · ${h?.label ?? "24h"}`, v: brier == null ? "—" : brier.toFixed(3), sub: h ? `${h.graded} graded · 0 is perfect` : "nothing graded yet", href: "/track", red: brier != null && h?.judge.baseBrier != null && h.judge.baseBrier > 0 && brier > h.judge.baseBrier },
    { k: "skill vs base rate", v: skill == null ? "—" : `${skill > 0 ? "+" : ""}${Math.round(skill * 100)}%`, sub: h?.judge.baseRate != null ? `base rate ${Math.round(h.judge.baseRate * 100)}%` : "needs rugs and non-rugs", href: "/track", red: skill != null && skill < 0 },
    { k: "agents verified", v: a ? <>{badged}<span className="text-fg-4">/{a.agents.length}</span></> : 9, sub: a ? (badged ? "Verified by Concordium" : `${a.network} · registration pending`) : undefined, href: "/agents" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-line rounded-2xl overflow-hidden border border-line">
      {items.map(i => {
        const body = (
          <>
            <div className={`display-num text-4xl md:text-5xl ${i.red ? "text-red" : ""}`}>{v ? i.v : <span className="shimmer">00</span>}</div>
            <div className="mt-2 text-sm text-fg-3">{i.k}</div>
            {i.sub && <div className="mt-1 mono text-[11px] text-fg-4">{i.sub}</div>}
          </>
        );
        return i.href ? <Link key={i.k} href={i.href} className="bg-black p-5 md:p-6 hover:bg-bg-1 transition-colors">{body}</Link> : <div key={i.k} className="bg-black p-5 md:p-6">{body}</div>;
      })}
    </div>
  );
}
