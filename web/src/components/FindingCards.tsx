import type { Finding } from "@/lib/api";

/** One card per specialist: score (red at 65+), revised-from on debate, summary, notable lines, meta. */
export function FindingCards({ findings, notable = 0, cols = "sm:grid-cols-2 lg:grid-cols-3", glass = false }: { findings: Finding[]; notable?: number; cols?: string; glass?: boolean }) {
  if (!findings.length) return null;
  return (
    <div className={`grid gap-2 ${cols}`}>
      {findings.map(f => {
        const hot = f.riskScore >= 65;
        return (
          <div key={f.agent} className={`rounded-2xl border p-4 ${hot ? "border-red/70" : "border-line-2"} ${glass ? "bg-black/60" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="display text-xs">{f.agentName.toUpperCase()}</span>
              <span className={`display-num ${hot ? "text-red" : ""}`}>{f.riskScore}{f.revised ? <span className="text-fg-4 text-xs"> · was {f.revised.riskScore}</span> : null}<span className="text-fg-4 text-xs"> · {f.confidence.toFixed(2)}</span></span>
            </div>
            <p className="mt-2 text-sm text-fg-2 leading-6">{f.summary}</p>
            {notable > 0 && f.notable.length > 0 && <ul className="mt-2 mono text-[11px] text-fg-3 space-y-1">{f.notable.slice(0, notable).map((n, i) => <li key={i}>· {n}</li>)}</ul>}
            <div className="mt-2 mono text-[11px] text-fg-4">{f.label.replace(/_/g, " ")} · weight {f.weight} · {f.model} · {(f.ms / 1000).toFixed(1)}s{f.revised ? ` · revised from ${f.revised.riskScore}` : ""}{f.agentRegistryId ? ` · registry #${f.agentRegistryId}` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}
