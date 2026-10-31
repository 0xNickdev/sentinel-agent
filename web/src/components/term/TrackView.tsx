"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AGENTS, ago, ccdscanTx, getJSON, horizonLabel, short, type TrackReport, type TrackSummary } from "@/lib/api";
import { Label, Rule } from "./Log";
import { WORD } from "./Report";

const f2 = (x: number | null | undefined, d = 3) => (x == null ? "—" : x.toFixed(d));
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const name = (id: string) => AGENTS.find(a => a.id === id)?.name ?? id;

/** The reliability diagram as a terminal bar chart: forecast bucket → observed rug rate, bar width = observed, count at the end. */
function Reliability({ s }: { s: TrackSummary }) {
  const bins = s.reliability.filter(b => b.n > 0);
  if (!bins.length) return <div className="text-fg-4">no graded calls yet</div>;
  return (
    <div className="text-fg-3">
      {bins.map(b => {
        const obs = b.observed ?? 0;
        const width = Math.round(obs * 30);
        const gap = b.meanForecast == null ? null : Math.round((obs - b.meanForecast) * 100);
        return (
          <div key={b.lo} className="flex gap-2 whitespace-pre">
            <span className="text-fg-4">{`${String(Math.round(b.lo * 100)).padStart(3)}–${String(Math.round(b.hi * 100)).padStart(3)}%`}</span>
            <span><span className={gap != null && Math.abs(gap) > 20 ? "text-red" : "text-fg"}>{"█".repeat(width)}</span><span className="text-fg-4">{"░".repeat(30 - width)}</span></span>
            <span>{pct(b.observed)} rugged</span>
            <span className="text-fg-4">n={b.n}{gap != null ? ` · ${gap > 0 ? "+" : ""}${gap}pt vs forecast` : ""}</span>
          </div>
        );
      })}
      <div className="text-fg-4 mt-1">a calibrated judge fills each row to about the forecast it names; red rows are 20+ points off</div>
    </div>
  );
}

function Summary({ s }: { s: TrackSummary }) {
  return (
    <div className="text-fg-3 flex flex-wrap gap-x-3">
      <span>graded <span className="text-fg">{s.n}</span></span>
      <span>brier <span className={s.brier != null && s.baseBrier != null && s.baseBrier > 0 && s.brier > s.baseBrier ? "text-red" : "text-fg"}>{f2(s.brier)}</span> <span className="text-fg-4">(0 perfect, {f2(s.baseBrier)} = always the base rate)</span></span>
      <span>skill <span className={s.skill != null && s.skill < 0 ? "text-red" : "text-fg"}>{s.skill == null ? "—" : `${s.skill > 0 ? "+" : ""}${Math.round(s.skill * 100)}%`}</span> <span className="text-fg-4">vs base rate {pct(s.baseRate)}</span></span>
      <span>log <span className="text-fg">{f2(s.logScore)}</span></span>
      <span className="text-fg-4">at 50%: precision {pct(s.confusion.precision)} · recall {pct(s.confusion.recall)} · mcc {f2(s.confusion.mcc, 2)}</span>
    </div>
  );
}

