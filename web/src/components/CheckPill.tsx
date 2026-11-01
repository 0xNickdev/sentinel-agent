"use client";
import { useState } from "react";
import { isMint } from "@/lib/api";

/** The one CTA: a white pill input with a red circular submit. Paste detection flashes a chain chip. */
export function CheckPill({ onSubmit, disabled, size = "lg", defaultValue = "" }: { onSubmit: (mint: string) => void; disabled?: boolean; size?: "lg" | "sm"; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [pasted, setPasted] = useState(false);
  const ok = isMint(value);
  const h = size === "lg" ? "h-14 md:h-16" : "h-11";
  return (
    <form
      onSubmit={e => { e.preventDefault(); if (ok && !disabled) onSubmit(value.trim()); }}
      className={`relative flex items-center ${h} rounded-full bg-white text-black pl-5 pr-1.5 w-full max-w-2xl mx-auto shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-shadow ${pasted ? "shadow-[0_0_0_2px_#ff2a2a]" : ""}`}
    >
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onPaste={() => { setPasted(true); setTimeout(() => setPasted(false), 360); }}
        placeholder="Paste a Solana token address"
        spellCheck={false}
        autoComplete="off"
        className={`flex-1 bg-transparent outline-none font-mono ${size === "lg" ? "text-base md:text-lg" : "text-sm"} placeholder:text-neutral-500`}
        aria-label="Token mint address"
      />
      {value && (
        <span className={`hidden sm:inline-flex items-center gap-1 mr-2 h-7 px-2 rounded-full text-xs ${ok ? "bg-black text-white" : "bg-neutral-200 text-neutral-600"}`}>
          {ok ? <><span className="dot" /> solana</> : "not a mint"}
        </span>
      )}
      <button
        type="submit"
        disabled={!ok || disabled}
        className={`${size === "lg" ? "h-11 w-11 md:h-13 md:w-13" : "h-8 w-8"} shrink-0 rounded-full grid place-items-center transition-transform active:scale-95 ${ok && !disabled ? "bg-red text-black" : "bg-neutral-200 text-neutral-400 cursor-not-allowed"}`}
        aria-label="Check token"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
    </form>
  );
}
