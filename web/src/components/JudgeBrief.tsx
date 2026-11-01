import type { Verdict } from "@/lib/api";
import { WORD } from "@/lib/verdict";

const WEIGHT: Record<string, string> = { decisive: "text-red", supporting: "text-fg", discounted: "text-fg-3", ignored: "text-fg-4" };

/** The judge's brief: headline, decisive fact, action, the three reasons, what is clean, what would change it, the scorecard, advocate vs rebuttal. */
export function JudgeBrief({ v, compact = false }: { v: Verdict; compact?: boolean }) {
  const rug = v.verdict === "DANGER" || v.verdict === "RUGGED";
  const structured = Boolean(v.headline || v.decisive || v.action);
  return (
    <div className="space-y-6">
      {structured && (
        <div className={`rounded-2xl border p-5 ${rug ? "border-red" : "border-line-2"} bg-black/60`}>
          {v.headline && <div className="display text-xl md:text-2xl">{v.headline}</div>}
          {v.decisive && <div className="mt-2 text-fg-2"><span className="mono text-xs text-red mr-2">DECISIVE</span>{v.decisive}</div>}
          {v.action && <div className="mt-3 flex items-start gap-2"><span className="text-red text-lg leading-6">→</span><span className="text-fg font-medium">{v.action}</span></div>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mono text-xs text-red mb-2">WHY</div>
          <ol className="space-y-2">{v.topReasons.map((r, i) => <li key={i} className="flex gap-3"><span className="display-num text-red w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span><span className="text-fg">{r}</span></li>)}</ol>
        </div>
        <div className="space-y-4">
          {v.cleanSignals.length > 0 && <div><div className="mono text-xs text-fg-3 mb-2">WHAT IS FINE</div><ul className="space-y-1 text-sm text-fg-2">{v.cleanSignals.map((c, i) => <li key={i} className="flex gap-2"><span className="text-fg-4">·</span>{c}</li>)}</ul></div>}
          {v.whatWouldChange.length > 0 && <div><div className="mono text-xs text-fg-3 mb-2">WOULD CHANGE THE VERDICT</div><ul className="space-y-1 text-sm text-fg-2">{v.whatWouldChange.map((c, i) => <li key={i} className="flex gap-2"><span className="text-fg-4">·</span>{c}</li>)}</ul></div>}
        </div>
      </div>

      {(!compact || !structured) && v.reasoning && (
        <div className="text-fg-2 leading-7 space-y-3">{v.reasoning.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>
      )}

      {v.scorecard.length > 0 && (
        <div className="rounded-2xl border border-line-2 overflow-hidden">
          <div className="px-4 h-9 flex items-center mono text-xs text-fg-3 border-b border-line">SCORECARD · how much each agent counted</div>
          <div className="divide-y divide-line">
            {v.scorecard.map(s => {
              const f = v.findings.find(x => x.agent === s.agent);
              return (
                <div key={s.agent} className="grid grid-cols-[110px_44px_90px] sm:grid-cols-[110px_44px_90px_1fr] md:grid-cols-[160px_56px_110px_1fr] gap-2 px-4 py-2 items-baseline mono text-xs">
                  <span className="text-fg">{f?.agentName ?? s.agent}</span>
                  <span className={`display-num ${f && f.riskScore >= 65 ? "text-red" : "text-fg"}`}>{f?.riskScore ?? "—"}</span>
                  <span className={WEIGHT[s.weight]}>{s.weight}</span>
                  <span className="text-fg-2 font-sans text-sm col-span-3 sm:col-span-1">{s.why}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(v.advocate || v.rebuttal || v.dissent) && (
        <div className="grid gap-3 md:grid-cols-2">
          {v.advocate && (
            <div className="rounded-2xl border border-line-2 p-4">
              <div className="mono text-xs text-fg-3 mb-2">ADVOCATE · the case for <span className="text-fg">{WORD[v.advocate.arguesFor]}</span></div>
              <p className="text-sm text-fg">{v.advocate.thesis}</p>
              <ul className="mt-2 space-y-1 text-sm text-fg-2">{v.advocate.points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-fg-4">·</span>{p}</li>)}</ul>
              <p className="mt-2 mono text-[11px] text-fg-4">weakest link: {v.advocate.weakestLink} · {v.advocate.model} · {(v.advocate.ms / 1000).toFixed(1)}s</p>
            </div>
          )}
          {(v.rebuttal || v.dissent) && (
            <div className="rounded-2xl border border-red/60 p-4">
              {v.rebuttal && <><div className="mono text-xs text-red mb-2">JUDGE'S REBUTTAL</div><p className="text-sm text-fg-2">{v.rebuttal}</p></>}
              {v.dissent && <><div className={`mono text-xs text-red ${v.rebuttal ? "mt-3" : ""} mb-2`}>DISSENT</div><p className="text-sm text-fg-2">{v.dissent}</p></>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
