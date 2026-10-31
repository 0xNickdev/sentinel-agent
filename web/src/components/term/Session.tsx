"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { STREAM, short, type Band, type SwarmEvent, type Verdict } from "@/lib/api";
import { Cursor, Label, LogLine } from "./Log";
import { Report, WORD } from "./Report";
import { LaunchLog } from "./LaunchLog";
import { StatLine } from "./StatLine";

interface Entry { id: string; t: number; source: string; text: string; red?: boolean; dim?: boolean; live?: boolean }
type Stage = "idle" | "running" | "done";

const EXAMPLES: Array<[string, string]> = [["LIBRA · rugged", "Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"], ["BONK · clean", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]];

/**
 * Home is one session: the launch feed scrolls as a log, below it the current verdict run.
 * A run streams the swarm over SSE as `[05.3] agent › text` lines, then prints the report in the same window.
 */
export function Session({ initialMint = "", fresh = false, nonce = "" }: { initialMint?: string; fresh?: boolean; nonce?: string }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [mint, setMint] = useState(initialMint);
  const [log, setLog] = useState<Entry[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const es = useRef<EventSource | null>(null);
  const t0 = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const push = useCallback((e: Omit<Entry, "t" | "id"> & { id?: string }) => {
    const t = Date.now() - t0.current;
    setLog(l => {
      if (e.id) { const i = l.findIndex(x => x.id === e.id); if (i >= 0) { const n = [...l]; n[i] = { ...n[i]!, ...e, t: n[i]!.t }; return n; } }
      return [...l, { ...e, id: e.id ?? `${t}-${l.length}`, t }];
    });
  }, []);

  const run = useCallback((m: string, again = false) => {
    es.current?.close();
    setLog([]); setVerdict(null); setMint(m); setStage("running"); t0.current = Date.now(); setElapsed(0);
    const src = new EventSource(`${STREAM}/stream/verdict?mint=${encodeURIComponent(m)}${again ? "&fresh=1" : ""}`);
    es.current = src;
    const buf = new Map<string, string>();
    const think = (key: string, source: string, delta: string, red = false) => {
      const joined = (buf.get(key) ?? "") + delta; buf.set(key, joined);
      const last = joined.split("\n").map(s => s.trim()).filter(Boolean).pop() ?? "";
      push({ id: `think:${key}`, source, text: last.length > 240 ? `…${last.slice(-240)}` : last, dim: true, live: true, red });
    };
    const settle = (key: string) => setLog(l => l.map(x => (x.id === `think:${key}` ? { ...x, live: false } : x)));
    const onAny = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as SwarmEvent;
      switch (ev.type) {
        case "swarm_start": push({ source: "swarm", text: `${ev.agents.length} agents on ${short(ev.mint, 6)} · ${ev.flags} flags from the engine · baseline ${ev.baselineScore}` }); break;
        case "veto": push({ source: "veto", text: `${ev.veto.code} · ${ev.veto.agent} · ${ev.veto.message}`, red: true }); break;
        case "agent_start": push({ source: ev.agent, text: `start · ${ev.model}`, dim: true }); break;
        case "agent_thinking": think(ev.agent, ev.agent, ev.text); break;
        case "agent_finding": case "debate_finding": settle(ev.finding.agent); push({ source: ev.finding.agent, text: `${ev.type === "debate_finding" ? `revised ${ev.finding.revised?.riskScore ?? "?"}→` : ""}${ev.finding.riskScore} · conf ${ev.finding.confidence.toFixed(2)} · ${ev.finding.label.replace(/_/g, " ")} · ${ev.finding.summary}`, red: ev.finding.riskScore >= 65 }); break;
        case "agent_error": settle(ev.agent); push({ source: ev.agent, text: `failed · ${ev.error}`, red: true }); break;
        case "consensus": push({ source: "consensus", text: `${ev.consensus.rule} · weighted ${ev.consensus.weightedScore} · spread ${ev.consensus.spread} · suggests ${ev.consensus.suggestedBand} · completeness ${ev.consensus.completeness.score.toFixed(2)}` }); break;
        case "debate_start": push({ source: "debate", text: `${ev.agents.join(" vs ")} · spread ${ev.spread} · one round`, red: true }); break;
        case "advocate_start": push({ source: "advocate", text: `arguing against ${ev.arguesAgainst} · ${ev.model}`, dim: true }); break;
        case "advocate_thinking": think("advocate", "advocate", ev.text); break;
        case "advocate": settle("advocate"); push({ source: "advocate", text: `for ${ev.advocate.arguesFor}: ${ev.advocate.thesis} · weakest link: ${ev.advocate.weakestLink}` }); break;
        case "judge_start": push({ source: "judge", text: `deliberating · ${ev.model}`, dim: true }); break;
        case "judge_thinking": think("judge", "judge", ev.text); break;
        case "verdict": settle("judge"); push({ source: "verdict", text: `${WORD[ev.verdict.verdict]} · ${ev.verdict.riskScore}/100 · confidence ${ev.verdict.confidence.toFixed(2)} · ${(ev.verdict.timing.totalMs / 1000).toFixed(1)}s`, red: true }); setVerdict(ev.verdict); setStage("done"); src.close(); break;
        case "error": push({ source: "error", text: ev.error, red: true }); setStage("idle"); src.close(); break;
      }
    };
    for (const t of ["swarm_start", "veto", "agent_start", "agent_thinking", "agent_finding", "agent_error", "consensus", "debate_start", "debate_finding", "advocate_start", "advocate_thinking", "advocate", "judge_start", "judge_thinking", "verdict", "error"]) src.addEventListener(t, onAny as EventListener);
    src.onerror = () => { if (src.readyState === EventSource.CLOSED) return; push({ source: "error", text: "connection to the swarm was lost", red: true }); setStage("idle"); src.close(); };
  }, [push]);

  useEffect(() => { if (initialMint) run(initialMint, fresh); return () => es.current?.close(); }, [initialMint, fresh, nonce, run]);
  useEffect(() => { if (stage !== "running") return; const i = setInterval(() => setElapsed(Date.now() - t0.current), 100); return () => clearInterval(i); }, [stage]);
  useEffect(() => { if (stage === "running" && log.length) end.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [log.length, stage]);

  return (
    <div>
      <StatLine />
      <LaunchLog onJudge={m => run(m)} />

      <Label>session{mint ? ` · ${mint}` : ""}</Label>
      {stage === "idle" && !verdict && (
        <div className="text-fg-3">
          <div>sentinel judges whether a Solana token is a rug. seven specialist agents read the chain; a judge weighs them under a rule that can override it (veto · weighted mean · one debate round). every agent is <span className="text-fg-2">Verified by Concordium</span>; every verdict is hashed into an append-only audit contract and signed ML-DSA-65.</div>
          <div className="mt-2">› paste a mint above, or try {EXAMPLES.map(([l, m]) => <button key={m} type="button" className="act ml-2" onClick={() => run(m)}>[{l}]</button>)}</div>
          <div className="mt-2 text-fg-4">type <span className="text-fg-3">help</span> for commands · <span className="text-fg-3">/</span> focuses the prompt</div>
        </div>
      )}
      {stage !== "idle" && <div className="text-fg-3">› verdict {mint} <span className="text-fg-4">{stage === "running" ? `${(elapsed / 1000).toFixed(1)}s` : ""}</span></div>}
      {log.length > 0 && <div className="mt-1">
        {log.map(e => <LogLine key={e.id} t={e.t} source={e.source} red={e.red} dim={e.dim}>{e.text}{e.live && <> <Cursor /></>}</LogLine>)}
        {stage === "running" && <div className="log"><span className="t" /><span className="s" /><span className="x"><Cursor red /></span></div>}
        <div ref={end} />
      </div>}
      {verdict && <Report v={verdict} onRerun={() => run(mint, true)} />}
      {stage === "idle" && log.length > 0 && <div className="mt-3 text-fg-3">› <button type="button" className="act" onClick={() => run(mint)}>[retry]</button></div>}
    </div>
  );
}

export type { Band };
