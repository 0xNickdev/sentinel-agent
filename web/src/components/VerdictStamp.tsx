"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { ccdscanTx, short, solscan, type Verdict } from "@/lib/api";
import { WORD, isHot, normalise } from "@/lib/verdict";
import { JudgeBrief } from "./JudgeBrief";
import { FindingCards } from "./FindingCards";
import { MoneyFlow } from "./MoneyFlow";
import { ConnectionGraph } from "./ConnectionGraph";
import { OutcomeChips } from "./Outcomes";
import { VerifySignature } from "./VerifySignature";
import { CopyButton } from "./CopyButton";

/** The verdict stamp: scale 1.6 → 1 with a spring, 2-frame white flash, camera shake only for a rug. Below it, the judge's brief, the findings, the evidence, the attestation. */
export function VerdictStamp({ verdict: raw, onRerun, onNew }: { verdict: Verdict; onRerun: () => void; onNew: () => void }) {
  const v = normalise(raw);
  const word = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const rug = isHot(v);
  useEffect(() => {
    const el = word.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animate(el, { scale: [1.6, 1], opacity: [0, 1], duration: 420, ease: "outBack(2.2)" });
    if (flash.current) animate(flash.current, { opacity: [0.06, 0], duration: 90, ease: "linear" });
    if (rug) animate(el, { translateX: [0, -2, 2, -2, 2, 0], duration: 120, delay: 60, ease: "linear" });
    if (rug && "vibrate" in navigator) navigator.vibrate?.(30);
  }, [rug]);
  const m = v.evidence.market;
  const record = `/audit/${v.attestation.digest}`;
  const name = [m?.name, m?.symbol].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
  return (
    <div className="relative">
      <div ref={flash} className="pointer-events-none fixed inset-0 bg-white opacity-0" aria-hidden="true" />
      {rug && <div className="pointer-events-none absolute -inset-20 bg-[radial-gradient(ellipse_at_center,rgba(255,42,42,0.14),transparent_60%)]" aria-hidden="true" />}
      <div className="relative text-center">
        <div className="mono text-fg-3">{name || short(v.mint, 6)} · <a className="hover:text-fg" href={solscan(v.mint)} target="_blank" rel="noreferrer">{short(v.mint, 6)}</a></div>
        <div ref={word} className={`display text-[clamp(72px,16vw,260px)] mt-2 band-${v.verdict}`}>{WORD[v.verdict]}</div>
        <div className="mt-2 flex items-center justify-center gap-6 display-num text-2xl md:text-3xl">
          <span><span className={rug ? "text-red" : ""}>{v.riskScore}</span><span className="text-fg-4">/100 risk</span></span>
          <span>{v.confidence.toFixed(2)}<span className="text-fg-4"> confidence</span></span>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 pill pill-ghost text-xs mono pill-wrap">judged in {(v.timing.totalMs / 1000).toFixed(1)}s · {v.findings.length} agents · {v.vetoes.length} veto{v.vetoes.length === 1 ? "" : "es"} · {v.consensus.debateRounds} debate · {v.flags.length} flags</div>
        {v.vetoes.length > 0 && <div className="mt-3 flex flex-wrap justify-center gap-2">{v.vetoes.map(x => <span key={x.code} className="pill pill-red h-8 text-xs mono" title={x.message}>VETO · {x.code} · {x.agent}</span>)}</div>}
        {(v.outcomes?.length ?? 0) > 0 && <div className="mt-3 flex justify-center"><OutcomeChips outcomes={v.outcomes!} riskScore={v.riskScore} /></div>}
      </div>

      <div className="mt-10"><JudgeBrief v={v} compact scorecard={false} /></div>

      <div className="mt-8"><FindingCards v={v} glass /></div>

      <div className="mt-4"><ConnectionGraph v={v} /></div>

      {v.evidence.flows && v.evidence.flows.trails.length > 0 && <div className="mt-4"><MoneyFlow flows={v.evidence.flows} creator={v.evidence.creator?.address} limit={6} /></div>}

      <div className="mt-8 rounded-2xl border border-line-2 p-4 md:p-5 bg-black/60">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 pill pill-ghost text-xs"><span className="dot" /> Verified by Concordium</span>
          <span className="mono text-xs text-fg-3">sha256 {short(v.attestation.digest, 10)}</span>
          {v.attestation.signature && <span className="mono text-xs text-fg-3">· {v.attestation.signature.alg} signed</span>}
          {v.attestation.concordiumTx ? <a className="mono text-xs text-fg hover:text-red" href={ccdscanTx(v.attestation.concordiumTx)} target="_blank" rel="noreferrer">· on-chain record {short(v.attestation.concordiumTx, 6)} ↗</a> : <span className="mono text-xs text-fg-4">· audit anchor pending</span>}
        </div>
        {v.attestation.signature && <div className="mt-4"><VerifySignature verdict={{ mint: v.mint, verdict: v.verdict, riskScore: v.riskScore, at: v.at, attestation: { digest: v.attestation.digest } }} signature={v.attestation.signature} /></div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={record} className="pill">Open audit record</Link>
          <button onClick={onRerun} className="pill pill-ghost">Re-run fresh</button>
          <button onClick={onNew} className="pill pill-ghost">Check another</button>
          <CopyButton text={() => `${location.origin}${record}`} label="Copy link" />
          <CopyButton text={JSON.stringify(raw, null, 2)} label="Copy JSON" />
        </div>
      </div>
    </div>
  );
}