/** `track`: every sealed verdict scored against what happened. */
export function TrackView() {
  const router = useRouter();
  const [r, setR] = useState<TrackReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const load = () => getJSON<TrackReport>("/track").then(setR).catch(e => setErr(String(e)));
    load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, []);
  if (err) return <div className="pt-5 text-red">track: {err}</div>;
  if (!r) return <div className="pt-5 text-fg-4">loading…</div>;
  const horizons = r.horizons;
  const sel = horizons.find(x => x.horizon === h) ?? horizons.find(x => x.graded > 0) ?? horizons[0]!;
  return (
    <div>
      <Label>track · every verdict sealed on Concordium before the outcome, graded after it</Label>
      <div className="text-fg-3 mb-2">
        <span className="text-fg">{r.verdicts}</span> verdicts · <span className="text-fg">{r.graded}</span> graded · <span className="text-fg-4">{r.pending} waiting for their first horizon</span>
        <span className="text-fg-4"> · riskScore/100 is the forecast P(rug) · rug = liquidity down &gt;99% (TVL rug), no trades left (idle), the labels of arXiv:2608.20271, or a pool under 1% of its market cap (drained)</span>
      </div>
      <div className="text-fg-3 flex flex-wrap gap-x-2 mb-2">
        <span className="text-fg-4">horizon</span>
        {horizons.map(x => <button key={x.horizon} type="button" className={`act ${x.horizon === sel.horizon ? "on" : ""}`} onClick={() => setH(x.horizon)}>[{x.label} · {x.graded}]</button>)}
      </div>

      <Label>judge · {sel.label}</Label>
      <Summary s={sel.judge} />
      <Rule />
      <Label>reliability · forecast bucket → what actually rugged · {sel.label}</Label>
      <Reliability s={sel.judge} />
      <Rule />

      <Label>specialists · {sel.label} · best Brier first</Label>
      {sel.agents.length === 0 ? <div className="text-fg-4">no graded calls yet</div> : (
        <div className="tt-wrap"><table className="tt">
          <thead><tr><th>agent</th><th className="text-right">graded</th><th className="text-right">brier</th><th className="text-right">skill</th><th className="text-right">precision</th><th className="text-right">recall</th></tr></thead>
          <tbody>{sel.agents.map(a => (
            <tr key={a.agent} className="row">
              <td className="text-fg-2">{name(a.agent)}</td>
              <td className="text-right text-fg-3">{a.summary.n}</td>
              <td className={`text-right ${a.summary.brier != null && sel.judge.brier != null && a.summary.brier < sel.judge.brier ? "text-fg" : "text-fg-3"}`}>{f2(a.summary.brier)}</td>
              <td className={`text-right ${a.summary.skill != null && a.summary.skill < 0 ? "text-red" : "text-fg-3"}`}>{a.summary.skill == null ? "—" : `${a.summary.skill > 0 ? "+" : ""}${Math.round(a.summary.skill * 100)}%`}</td>
              <td className="text-right text-fg-3">{pct(a.summary.confusion.precision)}</td>
              <td className="text-right text-fg-3">{pct(a.summary.confusion.recall)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Rule />

      <Label>graded verdicts · latest first</Label>
      <div className="tt-wrap"><table className="tt">
        <thead><tr><th>called</th><th>mint</th><th className="text-right">p(rug)</th><th>verdict</th>{horizons.map(x => <th key={x.horizon}>{x.label}</th>)}<th>grade anchor</th></tr></thead>
        <tbody>
          {r.recent.length === 0 && <tr><td colSpan={5 + horizons.length} className="text-fg-4">nothing graded yet · the first horizon is one hour after a verdict</td></tr>}
          {r.recent.map(v => (
            <tr key={v.digest} className="row cursor-pointer" onClick={() => router.push(`/audit/${v.digest}`)}>
              <td className="text-fg-4">{ago(v.at)}</td>
              <td className="text-fg-2">{short(v.mint, 6)}</td>
              <td className={`text-right ${v.riskScore >= 65 ? "text-red" : "text-fg"}`}>{(v.riskScore / 100).toFixed(2)}</td>
              <td className={v.verdict === "SAFE" ? "text-fg" : "text-red"}>{WORD[v.verdict]}</td>
              {horizons.map(x => {
                const o = v.outcomes.find(y => y.horizon === x.horizon);
                if (!o) return <td key={x.horizon} className="text-fg-4">…</td>;
                const hit = (v.riskScore >= 50) === o.rugged;
                return <td key={x.horizon} title={o.labels.join(", ") || "alive"} className={o.rugged ? "text-red" : "text-fg"}>{o.rugged ? "RUGGED" : "alive"} <span className={hit ? "text-fg-4" : "text-red"}>{hit ? "✓" : "✗"}</span>{o.liquidityBps != null ? <span className="text-fg-4"> {Math.round(o.liquidityBps / 100)}% liq</span> : null}</td>;
              })}
              <td className="text-fg-3">{(() => { const tx = [...v.outcomes].reverse().find(o => o.concordiumTx)?.concordiumTx; return tx ? <a className="act" href={ccdscanTx(tx)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>ccd {short(tx, 4)}</a> : <span className="text-fg-4">local</span>; })()}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="text-fg-4 mt-2">grades are written to the audit contract beside the verdict they grade (`grade` entrypoint, one per horizon, never edited) · MCP tool `sentinel_track` returns this report · {horizonLabel(3600)} grades need the market to have been read at verdict time</div>
    </div>
  );
}
