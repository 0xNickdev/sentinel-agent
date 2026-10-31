"use client";
import { useState } from "react";

/** `[copy]` → `[copied]` for 1.2 s. `text` may be a thunk so URLs resolve at click time (no SSR mismatch). */
export function CopyButton({ text, label = "copy" }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(typeof text === "function" ? text() : text); setDone(true); setTimeout(() => setDone(false), 1200); }} className={`act ${done ? "text-red" : ""}`}>
      [{done ? "copied" : label}]
    </button>
  );
}
