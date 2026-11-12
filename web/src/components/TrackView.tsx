"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENTS, ago, ccdscanTx, getJSON, horizonLabel, short, type GuaranteeReport, type LearnedWeight, type TrackReport, type TrackSummary } from "@/lib/api";
import { WORD } from "@/lib/verdict";

const f2 = (x: number | null | undefined, d = 3) => (x == null ? "—" : x.toFixed(d));
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const signed = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
const name = (id: string) => AGENTS.find(a => a.id === id)?.name ?? (id === "judge" ? "Judge" : id);

/** /track: every sealed verdict scored against what happened. Doto numbers, one red, hairline tables. */
export function TrackView() {
  const [r, setR] = useState<TrackReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [h, setH] = useState<number | null>(null);
  const [g, setG] = useState<GuaranteeReport | null>(null);
  useEffect(() => {
    const load = () => { getJSON<GuaranteeReport>("/guarantee").then(setG).catch(() => undefined); return getJSON<TrackReport>("/track").then(setR).catch(e => setErr(String(e))); };
    load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, []);
  const horizons = r?.horizons ?? [];
  const sel = horizons.find(x => x.horizon === h) ?? horizons.find(x => x.horizon === 86400 && x.graded > 0) ?? horizons.find(x => x.graded > 0) ?? horizons[0];
  const superseded = r?.superseded ?? [];
  const weights = r?.weights;
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="display text-red text-sm">TRACK RECORD</div><h1 className="display text-[clamp(40px,7vw,96px)]">WAS IT RIGHT?</h1></div>
        <p className="text-fg-2 max-w-md">Every verdict is sealed on Concordium before the outcome and graded after it. The forecast is the sealed <span className="mono text-fg">P(rug)</span>; a rug is liquidity down more than 99%, no trades left, the labels of arXiv:2608.20271, or a pool under 1% of market cap. On a bonding curve the liquidity is the SOL buyers put in, read from the curve price. A token with nothing at stake when it was judged is recorded and not scored.</p>
      </div>

      {err && <div className="mt-8 rounded-2xl border border-red p-6 mono text-sm text-red">track: {err}</div>}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-fg-4 mr-1">horizon</span>
        <div className="inline-flex rounded-full border border-line-2 p-1">
          {horizons.map(x => <button key={x.horizon} onClick={() => setH(x.horizon)} className={`h-8 px-3 rounded-full text-sm ${sel && x.horizon === sel.horizon ? "bg-fg text-black" : "text-fg-2 hover:text-fg"}`}>{x.label} <span className={sel && x.horizon === sel.horizon ? "text-black/50" : "text-fg-4"}>· {x.graded}</span></button>)}
          {!horizons.length && <span className="h-8 px-3 inline-flex items-center text-sm text-fg-4">{r ? "no horizons" : "loading"}</span>}
        </div>
        {r && <span className="mono text-xs text-fg-4 ml-auto">{r.graded} of {r.verdicts} verdicts graded · {r.pending} waiting</span>}
      </div>
      {r && (
        <div className="mt-3 mono text-[11px] text-fg-4 space-y-1">
          {(sel?.voided ?? 0) > 0 && <div>{sel!.voided} more {sel!.label} grades are void: the token had no buyers&apos; money left in it when it was judged, so there was no outcome to forecast</div>}
          <div>{r.calibration
            ? `P(rug) is the judge's score through a calibration fitted on ${r.calibration.n} graded ${horizonLabel(r.calibration.horizon)} outcomes (Platt scaling, a ${r.calibration.a.toFixed(2)}, b ${r.calibration.b.toFixed(2)}), sealed with each verdict${sel?.raw?.brier != null && sel.judge.brier != null ? ` · raw score on the same calls: Brier ${sel.raw.brier.toFixed(3)}` : ""}`
            : "P(rug) is the judge's score / 100 until 50 outcomes with at least 10 of each kind are graded at 24h; from then on the score is calibrated on the track before it is sealed"}</div>
          {superseded.length > 0 && <div>labelling rule {r.rule} is scored here · {superseded.reduce((n, x) => n + x.graded, 0)} grades made under rule{new Set(superseded.map(x => x.rule)).size > 1 ? "s" : ""} {[...new Set(superseded.map(x => x.rule))].sort().join(" and ")} stay on chain and in the table below but are not mixed into these scores</div>}
        </div>
      )}

      <div className="mt-6"><Tiles s={sel?.judge ?? null} graded={r?.graded ?? 0} verdicts={r?.verdicts ?? 0} pending={r?.pending ?? 0} loading={!r} /></div>

      <div className="mt-12 grid gap-8 lg:grid-cols-2 items-start [&>*]:min-w-0">
        <div>
          <div className="display text-sm text-red mb-4">RELIABILITY · JUDGE · {sel?.label ?? "—"}</div>
          <div className="rounded-2xl border border-line-2 p-4">{sel ? <Reliability s={sel.judge} /> : <div className="text-fg-4 mono text-xs">loading</div>}</div>
        </div>
        <div>
          <div className="display text-sm text-red mb-4">SPECIALISTS · {sel?.label ?? "—"} · BEST BRIER FIRST</div>
          <div className="rounded-2xl border border-line-2 p-4">
            {!sel || sel.agents.length === 0 ? <div className="mono text-xs text-fg-4">no graded calls yet</div> : (
              <div className="tt-wrap"><table className="tt">
                <thead><tr><th>agent</th><th className="text-right">graded</th><th className="text-right">brier</th><th className="text-right">skill</th><th className="text-right">precision</th><th className="text-right">recall</th><th className="text-right">weight</th></tr></thead>
                <tbody>{sel.agents.map(a => (
                  <tr key={a.agent} className="row">
                    <td className="text-fg">{name(a.agent)}</td>
                    <td className="text-right text-fg-3">{a.summary.n}</td>
                    <td className={`text-right display-num text-base ${a.summary.brier != null && sel.judge.brier != null && a.summary.brier < sel.judge.brier ? "text-fg" : "text-fg-3"}`}>{f2(a.summary.brier)}</td>
                    <td className={`text-right ${a.summary.skill != null && a.summary.skill < 0 ? "text-red" : "text-fg-3"}`}>{signed(a.summary.skill)}</td>
                    <td className="text-right text-fg-3">{pct(a.summary.confusion.precision)}</td>
                    <td className="text-right text-fg-3">{pct(a.summary.confusion.recall)}</td>
                    <td className="text-right"><Weight w={weights?.agents[a.agent]} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="mono text-[11px] text-fg-4 mt-3">a white Brier beats the judge at this horizon · weight is what the consensus rule gives the agent on the next verdict: {weights?.source.source === "track" ? `its prior moved by ${weights.source.graded} graded ${horizonLabel(weights.source.horizon ?? 86400)} outcomes (exponential weights on Brier loss, shrunk while the history is thin)` : "the prior, until 30 outcomes are graded at 24h"}</div>
          </div>
        </div>
      </div>

      {g?.book && Object.keys(g.book).length > 0 && <Book g={g} />}

      <div className="mt-12">
        <div className="flex items-baseline justify-between gap-4 mb-4"><div className="display text-sm text-red">GRADED VERDICTS · LATEST FIRST</div>{r && <span className="mono text-xs text-fg-4">{r.recent.length} rows</span>}</div>
        <div className="rounded-2xl border border-line-2 p-4 tt-wrap">
          <table className="tt">
            <thead><tr><th>called</th><th>mint</th><th>verdict</th><th className="text-right">p(rug)</th>{horizons.map(x => <th key={x.horizon}>{x.label}</th>)}<th>grade anchor</th><th>record</th></tr></thead>
            <tbody>
              {r && r.recent.length === 0 && <tr><td colSpan={6 + horizons.length} className="text-fg-4">nothing graded yet · the first horizon is one hour after a verdict</td></tr>}
              {(r?.recent ?? []).map(v => {
                const tx = [...v.outcomes].reverse().find(o => o.concordiumTx)?.concordiumTx;
                return (
                  <tr key={v.digest} className="row">
                    <td className="text-fg-4">{ago(v.at)}</td>
                    <td><a className="text-fg-2 hover:text-fg" href={`https://solscan.io/token/${v.mint}`} target="_blank" rel="noreferrer">{short(v.mint, 6)}</a></td>
                    <td><Link href={`/audit/${v.digest}`} className={`display text-base band-${v.verdict}`}>{WORD[v.verdict]}</Link></td>
                    <td className={`text-right display-num text-base ${v.riskScore >= 65 ? "text-red" : "text-fg"}`}>{(v.riskScore / 100).toFixed(2)}</td>
                    {horizons.map(x => {
                      const o = v.outcomes.find(y => y.horizon === x.horizon);
                      if (!o) return <td key={x.horizon} className="text-fg-4">…</td>;
                      if (o.void) return <td key={x.horizon} title="nothing at stake when judged: not scored" className="text-fg-4">void</td>;
                      const hit = (v.riskScore >= 50) === o.rugged;
                      return <td key={x.horizon} title={o.labels.join(", ") || "alive"} className={o.rugged ? "text-red" : "text-fg"}>{o.rugged ? "RUGGED" : "alive"} <span className={hit ? "text-fg-4" : "text-red"}>{hit ? "✓" : "✗"}</span>{o.liquidityBps != null ? <span className="text-fg-4"> {Math.round(o.liquidityBps / 100)}% liq</span> : null}</td>;
                    })}
                    <td>{tx ? <a className="text-fg-2 hover:text-fg" href={ccdscanTx(tx)} target="_blank" rel="noreferrer">ccd {short(tx, 4)} ↗</a> : <span className="text-fg-4">local</span>}</td>
                    <td><Link href={`/audit/${v.digest}`} className="text-fg-3 hover:text-fg">{short(v.digest, 6)}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mono text-[11px] text-fg-4 mt-3">grades are written to the audit contract beside the verdict they grade (<span className="text-fg-3">grade</span> entrypoint, one per horizon, never edited) · the MCP tool <span className="text-fg-3">sentinel_track</span> returns this report · 1h grades need the market to have been read at verdict time</div>
        </div>
      </div>
    </div>
  );
}

const UNIT: Record<string, number> = { CCD: 1e6, EUDemo: 1e6 };
const money = (raw: string, asset: string) => { const v = Number(raw) / (UNIT[asset] ?? 1e6); return `${v.toLocaleString("en", { maximumFractionDigits: 2 })} ${asset}`; };

/** What being wrong has cost: paid verdicts in, refunds out, per asset. The numbers come from /guarantee and every refund is a transfer on CCDScan. */
function Book({ g }: { g: GuaranteeReport }) {
  const rows = Object.entries(g.book ?? {});
  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
        <div className="display text-sm text-red">THE COST OF BEING WRONG</div>
        {g.pool && <a className="mono text-xs text-fg-3 hover:text-fg" href={g.pool.explorer} target="_blank" rel="noreferrer">refund pool {short(g.pool.account, 5)} ↗</a>}
      </div>
      <div className="rounded-2xl border border-line-2 p-4">
        <div className="tt-wrap"><table className="tt">
          <thead><tr><th>asset</th><th className="text-right">paid verdicts</th><th className="text-right">earned</th><th className="text-right">refunded</th><th className="text-right">net</th><th className="text-right">still at risk</th></tr></thead>
          <tbody>{rows.map(([asset, b]) => (
            <tr key={asset} className="row">
              <td className="text-fg">{asset}</td>
              <td className="text-right text-fg-3">{b.paid}</td>
              <td className="text-right display-num text-base">{money(b.revenue, asset)}</td>
              <td className={`text-right display-num text-base ${b.refunds > 0 ? "text-red" : "text-fg-3"}`}>{money(b.refunded, asset)}{b.refunds > 0 ? <span className="mono text-xs text-fg-4"> · {b.refunds}</span> : null}</td>
              <td className={`text-right display-num text-base ${Number(b.net) < 0 ? "text-red" : "text-fg"}`}>{money(b.net, asset)}</td>
              <td className="text-right text-fg-3">{money(b.atRisk, asset)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="mono text-[11px] text-fg-4 mt-3">{g.terms.statement} A verdict that is not SAFE carries no cover, and SAFE is not issued for a token nobody has traded or a bonding-curve launch under a day old. At risk is what the pool owes if every undecided SAFE rugs.</div>
      </div>
    </div>
  );
}

/** The agent's consensus weight, with the prior it started from when the track has moved it. */
function Weight({ w }: { w: LearnedWeight | undefined }) {
  if (!w) return <span className="text-fg-4">—</span>;
  const moved = w.trust > 0 && w.weight !== w.prior;
  return <span className="mono text-xs">{moved && <span className="text-fg-4">{w.prior.toFixed(2)} → </span>}<span className={moved ? (w.weight < w.prior ? "text-red" : "text-fg") : "text-fg-3"}>{w.weight.toFixed(2)}</span></span>;
}

function Tiles({ s, graded, verdicts, pending, loading }: { s: TrackSummary | null; graded: number; verdicts: number; pending: number; loading: boolean }) {
  const worse = s?.brier != null && s.baseBrier != null && s.baseBrier > 0 && s.brier > s.baseBrier;
  const items: Array<{ k: string; v: string; sub: string; red?: boolean }> = [
    { k: "Brier score", v: f2(s?.brier), sub: `0 is perfect · ${f2(s?.baseBrier)} = always the base rate`, red: worse },
    { k: "skill vs base rate", v: signed(s?.skill), sub: s?.skill == null ? "needs rugs and non-rugs" : "positive beats the base rate", red: s?.skill != null && s.skill < 0 },
    { k: "base rate", v: pct(s?.baseRate), sub: "share that rugged" },
    { k: "graded", v: String(s?.n ?? 0), sub: `${graded} of ${verdicts} verdicts · ${pending} waiting` },
    { k: "log score", v: f2(s?.logScore), sub: "lower is better" },
    { k: "at 50% · precision / recall", v: s ? `${pct(s.confusion.precision)} / ${pct(s.confusion.recall)}` : "—", sub: s ? `mcc ${f2(s.confusion.mcc, 2)} · tp ${s.confusion.tp} fp ${s.confusion.fp} tn ${s.confusion.tn} fn ${s.confusion.fn}` : "" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-line rounded-2xl overflow-hidden border border-line">
      {items.map(i => (
        <div key={i.k} className="bg-black p-5 md:p-6 min-w-0">
          <div className={`display-num text-3xl md:text-4xl truncate ${i.red ? "text-red" : ""}`}>{loading ? <span className="shimmer">00</span> : i.v}</div>
          <div className="mt-2 text-sm text-fg-3">{i.k}</div>
          <div className="mt-1 mono text-[11px] text-fg-4">{i.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Reliability diagram as inline SVG: one bar per forecast bucket (observed rug rate), the diagonal is perfect calibration; bars 20+ points off are red. */
function Reliability({ s }: { s: TrackSummary }) {
  const W = 560, H = 260, L = 36, B = 40, T = 14, R = 10;
  const pw = W - L - R, ph = H - T - B;
  const bins = s.reliability;
  const bw = pw / Math.max(1, bins.length);
  const any = bins.some(b => b.n > 0);
  const y = (v: number) => T + ph - v * ph;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="reliability diagram: forecast bucket against observed rug rate">
        {[0, 0.25, 0.5, 0.75, 1].map(g => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" /><text x={L - 8} y={y(g) + 3} fontSize="10" fill="var(--fg-4)" textAnchor="end" fontFamily="var(--font-mono)">{Math.round(g * 100)}</text></g>)}
        <line x1={L} y1={y(0)} x2={W - R} y2={y(1)} stroke="var(--fg-4)" strokeDasharray="3 3" />
        {bins.map((b, i) => {
          const x = L + i * bw;
          const obs = b.observed;
          const gap = obs != null && b.meanForecast != null ? Math.abs(obs - b.meanForecast) : 0;
          return (
            <g key={b.lo}>
              {obs != null && <rect x={x + 4} y={y(obs)} width={bw - 8} height={Math.max(2, y(0) - y(obs))} fill={gap > 0.2 ? "var(--red)" : "var(--fg)"} />}
              {b.meanForecast != null && <circle cx={x + bw / 2} cy={y(b.meanForecast)} r={3} fill="var(--bg)" stroke={gap > 0.2 ? "var(--red)" : "var(--fg-2)"} strokeWidth={1.5} />}
              {b.n > 0 && <text x={x + bw / 2} y={(obs != null ? y(obs) : y(0)) - 6} fontSize="10" fill="var(--fg-3)" textAnchor="middle" fontFamily="var(--font-mono)">n={b.n}</text>}
              <text x={x + bw / 2} y={H - B + 14} fontSize="10" fill="var(--fg-4)" textAnchor="middle" fontFamily="var(--font-mono)">{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}</text>
            </g>
          );
        })}
        <text x={L + pw / 2} y={H - 6} fontSize="10" fill="var(--fg-4)" textAnchor="middle" fontFamily="var(--font-mono)">forecast P(rug) bucket, %</text>
      </svg>
      {!any && <div className="mono text-xs text-fg-4 text-center -mt-2">no graded calls yet</div>}
      <div className="mono text-[11px] text-fg-4 mt-3">bar = observed rug rate · ring = mean forecast · dashed = perfect calibration · a calibrated judge fills each bucket to about the forecast it names; red bars are 20+ points off</div>
    </div>
  );
}
