"use client";
import { useMemo, useState } from "react";
import { short, type Verdict } from "@/lib/api";

// Who is connected to whom around one token, drawn from the verdict's own evidence:
// holders sized by their share, the creator, snipers, the wallets that funded holder
// clusters, exchanges that funded holders, and where the proceeds went. Laid out by a
// small force simulation run once (deterministic, no animation loop), adapted from the
// 21st.dev "Note Graph": size carries weight, hover isolates a neighbourhood.

type Kind = "token" | "curve" | "creator" | "holder" | "sniper" | "funder" | "exchange" | "sink";
interface N { id: string; kind: Kind; label: string; pct?: number; r: number; addr?: string; note: string; hot?: boolean }
interface L { a: string; b: string; kind: "hold" | "fund" | "exfund" | "flow" | "curve"; w: number; hot?: boolean; label?: string }

const W = 820, H = 480;
const SOLSCAN = (a: string) => `https://solscan.io/account/${a}`;

function build(v: Verdict): { nodes: N[]; links: L[] } {
  const e = v.evidence;
  const nodes = new Map<string, N>();
  const links: L[] = [];
  const add = (n: N) => { const prev = nodes.get(n.id); if (!prev || rank(n.kind) > rank(prev.kind)) nodes.set(n.id, { ...prev, ...n }); return n.id; };
  const sym = e.market?.symbol ? `$${e.market.symbol}` : short(v.mint, 4);
  add({ id: "token", kind: "token", label: sym, r: 20, addr: v.mint, note: "the token", hot: v.riskScore >= 65 });

  const prog = e.holders.programHeldPct ?? 0;
  if (prog > 0) {
    const kind = e.liquidity?.kind === "bonding_curve" ? "bonding curve" : "pools & programs";
    add({ id: "curve", kind: "curve", label: `${kind} ${fmt(prog)}%`, pct: prog, r: rad(prog) + 2, note: `${fmt(prog)}% of supply held by programs (curve, pools, lockers)` });
    links.push({ a: "curve", b: "token", kind: "curve", w: prog });
  }
  const creator = e.creator?.address ?? null;
  const snipers = new Set(e.snipers.wallets);
  for (const h of (e.holders.top ?? []).slice(0, 24)) {
    const isCreator = h.isCreator || h.owner === creator;
    const isSniper = h.isSniper || snipers.has(h.owner);
    add({ id: h.owner, kind: isCreator ? "creator" : isSniper ? "sniper" : "holder", label: isCreator ? `creator ${fmt(h.pct)}%` : `${fmt(h.pct)}%`, pct: h.pct, r: rad(h.pct), addr: h.owner, note: `${isCreator ? "creator · " : isSniper ? "sniper · " : ""}holds ${fmt(h.pct)}%`, hot: isCreator || isSniper });
    links.push({ a: h.owner, b: "token", kind: "hold", w: h.pct, hot: isSniper });
  }
  if (creator && !nodes.has(creator)) {
    const st = e.creator?.status ?? "unknown";
    add({ id: creator, kind: "creator", label: `creator · ${st.replace(/_/g, " ")}`, r: 7, addr: creator, note: `creator, ${st.replace(/_/g, " ")}`, hot: st.startsWith("sold") });
    links.push({ a: creator, b: "token", kind: "hold", w: 0.3, hot: st.startsWith("sold") });
  }
  for (const w of e.snipers.wallets.slice(0, 16)) {
    if (nodes.has(w)) continue;
    add({ id: w, kind: "sniper", label: "", r: 4, addr: w, note: "sniper, sold or below the top holders", hot: true });
    links.push({ a: w, b: "token", kind: "hold", w: 0.2, hot: true });
  }
  e.linked.clusters.slice(0, 10).forEach((c, i) => {
    const fid = c.funder === creator ? creator! : add({ id: c.funder, kind: "funder", label: `funder ${i + 1} · ${fmt(c.pct)}%`, r: 6 + Math.min(8, c.wallets.length), addr: c.funder, note: `funded ${c.wallets.length} holders, together ${fmt(c.pct)}%${c.viaCreator ? ", traced back to the creator" : ""}`, hot: c.viaCreator });
    if (c.viaCreator && creator && fid !== creator) { if (!nodes.has(creator)) add({ id: creator, kind: "creator", label: "creator", r: 7, addr: creator, note: "creator", hot: true }); links.push({ a: creator, b: fid, kind: "fund", w: 1, hot: true }); }
    for (const w of c.wallets.slice(0, 14)) {
      if (!nodes.has(w)) add({ id: w, kind: snipers.has(w) ? "sniper" : "holder", label: "", r: 3.5, addr: w, note: "funded by the same wallet" });
      links.push({ a: fid, b: w, kind: "fund", w: 1, hot: c.viaCreator });
    }
  });
  for (const x of (e.linked.exchangeFunded ?? []).slice(0, 12)) {
    const id = `ex:${x.exchange}`;
    add({ id, kind: "exchange", label: x.exchange, r: 8, note: `${x.exchange}: funded holders straight from the exchange (normal for retail)` });
    if (!nodes.has(x.wallet)) add({ id: x.wallet, kind: "holder", label: "", r: 3.5, addr: x.wallet, note: `funded from ${x.exchange}` });
    links.push({ a: id, b: x.wallet, kind: "exfund", w: 1 });
  }
  for (const t of (e.flows?.trails ?? []).slice(0, 10)) {
    if (!nodes.has(t.from)) add({ id: t.from, kind: t.from === creator ? "creator" : "holder", label: t.from === creator ? "creator" : "", r: 4, addr: t.from, note: "seller" });
    let prev = t.from;
    t.hops.slice(0, 3).forEach((h, j) => {
      const last = j === Math.min(t.hops.length, 3) - 1;
      const id = h.kind === "exchange" && h.label ? `ex:${h.label}` : h.to;
      add({ id, kind: h.kind === "exchange" ? "exchange" : h.kind === "funder" ? "funder" : "sink", label: h.label ?? (last ? `${h.kind}` : ""), r: h.kind === "exchange" ? 8 : 4.5, addr: h.kind === "exchange" && h.label ? undefined : h.to, note: `${h.kind}${h.label ? ` · ${h.label}` : ""}`, hot: h.kind === "exchange" });
      links.push({ a: prev, b: id, kind: "flow", w: t.totalSol, hot: h.kind === "exchange", label: j === 0 ? `${fmt(t.totalSol)} SOL` : undefined });
      prev = id;
    });
  }
  return { nodes: [...nodes.values()], links };
}

