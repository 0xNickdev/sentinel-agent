"use client";
import { useEffect, useState } from "react";
import { STREAM, getJSON, short } from "@/lib/api";
import { Cursor, Label, LogLine } from "./Log";

export interface Launch { mint: string; creator: string; name: string; symbol: string; signature: string; slot: number; at: number }
const MAX = 10;

/** `[12:03:41] launch  7Gx…  $SYM  name   [judge]` — pump.fun creates as they land, newest at the bottom like a tail -f. */
export function LaunchLog({ onJudge }: { onJudge: (mint: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Launch[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let alive = true; let es: EventSource | null = null;
    getJSON<{ enabled: boolean; launches: Launch[] }>(`/launches?limit=${MAX}`).then(r => {
      if (!alive) return;
      setEnabled(r.enabled); setRows([...r.launches].slice(0, MAX).reverse());
      if (!r.enabled) return;
      es = new EventSource(`${STREAM}/stream/launches`);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.addEventListener("launch", e => { const ev = JSON.parse((e as MessageEvent).data) as Launch; setRows(prev => (prev.some(p => p.mint === ev.mint) ? prev : [...prev, ev].slice(-MAX))); });
    }).catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; es?.close(); };
  }, []);
  if (!enabled) return null;
  return (
    <div>
      <Label>launches · pump.fun · geyser · {live ? "live" : "reconnecting"}</Label>
      {rows.length === 0 && <div className="text-fg-4">waiting for the next mint…</div>}
      {rows.map(r => (
        <LogLine key={r.mint} clock={r.at} source="launch">
          <span className="grid grid-cols-[11ch_10ch_1fr_auto] gap-x-3">
            <a className="act text-fg-3" href={`https://solscan.io/token/${r.mint}`} target="_blank" rel="noreferrer">{short(r.mint, 4)}</a>
            <span className="text-fg truncate">${(r.symbol || "?").slice(0, 9)}</span>
            <span className="text-fg-3 truncate">{r.name || "unnamed"}</span>
            <button type="button" className="act" onClick={() => onJudge(r.mint)}>[judge]</button>
          </span>
        </LogLine>
      ))}
      {live && <div className="log"><span className="t" /><span className="s" /><span className="x"><Cursor /></span></div>}
    </div>
  );
}
