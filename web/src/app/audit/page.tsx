"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ago, ccdscanTx, getJSON, horizonLabel, short, type Band, type VerdictSummary } from "@/lib/api";
import { WORD } from "@/lib/verdict";
import { VerdictTile } from "@/components/VerdictTile";

const BANDS: Array<{ k: Band | "all"; label: string }> = [{ k: "all", label: "All" }, { k: "RUGGED", label: "Rugged" }, { k: "DANGER", label: "Danger" }, { k: "CAUTION", label: "Risky" }, { k: "SAFE", label: "Clean" }];

/** inspora-style: one filter row, Latest / Highest risk toggle, uniform tile grid or a list with the outcomes column. */
export default function AuditPage() {
  const [all, setAll] = useState<VerdictSummary[] | null>(null);
  const [band, setBand] = useState<Band | "all">("all");
  const [sort, setSort] = useState<"latest" | "risk">("latest");
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const [q, setQ] = useState("");
  useEffect(() => { getJSON<VerdictSummary[]>("/verdicts?limit=500").then(setAll).catch(() => setAll([])); }, []);
  const list = useMemo(() => {
    let l = all ?? [];
    if (band !== "all") l = l.filter(v => v.verdict === band);
    if (q.trim()) l = l.filter(v => v.mint.toLowerCase().includes(q.trim().toLowerCase()) || v.digest.startsWith(q.trim()));
    return [...l].sort((a, b) => (sort === "latest" ? (b.storedAt ?? b.at) - (a.storedAt ?? a.at) : b.riskScore - a.riskScore));
  }, [all, band, sort, q]);
  const horizons = useMemo(() => Array.from(new Set((all ?? []).flatMap(v => (v.outcomes ?? []).map(o => o.horizon)))).sort((a, b) => a - b), [all]);
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="display text-red text-sm">AUDIT</div><h1 className="display text-[clamp(40px,7vw,96px)]">EVERY VERDICT</h1></div>
        <p className="text-fg-2 max-w-md">What Sentinel said, when, about what, and what happened next. Each record hashes to the digest appended on Concordium, carries a post-quantum signature, and is graded at fixed horizons after the call.</p>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-line-2 p-1">
          {BANDS.map(b => <button key={b.k} onClick={() => setBand(b.k)} className={`h-8 px-3 rounded-full text-sm ${band === b.k ? "bg-fg text-black" : "text-fg-2 hover:text-fg"}`}>{b.label}</button>)}
        </div>
        <div className="inline-flex rounded-full border border-line-2 p-1">
          {(["latest", "risk"] as const).map(s => <button key={s} onClick={() => setSort(s)} className={`h-8 px-3 rounded-full text-sm ${sort === s ? "bg-fg text-black" : "text-fg-2 hover:text-fg"}`}>{s === "latest" ? "Latest" : "Highest risk"}</button>)}
        </div>
        <div className="inline-flex rounded-full border border-line-2 p-1">
          {(["tiles", "list"] as const).map(s => <button key={s} onClick={() => setView(s)} className={`h-8 px-3 rounded-full text-sm ${view === s ? "bg-fg text-black" : "text-fg-2 hover:text-fg"}`}>{s === "tiles" ? "Tiles" : "List · outcomes"}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="mint or digest" className="h-10 px-4 rounded-full bg-bg-1 border border-line-2 mono text-sm outline-none focus:border-fg-3 w-full sm:w-72" />
        <span className="mono text-xs text-fg-4 ml-auto">{all ? `${list.length} of ${all.length}` : "loading"}</span>
      </div>

      {view === "tiles" ? (
        <motion.div layout className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AnimatePresence mode="popLayout">
            {list.map(v => <motion.div key={v.digest} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}><VerdictTile v={v} /></motion.div>)}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="mt-6 tt-wrap rounded-2xl border border-line-2 p-4">
          <table className="tt">
            <thead><tr><th>time</th><th>mint</th><th>verdict</th><th className="text-right">risk</th><th className="text-right">conf</th>{horizons.map(h => <th key={h}>{horizonLabel(h)}</th>)}<th>anchor</th><th>digest</th></tr></thead>
            <tbody>
              {list.map(v => (
                <tr key={v.digest} className="row">
                  <td className="text-fg-4" title={new Date((v.storedAt ?? v.at) * 1000).toISOString()}>{ago(v.storedAt ?? v.at)}</td>
                  <td><a className="text-fg-2 hover:text-fg" href={`https://solscan.io/token/${v.mint}`} target="_blank" rel="noreferrer">{short(v.mint, 6)}</a></td>
                  <td><Link href={`/audit/${v.digest}`} className={`display text-base band-${v.verdict}`}>{WORD[v.verdict]}</Link></td>
                  <td className={`text-right display-num text-base ${v.riskScore >= 65 ? "text-red" : "text-fg"}`}>{v.riskScore}</td>
                  <td className="text-right text-fg-3">{v.confidence.toFixed(2)}</td>
                  {horizons.map(h => {
                    const o = v.outcomes?.find(x => x.horizon === h);
                    if (!o) return <td key={h} className="text-fg-4">…</td>;
                    const hit = (v.riskScore >= 50) === o.rugged;
                    return <td key={h} className={o.rugged ? "text-red" : "text-fg"}>{o.rugged ? "RUGGED" : "alive"} <span className={hit ? "text-fg-4" : "text-red"}>{hit ? "✓" : "✗"}</span></td>;
                  })}
                  <td>{v.concordiumTx ? <a className="text-fg-2 hover:text-fg" href={ccdscanTx(v.concordiumTx)} target="_blank" rel="noreferrer">ccd {short(v.concordiumTx, 4)} ↗</a> : <span className="text-fg-4">pending</span>}</td>
                  <td><Link href={`/audit/${v.digest}`} className="text-fg-3 hover:text-fg">{short(v.digest, 8)}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {horizons.length > 0 && <div className="mt-3 mono text-[11px] text-fg-4">outcome per horizon after the call · ✓ the call matched (risk ≥ 50 means rug) · ✗ it did not · … not graded yet</div>}
        </div>
      )}
      {all && !all.length && <div className="mt-6 rounded-2xl border border-line p-10 text-center text-fg-3">No verdicts stored yet.</div>}
      {all && all.length > 0 && !list.length && <div className="mt-6 rounded-2xl border border-line p-10 text-center text-fg-3">No records match.</div>}
    </div>
  );
}