const rank = (k: Kind) => ["sink", "holder", "funder", "exchange", "sniper", "curve", "creator", "token"].indexOf(k);
const rad = (pct: number) => Math.min(24, 3.5 + Math.sqrt(Math.max(0, pct)) * 3.2);
const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2));

/** Radial layout: the token in the middle, holders on the first ring (wallets with a shared funder side by side),
 *  funders, exchanges and money sinks on outer rings facing the wallets they touch, programs on their own spoke. */
function layout(nodes: N[], links: L[]): Map<string, { x: number; y: number }> {
  const cx = W / 2, cy = H / 2, sx = 1.55;
  const at = (ang: number, r: number) => ({ x: cx + Math.cos(ang) * r * sx, y: cy + Math.sin(ang) * r });
  const pos = new Map<string, { x: number; y: number }>();
  const kind = new Map(nodes.map(n => [n.id, n.kind]));
  pos.set("token", { x: cx, y: cy });
  const hasCurve = kind.has("curve");
  if (hasCurve) pos.set("curve", at(0, 165));
  // Inner ring: everything that links straight to the token, grouped by who funded it.
  const funderOf = new Map<string, string>();
  for (const l of links) if (l.kind === "fund" || l.kind === "exfund") if (kind.get(l.a) !== "creator" || kind.get(l.b) !== "funder") funderOf.set(l.b, l.a);
  const inner = nodes.filter(n => n.id !== "token" && n.id !== "curve" && links.some(l => l.kind === "hold" && l.a === n.id) && !(n.kind === "creator" && [...funderOf.values()].includes(n.id)))
    .sort((p, q) => (funderOf.get(p.id) ?? "~").localeCompare(funderOf.get(q.id) ?? "~") || (q.pct ?? 0) - (p.pct ?? 0));
  // wallets funded but not holding (sold out) sit on the inner ring too, next to their cluster
  for (const n of nodes) if (funderOf.has(n.id) && !inner.includes(n) && n.kind !== "funder" && n.kind !== "creator" && n.kind !== "exchange") inner.push(n);
  inner.sort((p, q) => (funderOf.get(p.id) ?? "~").localeCompare(funderOf.get(q.id) ?? "~"));
  const gap = hasCurve ? 0.9 : 0; // leave the right side to the curve spoke
  const span = Math.PI * 2 - gap;
  inner.forEach((n, i) => pos.set(n.id, at(gap / 2 + (span * (i + 0.5)) / Math.max(1, inner.length), inner.length > 14 ? 140 : 125)));
  // Outer ring: funders/creator/exchanges at the mean angle of what they touch; flow hops walk outward.
  const angle = (id: string) => { const q = pos.get(id)!; return Math.atan2(q.y - cy, (q.x - cx) / sx); };
  const outer = nodes.filter(n => !pos.has(n.id));
  const fanned = new Map<string, number>();
  for (let pass = 0; pass < 4; pass++) for (const n of outer) {
    if (pos.has(n.id)) continue;
    const touch = links.filter(l => l.a === n.id || l.b === n.id).map(l => (l.a === n.id ? l.b : l.a)).filter(id => pos.has(id) && id !== "token");
    if (!touch.length) continue;
    const vx = touch.reduce((s, id) => s + Math.cos(angle(id)), 0), vy = touch.reduce((s, id) => s + Math.sin(angle(id)), 0);
    const depth = Math.max(...touch.map(id => Math.hypot((pos.get(id)!.x - cx) / sx, pos.get(id)!.y - cy)));
    const base = Math.atan2(vy, vx);
    if (depth + 70 <= 200) pos.set(n.id, at(base, depth + 70));
    else { const k = (fanned.get(touch[0]!) ?? 0) + 1; fanned.set(touch[0]!, k); pos.set(n.id, at(base + (k % 2 ? 1 : -1) * 0.34 * Math.ceil(k / 2), 205)); }
  }
  for (const n of nodes) if (!pos.has(n.id)) pos.set(n.id, at(Math.PI, 200));
  // Nudge overlaps apart a few times, keep inside the frame.
  const list = nodes.map(n => ({ n, q: pos.get(n.id)! }));
  for (let it = 0; it < 60; it++) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i]!, B = list[j]!; if (A.n.id === "token" || B.n.id === "token") continue;
    const dx = B.q.x - A.q.x, dy = B.q.y - A.q.y, d = Math.hypot(dx, dy) || 0.1, min = A.n.r + B.n.r + 22;
    if (d < min) { const k = (min - d) / 2 / d; A.q.x -= dx * k; A.q.y -= dy * k; B.q.x += dx * k; B.q.y += dy * k; }
  }
  for (const { n, q } of list) { const m = n.r + 16; q.x = Math.max(m, Math.min(W - m, q.x)); q.y = Math.max(m, Math.min(H - m - 12, q.y)); }
  return pos;
}

