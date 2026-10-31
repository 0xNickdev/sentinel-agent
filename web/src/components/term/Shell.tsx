"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isMint } from "@/lib/api";
import { LiveTicker } from "@/components/LiveTicker";

const NAV = [["/", "check"], ["/audit", "audit"], ["/track", "track"], ["/agents", "agents"], ["/docs", "docs"]] as const;

export const HELP = [
  "verdict <mint>   run the swarm on a Solana token (or just paste the mint)",
  "audit [filter]   every verdict · filter: rugged danger risky clean anchored pending <mint|digest>",
  "track            how the calls turned out: Brier, skill vs base rate, reliability, per agent",
  "agents           the agents, registry tokens and badges",
  "docs             MCP · A2A · x402 · audit · verify",
  "launches         live pump.fun launches (home)",
  "help             this text",
  "clear            clear the screen",
];

/** The persistent command line: `sentinel ›` + input + nav row. Commands navigate; help/unknown echo below the bar. */
export function Shell() {
  const router = useRouter();
  const path = usePathname();
  const [value, setValue] = useState("");
  const [echo, setEcho] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    const go = (href: string) => { setEcho([]); router.push(href); };
    const c = cmd!.toLowerCase();
    if (isMint(line)) return go(`/?mint=${line}&n=${Date.now()}`);
    if ((c === "verdict" || c === "check" || c === "judge") && isMint(arg)) return go(`/?mint=${arg.trim()}&n=${Date.now()}`);
    if (c === "verdict" || c === "check") return setEcho([`› ${line}`, "usage: verdict <mint>   (base58, 32–44 chars)"]);
    if (c === "audit") return go(arg ? `/audit?f=${encodeURIComponent(arg)}` : "/audit");
    if (c === "agents") return go("/agents");
    if (c === "track" || c === "record" || c === "score") return go("/track");
    if (c === "docs" || c === "man") return go(`/docs${arg ? `#${arg.toLowerCase()}` : ""}`);
    if (c === "launches" || c === "home") return go("/");
    if (c === "clear" || c === "cls") { setEcho([]); if (path !== "/" ) router.push("/"); else router.push(`/?n=${Date.now()}`); return; }
    if (c === "help" || c === "?") return setEcho([`› ${line}`, ...HELP]);
    setEcho([`› ${line}`, `sentinel: ${cmd}: command not found`, ...HELP]);
  };

  return (
    <header className="sticky top-0 z-40 bg-black border-b border-line">
      <div className="mx-auto w-full max-w-[1280px] px-4">
        <form className="flex items-center gap-2 h-10" onSubmit={e => { e.preventDefault(); run(value); setValue(""); }}>
          <Link href="/" className="display text-[17px] text-fg shrink-0 leading-none" aria-label="sentinel home">SENTINEL</Link>
          <span className="text-red shrink-0">›</span>
          <input ref={input} value={value} onChange={e => setValue(e.target.value)} spellCheck={false} autoComplete="off" aria-label="command" placeholder="paste a mint · verdict <mint> · audit · agents · docs · help" className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-4" />
          <button type="submit" className="act act-primary shrink-0" disabled={!value.trim()}>run ↵</button>
        </form>
        <div className="flex items-center gap-x-3 h-7 -mt-1 text-fg-3 overflow-x-auto">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="act" aria-current={path === href || (href !== "/" && path.startsWith(href)) ? "page" : undefined}>[{label}]</Link>)}
          <span className="ml-auto whitespace-nowrap"><LiveTicker /></span>
        </div>
        {echo.length > 0 && (
          <pre className="hairline py-2 text-fg-3 whitespace-pre-wrap">{echo.map((l, i) => <div key={i} className={i === 0 ? "text-fg" : ""}>{l}</div>)}<button className="act text-fg-4" onClick={() => setEcho([])}>[clear]</button></pre>
        )}
      </div>
    </header>
  );
}
