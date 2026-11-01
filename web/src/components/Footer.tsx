"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

/** Giant typographic footer: SENTINEL in dots that react to the cursor. */
export function Footer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    const mouse = { x: -9999, y: -9999 };
    let points: Array<{ x: number; y: number; s: number }> = [];

    const layout = () => {
      w = canvas.clientWidth; h = Math.round(w * 0.18);
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
      // Rasterise the word once at low resolution and sample it into a dot grid.
      const off = document.createElement("canvas");
      const pitch = Math.max(6, Math.round(w / 140));
      off.width = Math.ceil(w / pitch); off.height = Math.ceil(h / pitch);
      const o = off.getContext("2d")!;
      o.fillStyle = "#fff"; o.textBaseline = "middle"; o.textAlign = "center";
      o.font = `800 ${Math.round(off.height * 1.05)}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-doto") || "monospace"}`;
      o.fillText("SENTINEL", off.width / 2, off.height / 2);
      const img = o.getImageData(0, 0, off.width, off.height).data;
      points = [];
      for (let y = 0; y < off.height; y++) for (let x = 0; x < off.width; x++) if (img[(y * off.width + x) * 4 + 3]! > 90) points.push({ x: x * pitch + pitch / 2, y: y * pitch + pitch / 2, s: pitch * 0.34 });
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const p of points) {
        const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const k = reduced ? 1 : d < 120 ? 1 + 0.6 * (1 - d / 120) : 1;
        ctx.fillStyle = d < 60 && !reduced ? "#ff2a2a" : "#fff";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * k, 0, Math.PI * 2); ctx.fill();
      }
    };
    const loop = () => { draw(); if (!reduced) raf = requestAnimationFrame(loop); };
    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    const ro = new ResizeObserver(() => { layout(); draw(); });
    ro.observe(canvas);
    document.fonts?.ready.then(() => { layout(); draw(); });
    layout(); loop();
    canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave);
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (!reduced) raf = requestAnimationFrame(loop); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return (
    <footer className="hairline mt-24">
      <div className="mx-auto max-w-7xl px-4 py-12 grid gap-10 md:grid-cols-3 text-sm">
        <div>
          <div className="display text-lg mb-3">SENTINEL</div>
          <p className="text-fg-3 max-w-xs">An accountable anti-rug oracle for agents. Verified by Concordium, paid over x402, every verdict on an append-only audit trail.</p>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <ul className="space-y-2 text-fg-2">
            <li><Link href="/audit" className="hover:text-fg">Audit explorer</Link></li>
            <li><Link href="/track" className="hover:text-fg">Track record</Link></li>
            <li><Link href="/agents" className="hover:text-fg">Agents & badges</Link></li>
            <li><Link href="/docs" className="hover:text-fg">Docs · MCP · A2A · x402</Link></li>
          </ul>
          <ul className="space-y-2 text-fg-2">
            <li><a href="https://testnet.ccdscan.io" className="hover:text-fg" target="_blank" rel="noreferrer">CCDScan testnet</a></li>
            <li><a href="https://agent-registry-mcp.concordium.com/docs" className="hover:text-fg" target="_blank" rel="noreferrer">Concordium Agent Registry</a></li>
            <li><a href="https://github.com/0xNickdev/sentinel-agent" className="hover:text-fg" target="_blank" rel="noreferrer">Source</a></li>
          </ul>
        </div>
        <div className="md:text-right text-fg-3">
          <div className="inline-flex items-center gap-2 pill pill-ghost"><span className="dot" /> Verified by Concordium</div>
          <p className="mt-3">Encode × Concordium · Trusted Agents Hackathon 2026</p>
        </div>
      </div>
      <canvas ref={ref} className="block w-full cursor-crosshair" aria-hidden="true" />
    </footer>
  );
}
