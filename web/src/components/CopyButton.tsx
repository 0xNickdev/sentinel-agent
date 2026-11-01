"use client";
import { useState } from "react";

/** Pill morphs to "Copied" and back. `text` may be a thunk so URLs resolve at click time (no SSR mismatch). */
export function CopyButton({ text, label = "Copy" }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(typeof text === "function" ? text() : text); setDone(true); setTimeout(() => setDone(false), 1200); }} className={`pill h-7 text-xs transition-all ${done ? "pill-red" : ""}`}>
      {done ? "Copied" : label}
    </button>
  );
}
