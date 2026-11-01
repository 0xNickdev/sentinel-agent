"use client";
import { useEffect, useState } from "react";
import { getJSON, type VerdictSummary } from "@/lib/api";
import { VerdictTile } from "./VerdictTile";

export function RecentVerdicts({ limit = 8 }: { limit?: number }) {
  const [v, setV] = useState<VerdictSummary[] | null>(null);
  useEffect(() => { getJSON<VerdictSummary[]>(`/verdicts?limit=${limit}`).then(setV).catch(() => setV([])); }, [limit]);
  if (v === null) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-40 rounded-2xl border border-line bg-bg-1" />)}</div>;
  if (!v.length) return <div className="rounded-2xl border border-line p-8 text-center text-fg-3">No verdicts yet. <a href="/#check" className="text-fg underline">Check a token</a> to make the first one.</div>;
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{v.map(x => <VerdictTile key={x.digest} v={x} />)}</div>;
}
