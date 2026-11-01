"use client";
import { useEffect, useState } from "react";
import { ago, getJSON, type VerdictSummary } from "@/lib/api";

/** "Last verdict 14s ago", ticking. */
export function LiveTicker() {
  const [last, setLast] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => getJSON<VerdictSummary[]>("/verdicts?limit=1").then(v => { if (alive && v[0]) setLast(v[0].storedAt ?? v[0].at); }).catch(() => undefined);
    load();
    const a = setInterval(load, 15_000);
    const b = setInterval(() => tick(t => t + 1), 1000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);
  if (last == null) return null;
  return <span className="hidden lg:inline mono text-fg-3">last verdict <span className="display-num text-fg">{ago(last)}</span></span>;
}
