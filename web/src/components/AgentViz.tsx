"use client";
import { useEffect, useId, useState } from "react";
import { usd, type Verdict } from "@/lib/api";

// Small, honest charts per specialist, drawn from the same evidence the agent read.
// Bars use an ordered-dither (4x4 Bayer) fill, after the 21st.dev "Chart Bar Halftone":
// ink density repeats the value, which suits the dot-matrix type.

type E = Verdict["evidence"];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2));

function useEntered() {
  const [on, set] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => set(true)); return () => cancelAnimationFrame(id); }, []);
  return on;
}

/** Horizontal bar of segments; each segment is a dithered plate whose density follows `ink` (0..1). */
function Bar({ parts, total = 100 }: { parts: Array<{ v: number; color: string; ink?: number; title: string }>; total?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const on = useEntered();
  let x = 0;
  return (
    <svg viewBox="0 0 200 10" preserveAspectRatio="none" className="w-full h-2.5 block" aria-hidden="true">
      <defs>
        {parts.map((p, i) => (
          <pattern key={i} id={`${uid}-${i}`} width="4" height="4" patternUnits="userSpaceOnUse">
            {BAYER.map((b, k) => (b < Math.round((p.ink ?? 1) * 16) ? <rect key={k} x={(k % 4)} y={Math.floor(k / 4)} width="1" height="1" fill={p.color} /> : null))}
          </pattern>
        ))}
      </defs>
      <rect width="200" height="10" fill="var(--bg-2)" />
      {parts.map((p, i) => {
        const w = Math.max(0, (p.v / total) * 200);
        const r = <rect key={i} x={x} y="0" width={on ? w : 0} height="10" fill={`url(#${uid}-${i})`} style={{ transition: `width .6s var(--ease-out-expo) ${i * 80}ms` }}><title>{p.title}</title></rect>;
        x += w;
        return r;
      })}
    </svg>
  );
}

function Row({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return <div className="flex justify-between mono text-[10px] text-fg-3"><span>{k}</span><span className={hot ? "text-red" : "text-fg-2"}>{v}</span></div>;
}

/** 20-dot risk meter: one dot per 5 points, red from 65. */
export function RiskDots({ score, confidence }: { score: number; confidence: number }) {
  const on = useEntered();
  const hot = score >= 65;
  const n = Math.round(score / 5);
  return (
    <div className="flex items-center gap-[3px]" title={`risk ${score}/100 · confidence ${confidence.toFixed(2)}`} aria-label={`risk ${score} of 100`}>
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-[1px]" style={{ background: i < n ? (hot ? "var(--red)" : i >= 13 ? "var(--red-hi)" : "var(--fg)") : "var(--line-2)", opacity: i < n ? (on ? 0.35 + confidence * 0.65 : 0) : 1, transition: `opacity .3s ${i * 25}ms` }} />
      ))}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className={`rounded-md border px-1.5 py-1 mono text-[10px] leading-none flex items-center gap-1 ${ok === false ? "border-red/60 text-red" : ok === null ? "border-line-2 text-fg-4" : "border-line-2 text-fg-2"}`}>
      <span>{ok === false ? "✕" : ok === null ? "?" : "✓"}</span>{label}
    </div>
  );
}

