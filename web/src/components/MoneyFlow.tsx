import { short, type FlowsSummary } from "@/lib/api";

/** Where the proceeds went: each trail is one wallet's SOL walked hop by hop; trails ending at an exchange are red. */
export function MoneyFlow({ flows, creator, limit = 12 }: { flows: FlowsSummary; creator?: string | null; limit?: number }) {
  if (!flows.trails.length) return null;
  return (
    <div className="rounded-2xl border border-line-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="display text-xs">MONEY FLOW</div>
        <div className="mono text-[11px] text-fg-3">{flows.traced} traced · <span className="text-red">{flows.toExchangeSol} SOL</span> to exchanges · {flows.toFunderSol} SOL back to funders · {flows.recycledSol} SOL recycled</div>
      </div>
      <div className="divide-y divide-line">
        {flows.trails.slice(0, limit).map((t, i) => (
          <div key={`${t.from}-${i}`} className="mono text-xs py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={t.from === creator ? "text-red" : "text-fg"}>{t.from === creator ? "creator" : short(t.from, 4)}</span>
            <span className="display-num text-fg-2">{t.totalSol} SOL</span>
            {t.hops.map((h, j) => (
              <span key={j} className="inline-flex items-center gap-2">
                <span className="text-fg-4">→</span>
                <span className={`pill h-6 text-[10px] ${h.kind === "exchange" ? "pill-red" : "pill-ghost"}`}>{h.label ?? short(h.to, 4)}<span className={h.kind === "exchange" ? "text-black/60" : "text-fg-4"}> · {h.kind}</span></span>
              </span>
            ))}
          </div>
        ))}
        {flows.trails.length > limit && <div className="mono text-[11px] text-fg-4 pt-2">+{flows.trails.length - limit} more trails in the record JSON</div>}
      </div>
    </div>
  );
}
