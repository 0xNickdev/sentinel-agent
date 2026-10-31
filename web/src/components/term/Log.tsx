import type { ReactNode } from "react";

/** `[05.3] market › text` — one event per line. `t` is ms since start; `clock` formats as HH:MM:SS instead. */
export function LogLine({ t, clock, source, red, dim, children }: { t?: number; clock?: number; source: string; red?: boolean; dim?: boolean; children: ReactNode }) {
  const stamp = clock != null ? hms(clock) : t != null ? `[${(t / 1000).toFixed(1).padStart(4, "0")}]` : "";
  return (
    <div className="log appear">
      <span className="t">{stamp}</span>
      <span className={`s ${red ? "text-red" : ""}`}>{source.slice(0, 9)} ›</span>
      <span className={`x ${red ? "text-red" : dim ? "text-fg-4" : ""}`}>{children}</span>
    </div>
  );
}

export const hms = (unix: number) => { const d = new Date(unix * 1000); return `[${[d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":")}]`; };

export function Cursor({ red }: { red?: boolean }) { return <span className={`cursor ${red ? "cursor-red" : ""}`} aria-hidden="true" />; }

/** Uppercase label with an ASCII rule filling the rest of the line. */
export function Label({ children, red }: { children: ReactNode; red?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 mt-5 mb-1">
      <span className={`label whitespace-nowrap ${red ? "text-red" : ""}`}>{children}</span>
      <span className="rule flex-1">{"─".repeat(200)}</span>
    </div>
  );
}

export function Rule() { return <div className="rule my-2">{"─".repeat(300)}</div>; }

/** A `key   value` row inside a text block. */
export function KV({ k, children }: { k: string; children: ReactNode }) {
  return <div className="grid grid-cols-[14ch_1fr] gap-x-2"><span className="text-fg-4">{k}</span><span className="text-fg-2 break-all">{children}</span></div>;
}
