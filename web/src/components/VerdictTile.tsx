import Link from "next/link";
import { ago, short, type VerdictSummary } from "@/lib/api";
import { WORD } from "@/lib/verdict";
import { OutcomeChips } from "./Outcomes";

export function VerdictTile({ v }: { v: VerdictSummary }) {
  return (
    <Link href={`/audit/${v.digest}`} className={`group block rounded-2xl border p-4 bg-bg-1 hover:bg-bg-2 transition-colors tile-${v.verdict}`}>
      <div className="flex items-center justify-between mono text-[11px] text-fg-3"><span>{short(v.mint, 5)}</span><span>{ago(v.storedAt ?? v.at)}</span></div>
      <div className={`display text-4xl mt-3 band-${v.verdict}`}>{WORD[v.verdict]}</div>
      <div className="mt-2 flex items-center justify-between display-num text-sm"><span>{v.riskScore}<span className="text-fg-4">/100</span></span><span className="text-fg-3">{v.confidence.toFixed(2)}</span></div>
      <div className="mt-3 flex items-center justify-between gap-2 mono text-[11px] text-fg-4">
        <span className="flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${v.concordiumTx ? "bg-red" : "bg-fg-4"}`} />{v.concordiumTx ? "on Concordium" : "anchor pending"}</span>
      </div>
      {v.outcomes && v.outcomes.length > 0 && <div className="mt-3"><OutcomeChips outcomes={v.outcomes} riskScore={v.riskScore} size="sm" /></div>}
    </Link>
  );
}