export function AgentViz({ agent, e }: { agent: string; e: E }) {
  switch (agent) {
    case "holders": {
      const top = e.holders.top ?? [];
      const creator = top.filter(h => h.isCreator).reduce((s, h) => s + h.pct, 0);
      const sniper = top.filter(h => h.isSniper && !h.isCreator).reduce((s, h) => s + h.pct, 0);
      const other = Math.max(0, e.holders.top10Pct - creator - sniper);
      const prog = e.holders.programHeldPct ?? 0;
      return (
        <div className="space-y-1.5">
          <Bar parts={[{ v: creator, color: "var(--red)", title: `creator ${fmt(creator)}%` }, { v: sniper, color: "var(--red)", ink: 0.5, title: `snipers ${fmt(sniper)}%` }, { v: other, color: "var(--fg)", ink: 0.85, title: `other top holders ${fmt(other)}%` }, { v: prog, color: "var(--fg-3)", ink: 0.4, title: `programs ${fmt(prog)}%` }]} />
          {top.length > 1 && <div className="flex items-end gap-[2px] h-6">{top.slice(0, 20).map(h => <span key={h.owner} className="flex-1 rounded-t-[1px]" title={`${fmt(h.pct)}%`} style={{ height: `${Math.max(6, (h.pct / Math.max(...top.map(t => t.pct))) * 100)}%`, background: h.isCreator || h.isSniper ? "var(--red)" : "var(--fg-3)" }} />)}</div>}
          <div className="flex flex-wrap gap-x-2 mono text-[9px] text-fg-4">{creator > 0 && <span><i className="inline-block h-1.5 w-1.5 mr-1 bg-red" />creator</span>}{sniper > 0 && <span><i className="inline-block h-1.5 w-1.5 mr-1 bg-red-lo" />snipers</span>}<span><i className="inline-block h-1.5 w-1.5 mr-1 bg-fg" />top holders</span>{prog > 0 && <span><i className="inline-block h-1.5 w-1.5 mr-1 bg-fg-3" />programs</span>}</div>
          <Row k={`top-10 ${fmt(e.holders.top10Pct)}%`} v={`programs ${fmt(prog)}% · ${e.holders.count} holders`} hot={e.holders.top10Pct > 40} />
        </div>
      );
    }
    case "snipers":
      return (
        <div className="space-y-1.5">
          <Bar parts={[{ v: e.snipers.boughtPct, color: "var(--red)", ink: 0.55, title: `snipers bought ${fmt(e.snipers.boughtPct)}%` }]} />
          <Bar parts={[{ v: e.snipers.holdingPct, color: "var(--red)", title: `snipers still hold ${fmt(e.snipers.holdingPct)}%` }, { v: e.bundles.boughtPct, color: "var(--fg)", ink: 0.6, title: `bundled ${fmt(e.bundles.boughtPct)}%` }]} />
          <Row k={`bought ${fmt(e.snipers.boughtPct)}% · hold ${fmt(e.snipers.holdingPct)}%`} v={`${e.snipers.wallets.length} snipers · ${e.bundles.groups} bundles`} hot={e.snipers.holdingPct > 10} />
        </div>
      );
    case "funding": {
      const checked = Math.max(e.linked.checked, 0);
      const linked = new Set(e.linked.clusters.flatMap(c => c.wallets)).size;
      const viaCreator = new Set(e.linked.clusters.filter(c => c.viaCreator).flatMap(c => c.wallets));
      const cells = Math.min(40, Math.max(checked, linked));
      return (
        <div className="space-y-1.5">
          {cells > 0
            ? <div className="flex flex-wrap gap-[3px]">{Array.from({ length: cells }, (_, i) => <span key={i} className="h-2 w-2 rounded-full" style={{ background: i < viaCreator.size ? "var(--red)" : i < linked ? "var(--red-hi)" : "var(--line-2)", opacity: i < linked ? 1 : 0.9 }} />)}</div>
            : <div className="mono text-[10px] text-fg-4">no wallets traced</div>}
          <Row k={`${linked} of ${checked} traced share a funder`} v={`${e.linked.clusters.length} cluster${e.linked.clusters.length === 1 ? "" : "s"} · ${fmt(e.linked.linkedPct)}%`} hot={e.linked.linkedToCreatorPct > 0} />
        </div>
      );
    }
    case "creator": {
      const c = e.creator;
      const bought = c?.boughtTokens ?? 0, sold = c?.soldTokens ?? 0;
      return (
        <div className="space-y-1.5">
          <Bar total={Math.max(1, bought)} parts={[{ v: Math.min(sold, bought), color: "var(--red)", title: `sold ${Math.round(sold).toLocaleString()}` }, { v: Math.max(0, bought - sold), color: "var(--fg)", ink: 0.7, title: `still holding ${Math.round(bought - sold).toLocaleString()}` }]} />
          <Row k={`${(c?.status ?? "unknown").replace(/_/g, " ")}${c?.proof ? " · verified human" : ""}`} v={`holds ${fmt(c?.holdingPct ?? 0)}% · sold ${bought ? Math.round((sold / bought) * 100) : 0}%`} hot={(c?.status ?? "").startsWith("sold")} />
        </div>
      );
    }
    case "contract": {
      const k = e.contract;
      if (!k) return null;
      return (
        <div className="flex flex-wrap gap-1">
          <Check ok={k.mintRevoked} label="mint" /><Check ok={k.freezeRevoked} label="freeze" /><Check ok={k.transferFeeBps === 0} label={k.transferFeeBps ? `fee ${k.transferFeeBps / 100}%` : "no fee"} />
          <Check ok={!k.permanentDelegate} label="delegate" /><Check ok={!k.transferHook} label="hook" /><Check ok={k.metadataMutable === null ? null : !k.metadataMutable} label="metadata" />
          {e.liquidity && <Check ok={e.liquidity.kind === "bonding_curve" || (e.liquidity.lockedPct ?? 0) >= 90} label={e.liquidity.kind === "bonding_curve" ? "curve" : `LP ${fmt(e.liquidity.lockedPct ?? 0)}% locked`} />}
        </div>
      );
    }
    case "market": {
      const m = e.market;
      if (!m) return <div className="mono text-[10px] text-fg-4">no market data yet</div>;
      const ratio = m.fdvUsd ? (m.liquidityUsd / m.fdvUsd) * 100 : 0;
      return (
        <div className="space-y-1.5">
          <Bar total={Math.max(50, ratio)} parts={[{ v: ratio, color: ratio < 2 ? "var(--red)" : "var(--fg)", ink: 0.8, title: `liquidity is ${fmt(ratio)}% of FDV` }]} />
          <Row k={`liquidity ${usd(m.liquidityUsd)} · ${fmt(ratio)}% of fdv`} v={`vol ${usd(m.volume24hUsd)}`} hot={ratio < 2} />
        </div>
      );
    }
    case "flows": {
      const f = e.flows;
      if (!f) return <div className="mono text-[10px] text-fg-4">trace did not run</div>;
      const total = Math.max(1, f.toExchangeSol + f.toFunderSol + f.recycledSol);
      return (
        <div className="space-y-1.5">
          <Bar total={total} parts={[{ v: f.toExchangeSol, color: "var(--red)", title: `${f.toExchangeSol} SOL to exchanges` }, { v: f.toFunderSol, color: "var(--red)", ink: 0.5, title: `${f.toFunderSol} SOL back to funders` }, { v: f.recycledSol, color: "var(--fg-3)", ink: 0.6, title: `${f.recycledSol} SOL recycled` }]} />
          <Row k={`${fmt(f.toExchangeSol)} SOL → exchanges`} v={`${f.traced} traced · ${f.trails.length} trails`} hot={f.toExchangeSol > 0} />
        </div>
      );
    }
    default: return null;
  }
}
