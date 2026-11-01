"use client";
import { useEffect, useRef, useState } from "react";

export interface Line { t: number; type: string; agent?: string; text: string }

const PROMPT: Record<string, string> = { judge: "judge   ", advocate: "advocate", holders: "holders ", snipers: "snipers ", funding: "funding ", creator: "creator ", contract: "contract", market: "market  ", flows: "flows   " };
const RED = new Set(["veto", "verdict", "advocate"]);

/**
 * The swarm transcript as a terminal: `[ss.s] agent › text`, one line per
 * event. Replay types the lines back at compressed real timing (10×), so a
 * 20-second run plays in two seconds; the chip shows the real clock.
 */
export function Transcript({ lines, title = "sentinel › swarm transcript", autoplay = false }: { lines: Line[]; title?: string; autoplay?: boolean }) {
  const [shown, setShown] = useState(autoplay ? 0 : lines.length);
  const [playing, setPlaying] = useState(autoplay);
  const box = useRef<HTMLDivElement>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!playing) return;
    if (reduced) { setShown(lines.length); setPlaying(false); return; }
    if (shown >= lines.length) { setPlaying(false); return; }
    const prev = shown > 0 ? lines[shown - 1]!.t : 0;
    const wait = Math.min(900, Math.max(40, (lines[shown]!.t - prev) / 10));
    const id = setTimeout(() => setShown(s => s + 1), wait);
    return () => clearTimeout(id);
  }, [playing, shown, lines, reduced]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [shown]);

  const replay = () => { setShown(0); setPlaying(true); };
  const total = lines.length ? lines[lines.length - 1]!.t : 0;
  return (
    <div className="rounded-2xl border border-line-2 bg-black overflow-hidden">
      <div className="flex items-center justify-between px-4 h-10 border-b border-line mono text-xs text-fg-3">
        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red" />{title}</span>
        <span className="flex items-center gap-3"><span>{(total / 1000).toFixed(1)}s real time</span><button onClick={replay} className="pill h-7 text-xs">{playing ? "replaying…" : "Replay"}</button></span>
      </div>
      <div ref={box} className="p-4 mono text-[12px] leading-5 max-h-[28rem] overflow-y-auto">
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className="grid grid-cols-[52px_84px_1fr] gap-2">
            <span className="text-fg-4 tabular-nums">[{(l.t / 1000).toFixed(1).padStart(4, "0")}]</span>
            <span className={RED.has(l.type) || l.type === "debate_start" ? "text-red" : "text-fg-3"}>{(l.agent && PROMPT[l.agent]) ?? (l.type === "swarm_start" ? "swarm   " : l.type === "consensus" ? "consensus" : l.type === "debate_start" ? "debate  " : "        ")} ›</span>
            <span className={l.type === "verdict" ? "text-fg font-semibold" : l.type === "veto" ? "text-red" : "text-fg-2"}>{l.text}</span>
          </div>
        ))}
        {playing && <span className="inline-block w-2 h-4 bg-red align-middle animate-pulse" />}
      </div>
    </div>
  );
}