const FILL: Record<Kind, string> = { token: "var(--bg)", curve: "url(#cg-dither)", creator: "var(--red)", holder: "var(--fg-2)", sniper: "var(--bg)", funder: "var(--bg)", exchange: "var(--fg)", sink: "var(--fg-4)" };
const STROKE: Partial<Record<Kind, string>> = { token: "var(--fg)", sniper: "var(--red)", funder: "var(--fg-2)", curve: "var(--fg-4)" };

export function ConnectionGraph({ v }: { v: Verdict }) {
  const { nodes, links } = useMemo(() => build(v), [v]);
  const pos = useMemo(() => layout(nodes, links), [nodes, links]);
  const [hover, setHover] = useState<string | null>(null);
  const nb = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) { (m.get(l.a) ?? m.set(l.a, new Set()).get(l.a)!).add(l.b); (m.get(l.b) ?? m.set(l.b, new Set()).get(l.b)!).add(l.a); }
    return m;
  }, [links]);
  const lit = (id: string) => !hover || hover === id || nb.get(hover)?.has(id) === true;
  const h = hover ? nodes.find(n => n.id === hover) : null;
  const e = v.evidence;
  const kinds = new Set(nodes.map(n => n.kind));
  const thin = nodes.length <= 4;

  return (
    <div className="rounded-2xl border border-line-2 bg-black/60 overflow-hidden">
      <style>{`@keyframes cg-dash{to{stroke-dashoffset:-24}}@keyframes cg-in{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}.cg-flow{animation:cg-dash 1.2s linear infinite}.cg-node{transform-box:fill-box;transform-origin:center;animation:cg-in .5s var(--ease-out-expo) both}@media (prefers-reduced-motion:reduce){.cg-flow,.cg-node{animation:none}}`}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <div className="display text-xs">CONNECTIONS</div>
        <div className="mono text-[11px] text-fg-3">{[pl((e.holders.top ?? []).length, "top holder"), `${pl(e.linked.clusters.length, "funding cluster")} of ${e.linked.checked} traced`, pl(e.snipers.wallets.length, "sniper"), pl(e.flows?.trails.length ?? 0, "money trail")].join(" · ")}</div>
      </div>
      <div className="relative">
        <svg viewBox={thin ? `0 ${H / 2 - 100} ${W} 230` : `0 0 ${W} ${H}`} className="w-full h-auto block touch-none" role="img" aria-label="Wallet connection graph" onPointerLeave={() => setHover(null)}>
          <defs>
            <pattern id="cg-dither" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="var(--fg-3)" /><rect x="2" y="2" width="2" height="2" fill="var(--fg-3)" /></pattern>
            <radialGradient id="cg-glow"><stop offset="0" stopColor="var(--red)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--red)" stopOpacity="0" /></radialGradient>
          </defs>
          {v.riskScore >= 65 && <circle cx={W / 2} cy={H / 2} r={140} fill="url(#cg-glow)" />}
          <g>
            {links.map((l, i) => {
              const A = pos.get(l.a), B = pos.get(l.b); if (!A || !B) return null;
              const on = lit(l.a) && lit(l.b);
              const stroke = l.hot ? "var(--red)" : l.kind === "flow" ? "var(--fg-2)" : l.kind === "curve" ? "var(--fg-4)" : "var(--line-2)";
              const sw = l.kind === "hold" ? Math.min(5, 0.8 + Math.sqrt(l.w) * 0.9) : l.kind === "flow" ? Math.min(4, 1 + Math.log10(1 + l.w)) : 1;
              return (
                <g key={i} opacity={on ? 1 : 0.08}>
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={stroke} strokeWidth={hover && on ? sw + 0.6 : sw} strokeDasharray={l.kind === "flow" || l.kind === "exfund" ? "6 6" : undefined} className={l.kind === "flow" ? "cg-flow" : undefined} strokeLinecap="round" />
                  {l.label && <text x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 4} textAnchor="middle" className="mono" style={{ fontSize: 10, fill: l.hot ? "var(--red)" : "var(--fg-3)" }}>{l.label}</text>}
                </g>
              );
            })}
          </g>
          <g>
            {nodes.map((n, i) => {
              const q = pos.get(n.id); if (!q) return null;
              const square = n.kind === "exchange" || n.kind === "funder";
              const showLabel = n.label && (n.kind !== "holder" || (n.pct ?? 0) >= 2 || hover === n.id);
              return (
                <g key={n.id} transform={`translate(${q.x} ${q.y})`} opacity={lit(n.id) ? 1 : 0.15} style={{ cursor: n.addr ? "pointer" : "default", transition: "opacity .2s" }}
                  onPointerEnter={() => setHover(n.id)} onClick={() => n.addr && window.open(n.kind === "token" ? `https://solscan.io/token/${n.addr}` : SOLSCAN(n.addr), "_blank", "noopener")}>
                  <g className="cg-node" style={{ animationDelay: `${Math.min(i, 30) * 18}ms` }}>
                    {n.kind === "token" && <circle r={n.r + 7} fill="none" stroke={n.hot ? "var(--red)" : "var(--fg-4)"} strokeDasharray="2 4" />}
                    {square
                      ? <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={2} fill={n.hot && n.kind === "funder" ? "var(--red-lo)" : FILL[n.kind]} stroke={n.hot ? "var(--red)" : STROKE[n.kind] ?? "none"} strokeWidth={1.4} />
                      : <circle r={n.r} fill={FILL[n.kind]} stroke={STROKE[n.kind] ?? "none"} strokeWidth={n.kind === "token" ? 2 : 1.5} />}
                    {n.kind === "token" && <text textAnchor="middle" dy="0.35em" className="display" style={{ fontSize: 10, fill: "var(--fg)" }}>{n.hot ? "!" : "●"}</text>}
                  </g>
                  {showLabel && <text y={n.r + (n.kind === "token" ? 22 : 13)} textAnchor="middle" className="mono pointer-events-none" style={{ fontSize: n.kind === "token" ? 12 : 10, fill: n.hot ? "var(--red)" : n.kind === "token" ? "var(--fg)" : "var(--fg-3)" }}>{n.label}</text>}
                </g>
              );
            })}
          </g>
        </svg>
        {h && (
          <div className="pointer-events-none absolute left-3 top-2 rounded-lg border border-line-2 bg-black/90 px-3 py-2 mono text-[11px]">
            <div className={h.hot ? "text-red" : "text-fg"}>{h.note}</div>
            {h.addr && <div className="text-fg-4">{short(h.addr, 6)} · click for Solscan</div>}
          </div>
        )}
        {thin && <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center mono text-[11px] text-fg-4">almost nothing to connect yet: {e.linked.checked === 0 ? "no funding traced" : "no shared funders"}, {e.snipers.wallets.length} snipers, {e.flows?.trails.length ?? 0} trails</div>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 mono text-[10px] text-fg-3">
        {([["token", "token"], ["creator", "creator"], ["holder", "holder (size = share)"], ["sniper", "sniper"], ["funder", "shared funder"], ["exchange", "exchange"], ["curve", "curve / pools"], ["sink", "money went here"]] as Array<[Kind, string]>).filter(([k]) => kinds.has(k)).map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="-5 -5 10 10">{k === "exchange" || k === "funder" ? <rect x={-4} y={-4} width={8} height={8} fill={FILL[k]} stroke={STROKE[k] ?? "none"} /> : <circle r={4} fill={k === "curve" ? "var(--fg-3)" : FILL[k]} stroke={STROKE[k] ?? "none"} strokeWidth={1.2} />}</svg>{t}
          </span>
        ))}
        {links.some(l => l.kind === "flow") && <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--red)" strokeDasharray="4 3" strokeWidth="1.5" /></svg>SOL to an exchange</span>}
      </div>
    </div>
  );
}
