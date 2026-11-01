"use client";
import { useEffect, useRef } from "react";

export type SwarmMode = "idle" | "converge" | "verdict";

/**
 * The hero backdrop: a dot grid that powers up from the centre, six agent
 * nodes orbiting a core, red flickers, pointer repulsion. One rAF loop,
 * paused when hidden or off-screen, DPR capped at 2, frozen under
 * prefers-reduced-motion.
 */
export function SwarmCanvas({ mode = "idle", intensity = 1 }: { mode?: SwarmMode; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, t0 = performance.now(), visible = true;
    const pointer = { x: -9999, y: -9999 };
    const pitch = 24;
    const flickers = new Map<number, number>();
    const agents = Array.from({ length: 7 }, (_, i) => ({ phase: (i / 7) * Math.PI * 2, r: 0.28 + (i % 3) * 0.05, x: 0, y: 0 }));

    const resize = () => { w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; };
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const cols = Math.ceil(w / pitch), rows = Math.ceil(h / pitch);
      const maxD = Math.hypot(cx, cy);
      const converge = modeRef.current === "converge" ? 0.04 : 0;
      // grid
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        let x = c * pitch, y = r * pitch;
        const d = Math.hypot(x - cx, y - cy);
        const appear = Math.min(1, Math.max(0, (t * 1.1 - d / maxD) * 2.2)); // power up from centre
        if (appear <= 0) continue;
        if (converge) { x += (cx - x) * converge; y += (cy - y) * converge; }
        const pd = Math.hypot(x - pointer.x, y - pointer.y);
        let k = 1;
        if (!reduced && pd < 140) { const push = (1 - pd / 140) * 10; x += ((x - pointer.x) / (pd || 1)) * push; y += ((y - pointer.y) / (pd || 1)) * push; k = 1 + (1 - pd / 140) * 1.2; }
        const idx = r * 1000 + c;
        const f = flickers.get(idx);
        let red = 0;
        if (f !== undefined) { red = Math.max(0, 1 - (now - f) / 1000); if (red === 0) flickers.delete(idx); }
        const alpha = 0.22 * appear * intensity + red * 0.7;
        ctx.fillStyle = red > 0 ? `rgba(255,42,42,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(x - k, y - k, 2 * k, 2 * k);
      }
      if (!reduced && Math.random() < 0.04) flickers.set(Math.floor(Math.random() * rows) * 1000 + Math.floor(Math.random() * cols), now);
      // agents
      if (t > 1.2) {
        const orbit = modeRef.current === "converge" ? 0.08 : modeRef.current === "verdict" ? 0.0 : 1;
        const focus = pointer.x > 0 && modeRef.current === "idle" ? 0.15 : 0;
        agents.forEach((a, i) => {
          const ang = a.phase + t * (0.25 + i * 0.03);
          const rr = Math.min(w, h) * a.r * orbit;
          let tx = cx + Math.cos(ang) * rr, ty = cy + Math.sin(ang) * rr * 0.6;
          if (focus) { tx += (pointer.x - tx) * focus; ty += (pointer.y - ty) * focus; }
          a.x += (tx - a.x) * (reduced ? 1 : 0.08); a.y += (ty - a.y) * (reduced ? 1 : 0.08);
          ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
          ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,42,42,0.9)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(cx, cy); ctx.stroke();
        });
        ctx.beginPath(); ctx.arc(cx, cy, modeRef.current === "verdict" ? 10 : 4, 0, Math.PI * 2); ctx.fillStyle = modeRef.current === "verdict" ? "#ff2a2a" : "#fff"; ctx.fill();
      }
    };
    const loop = (now: number) => { draw(now); if (!reduced && visible) raf = requestAnimationFrame(loop); };
    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
    const onLeave = () => { pointer.x = -9999; pointer.y = -9999; };
    const io = new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting && !document.hidden; if (visible && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);
    const onVis = () => { visible = !document.hidden; if (visible && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    raf = requestAnimationFrame(loop);
    if (reduced) { t0 = performance.now() - 5000; draw(performance.now()); }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); document.removeEventListener("visibilitychange", onVis); };
  }, [intensity]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
}
