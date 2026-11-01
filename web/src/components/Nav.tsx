"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LiveTicker } from "./LiveTicker";

const links = [
  { href: "/", label: "Check" },
  { href: "/audit", label: "Audit" },
  { href: "/track", label: "Track" },
  { href: "/agents", label: "Agents" },
  { href: "/docs", label: "Docs · MCP" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-sm bg-black/70 border-b border-line">
      <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
        <Link href="/" className="display text-xl tracking-tight flex items-center gap-2 shrink-0">
          <span className="dot" /> SENTINEL
        </Link>
        <nav className="flex items-center gap-1 rounded-full border border-line-2 p-1 overflow-x-auto max-w-full min-w-0">
          {links.map(l => (
            <Link key={l.href} href={l.href} className={`px-3 h-8 inline-flex items-center rounded-full text-sm whitespace-nowrap transition-colors ${path === l.href || (l.href !== "/" && path.startsWith(l.href)) ? "bg-fg text-black" : "text-fg-2 hover:text-fg"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-3 shrink-0">
          <LiveTicker />
          <Link href="/#check" className="pill">Check a token</Link>
        </div>
      </div>
    </header>
  );
}
