import { ccdscanTx, horizonLabel, short, type Outcome } from "@/lib/api";

/** Per-horizon grades: what the token did after the call, ✓/✗ against the call (risk ≥ 50 means "rug"), each anchored on Concordium. */
export function OutcomeChips({ outcomes, riskScore, size = "md" }: { outcomes: Array<Pick<Outcome, "horizon" | "rugged"> & Partial<Outcome>>; riskScore: number; size?: "sm" | "md" }) {
  if (!outcomes.length) return null;
  const h = size === "sm" ? "h-6 text-[10px]" : "h-7 text-[11px]";
  return (
    <div className={`flex flex-wrap gap-1.5 mono ${size === "sm" ? "text-[10px]" : "text-xs"}`}>
      {[...outcomes].sort((a, b) => a.horizon - b.horizon).map(o => {
        const hit = (riskScore >= 50) === o.rugged;
        return (
          <span key={o.horizon} title={o.labels?.join(", ") || (o.rugged ? "rugged" : "alive")} className={`pill ${h} ${o.rugged ? "pill-red" : "pill-ghost"}`}>
            {horizonLabel(o.horizon)} · {o.rugged ? "RUGGED" : "alive"} <span className={hit ? (o.rugged ? "text-black/60" : "text-fg-3") : "text-red"}>{hit ? "✓" : "✗"}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The full outcome table for a record: horizon, result, liquidity and price change, labels, grade anchor. */
export function OutcomeTable({ outcomes, riskScore }: { outcomes: Outcome[]; riskScore: number }) {
  if (!outcomes.length) return <div className="rounded-2xl border border-line p-6 text-sm text-fg-3">Not graded yet. The first horizon is one hour after the verdict; grades are written next to the record on Concordium and never edited.</div>;
  return (
    <div className="tt-wrap rounded-2xl border border-line-2 p-4">
      <table className="tt">
        <thead><tr><th>horizon</th><th>outcome</th><th>call</th><th className="text-right">liquidity</th><th className="text-right">price</th><th>labels</th><th>graded</th><th>grade anchor</th></tr></thead>
        <tbody>
          {[...outcomes].sort((a, b) => a.horizon - b.horizon).map(o => {
            const hit = (riskScore >= 50) === o.rugged;
            return (
              <tr key={o.horizon}>
                <td className="display-num text-base">{horizonLabel(o.horizon)}</td>
                <td className={o.rugged ? "text-red" : "text-fg"}>{o.rugged ? "RUGGED" : "alive"}</td>
                <td className={hit ? "text-fg-3" : "text-red"}>{hit ? "✓ correct" : "✗ missed"}</td>
                <td className="text-right text-fg-2">{o.liquidityBps == null ? "—" : `${(o.liquidityBps / 100).toFixed(0)}%`}</td>
                <td className="text-right text-fg-2">{o.priceBps == null ? "—" : `${(o.priceBps / 100).toFixed(0)}%`}</td>
                <td className="text-fg-3">{o.labels.length ? o.labels.join(", ") : "—"}</td>
                <td className="text-fg-4">{new Date(o.at * 1000).toISOString().slice(0, 16).replace("T", " ")}Z</td>
                <td>{o.concordiumTx ? <a className="text-fg hover:text-red" href={ccdscanTx(o.concordiumTx)} target="_blank" rel="noreferrer">{short(o.concordiumTx, 6)} ↗</a> : <span className="text-fg-4">local</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
