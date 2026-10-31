"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ago, getJSON, short, type Band, type VerdictSummary } from "@/lib/api";
import { Label } from "./Log";
import { WORD } from "./Report";

const BAND: Record<string, Band> = { rugged: "RUGGED", rug: "RUGGED", danger: "DANGER", risky: "CAUTION", caution: "CAUTION", clean: "SAFE", safe: "SAFE" };
const FILTERS = ["all", "rugged", "danger", "risky", "clean", "anchored", "pending"] as const;

/** `ls -l` of every run, latest first. Re-runs are separate rows: that is correct, each is its own record. */
export function AuditTable() {
  const router = useRouter();
  const params = useSearchParams();
  const f = (params.get("f") ?? "all").toLowerCase();
  const [all, setAll] = useState<VerdictSummary[] | null>(null);
  const [sort, setSort] = useState<"latest" | "risk">("latest");
  const [, tick] = useState(0);
  useEffect(() => { getJSON<VerdictSummary[]>("/verdicts?limit=500").then(setAll).catch(() => setAll([])); const t = setInterval(() => tick(n => n + 1), 10_000); return () => clearInterval(t); }, []);
  const list = useMemo(() => {
    let l = all ?? [];
    if (BAND[f]) l = l.filter(v => v.verdict === BAND[f]);
    else if (f === "anchored") l = l.filter(v => v.concordiumTx);
    else if (f === "pending") l = l.filter(v => !v.concordiumTx);
    else if (f !== "all") l = l.filter(v => v.mint.toLowerCase().includes(f) || v.digest.startsWith(f));
    return [...l].sort((a, b) => (sort === "latest" ? (b.storedAt ?? b.at) - (a.storedAt ?? a.at) : b.riskScore - a.riskScore));
  }, [all, f, sort]);
  const set = (k: string) => router.replace(k === "all" ? "/audit" : `/audit?f=${encodeURIComponent(k)}`);
  return (
    <div>
      <Label>audit · every verdict · {all ? `${list.length} of ${all.length}` : "loading"}</Label>
      <div className="text-fg-3 flex flex-wrap gap-x-2 mb-2">
        <span className="text-fg-4">filter</span>
        {FILTERS.map(k => <button key={k} type="button" className={`act ${f === k ? "on" : ""}`} onClick={() => set(k)}>[{k}]</button>)}
        {!FILTERS.includes(f as typeof FILTERS[number]) && !BAND[f] && <span className="text-fg">[{f}]</span>}
        <span className="text-fg-4 ml-3">sort</span>
        {(["latest", "risk"] as const).map(s => <button key={s} type="button" className={`act ${sort === s ? "on" : ""}`} onClick={() => setSort(s)}>[{s}]</button>)}
        <span className="text-fg-4 ml-auto hidden sm:inline">type `audit rugged` or `audit &lt;mint&gt;` in the prompt</span>
      </div>
      <div className="tt-wrap"><table className="tt">
        <thead><tr><th>time</th><th>mint</th><th className="text-right">risk</th><th>verdict</th><th className="text-right">conf</th><th>anchor</th><th>digest</th></tr></thead>
        <tbody>
          {all && list.length === 0 && <tr><td colSpan={7} className="text-fg-4">{all.length ? "no rows match" : "no verdicts stored yet · paste a mint in the prompt to make the first one"}</td></tr>}
          {list.map(v => (
            <tr key={v.digest} className="row cursor-pointer" onClick={() => router.push(`/audit/${v.digest}`)}>
              <td className="text-fg-4" title={new Date((v.storedAt ?? v.at) * 1000).toISOString()}>{new Date((v.storedAt ?? v.at) * 1000).toISOString().slice(5, 16).replace("T", " ")} <span className="text-fg-4">{ago(v.storedAt ?? v.at)}</span></td>
              <td className="text-fg-2">{short(v.mint, 6)}</td>
              <td className={`text-right ${v.riskScore >= 65 ? "text-red" : "text-fg"}`}>{v.riskScore}</td>
              <td className={v.verdict === "SAFE" ? "text-fg" : "text-red"}>{WORD[v.verdict]}</td>
              <td className="text-right text-fg-3">{v.confidence.toFixed(2)}</td>
              <td className={v.concordiumTx ? "text-fg-2" : "text-fg-4"}>{v.concordiumTx ? `ccd ${short(v.concordiumTx, 4)}` : "pending"}</td>
              <td className="text-fg-3"><a className="act" href={`/audit/${v.digest}`} onClick={e => e.stopPropagation()}>{short(v.digest, 8)}</a></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
