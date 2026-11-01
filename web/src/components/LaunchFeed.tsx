"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { STREAM, ago, getJSON, short } from "@/lib/api";
import { Header } from "./Header";

export interface Launch { mint: string; creator: string; name: string; symbol: string; signature: string; slot: number; at: number }

const MAX = 8;

/** LIVE LAUNCHES: pump.fun creates as they land, newest on top, each one a click away from a verdict. List over /sentinel, stream straight from the API origin. */
export function LaunchFeed() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Launch[]>([]);
  const [live, setLive] = useState(false);
  const [, tick] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    getJSON<{ enabled: boolean; launches: Launch[] }>(`/launches?limit=${MAX}`).then(r => {
      if (!alive) return;
      setEnabled(r.enabled);
      setRows(r.launches.slice(0, MAX));
      if (!r.enabled) return;
      es = new EventSource(`${STREAM}/stream/launches`);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.addEventListener("launch", e => {
        const ev = JSON.parse((e as MessageEvent).data) as Launch;
        setRows(prev => (prev.some(p => p.mint === ev.mint) ? prev : [ev, ...prev].slice(0, MAX)));
      });
    }).catch(() => { if (alive) setEnabled(false); });
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => { alive = false; es?.close(); clearInterval(t); };
  }, []);

  if (!enabled) return null;
  const judge = (m: string) => { router.push(`/?mint=${m}&n=${Date.now()}#check`); };
  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <Header kicker="00" title="LIVE LAUNCHES" copy="pump.fun creates as they land on Solana, newest first. Hit Judge and the swarm reads a token that is seconds old." right={<span className="mono text-fg-3 inline-flex items-center gap-2"><span className={`dot ${live ? "animate-pulse" : "opacity-30"}`} /> {live ? "pump.fun · geyser" : "reconnecting"}</span>} />
      <ul className="mono text-sm divide-y divide-line border-y border-line">
        {rows.length === 0 && <li className="py-3 text-fg-3">waiting for the next mint…</li>}
        {rows.map(r => (
          <li key={r.mint} className="grid grid-cols-[minmax(56px,auto)_1fr_auto_auto] sm:grid-cols-[minmax(72px,auto)_1fr_auto_auto_auto_auto] items-center gap-x-4 py-2.5 launch-row">
            <span className="text-fg truncate">${(r.symbol || "?").slice(0, 10)}</span>
            <span className="text-fg-3 truncate">{r.name || "unnamed"}</span>
            <a className="text-fg-4 hover:text-fg hidden sm:inline" href={`https://solscan.io/token/${r.mint}`} target="_blank" rel="noreferrer">{short(r.mint, 4)}</a>
            <span className="text-fg-4 hidden sm:inline">by {short(r.creator, 4)}</span>
            <span className="display-num text-fg-2 tabular-nums">{ago(r.at)}</span>
            <button type="button" className="pill pill-ghost h-8 text-xs" onClick={() => judge(r.mint)}>Judge</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
