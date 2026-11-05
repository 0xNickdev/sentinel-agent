"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AGENTS, STREAM, getJSON, type Finding, type QuickVerdict, type SwarmEvent, type Verdict } from "@/lib/api";
import { WORD } from "@/lib/verdict";
import { CheckPill } from "./CheckPill";
import { SwarmCanvas, type SwarmMode } from "./SwarmCanvas";
import { VerdictStamp } from "./VerdictStamp";

type Stage = "idle" | "running" | "verdict";

interface Lane { id: string; name: string; lines: string[]; finding: Finding | null; error: string | null; started: boolean }

const freshLanes = (): Lane[] => AGENTS.map(a => ({ id: a.id, name: a.name, lines: [], finding: null, error: null, started: false }));

/** One stage, three states in the same frame: input → seven agent lanes, advocate, judge → verdict stamp. Never fakes the wait. */
export function CheckFlow({ initialMint = "", fresh = false, nonce = "" }: { initialMint?: string; fresh?: boolean; nonce?: string }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [mint, setMint] = useState(initialMint);
  const [lanes, setLanes] = useState<Lane[]>(freshLanes);
  const [vetoes, setVetoes] = useState<Array<{ code: string; agent: string; message: string }>>([]);
  const [advocate, setAdvocate] = useState<string[]>([]);
  const [judge, setJudge] = useState<string[]>([]);
  const [debate, setDebate] = useState<string | null>(null);
  const [consensus, setConsensus] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [quick, setQuick] = useState<QuickVerdict | null>(null);
  const es = useRef<EventSource | null>(null);
  const mode: SwarmMode = stage === "idle" ? "idle" : stage === "running" ? (judge.length || advocate.length ? "converge" : "idle") : "verdict";

  const reset = () => { es.current?.close(); setQuick(null); setLanes(freshLanes()); setVetoes([]); setAdvocate([]); setJudge([]); setDebate(null); setConsensus(null); setVerdict(null); setError(null); };

  const run = useCallback((m: string, again = false) => {
    reset();
    setMint(m); setStage("running"); setStartedAt(Date.now());
    // Fast tier first: engine rules, no models, about a second. The swarm streams in below it.
    getJSON<QuickVerdict>(`/quick/${encodeURIComponent(m)}`).then(q => setQuick(cur => cur ?? q)).catch(() => undefined);
    const src = new EventSource(`${STREAM}/stream/verdict?mint=${encodeURIComponent(m)}${again ? "&fresh=1" : ""}`);
    es.current = src;
    const onAny = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as SwarmEvent;
      switch (ev.type) {
        case "veto": setVetoes(v => [...v, ev.veto]); break;
        case "agent_start": setLanes(ls => ls.map(l => (l.id === ev.agent ? { ...l, started: true } : l))); break;
        case "agent_thinking": setLanes(ls => ls.map(l => (l.id === ev.agent ? { ...l, lines: pushLine(l.lines, ev.text) } : l))); break;
        case "agent_finding": case "debate_finding": setLanes(ls => ls.map(l => (l.id === ev.finding.agent ? { ...l, finding: ev.finding } : l))); break;
        case "agent_error": setLanes(ls => ls.map(l => (l.id === ev.agent ? { ...l, error: ev.error } : l))); break;
        case "consensus": setConsensus(`${ev.consensus.rule} · weighted ${ev.consensus.weightedScore} · spread ${ev.consensus.spread} · suggests ${WORD[ev.consensus.suggestedBand]}`); break;
        case "debate_start": setDebate(`${ev.agents.join(" vs ")} · spread ${ev.spread} · one round`); break;
        case "advocate_start": setAdvocate([`arguing against ${WORD[ev.arguesAgainst]}…`]); break;
        case "advocate_thinking": setAdvocate(a => pushLine(a, ev.text)); break;
        case "advocate": setAdvocate([`for ${WORD[ev.advocate.arguesFor]}: ${ev.advocate.thesis}`, `weakest link: ${ev.advocate.weakestLink}`]); break;
        case "judge_start": setJudge(["deliberating…"]); break;
        case "judge_thinking": setJudge(j => pushLine(j, ev.text)); break;
        case "verdict": setVerdict(ev.verdict); setStage("verdict"); src.close(); break;
        case "error": setError(ev.error); setStage("idle"); src.close(); break;
      }
    };
    for (const t of ["swarm_start", "veto", "agent_start", "agent_thinking", "agent_finding", "agent_error", "consensus", "debate_start", "debate_finding", "advocate_start", "advocate_thinking", "advocate", "judge_start", "judge_thinking", "verdict", "error"]) src.addEventListener(t, onAny as EventListener);
    src.onerror = () => { if (src.readyState === EventSource.CLOSED) return; setError("connection to the swarm was lost"); setStage("idle"); src.close(); };
  }, []);

  useEffect(() => { if (initialMint) run(initialMint, fresh); return () => es.current?.close(); }, [initialMint, fresh, nonce, run]);

  return (
    <section id="check" className="relative min-h-[calc(100vh-4rem)] flex flex-col">
      <SwarmCanvas mode={mode} intensity={stage === "verdict" ? 0.5 : 1} />
      <div className="relative z-10 flex-1 flex flex-col justify-center py-16">
        <AnimatePresence mode="wait">
          {stage === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="px-4">
              <HeroCopy />
              <CheckPill onSubmit={m => run(m)} defaultValue={mint} />
              {error && <p className="mt-4 text-center text-red mono">{error}</p>}
              <Examples onPick={m => run(m)} />
            </motion.div>
          )}
          {stage === "running" && (
            <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.4 }} className="mx-auto w-full max-w-5xl px-4">
              <TopBar mint={mint} startedAt={startedAt} />
              {quick && <QuickStrip q={quick} />}
              {vetoes.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">{vetoes.map(v => <span key={v.code} className="pill pill-red h-8 text-xs mono" title={v.message}>VETO · {v.code} · {v.agent}</span>)}</div>
              )}
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {lanes.map((l, i) => <LaneView key={l.id} lane={l} index={i} />)}
              </div>
              {consensus && <div className="mt-4 mono text-xs text-fg-3"><span className="text-fg">CONSENSUS</span> {consensus}</div>}
              {debate && <div className="mt-2 mono text-fg-2"><span className="text-red">DEBATE</span> {debate}</div>}
              {advocate.length > 0 && (
                <div className="mt-4 rounded-2xl border border-line-2 bg-black/60 p-4">
                  <div className="display text-sm text-fg-2 mb-2">ADVOCATE</div>
                  <div className="mono text-fg-2 space-y-1">{advocate.slice(-3).map((t, i, a) => <div key={i} className={i === a.length - 1 && !judge.length && !t.startsWith("weakest") ? "shimmer" : ""}>{t}</div>)}</div>
                </div>
              )}
              {judge.length > 0 && (
                <div className="mt-4 rounded-2xl border border-red/40 bg-black/60 p-4">
                  <div className="display text-sm text-red mb-2">JUDGE</div>
                  <div className="mono text-fg-2 space-y-1">{judge.slice(-4).map((t, i, a) => <div key={i} className={i === a.length - 1 ? "shimmer" : ""}>{t}</div>)}</div>
                </div>
              )}
            </motion.div>
          )}
          {stage === "verdict" && verdict && (
            <motion.div key="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="mx-auto w-full max-w-5xl px-4">
              <VerdictStamp verdict={verdict} onRerun={() => run(mint, true)} onNew={() => { reset(); setStage("idle"); }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function pushLine(lines: string[], delta: string): string[] {
  const joined = (lines[lines.length - 1] ?? "") + delta;
  const parts = joined.split("\n");
  const head = lines.slice(0, -1);
  return [...head, ...parts].filter((l, i, a) => l.trim() || i === a.length - 1).slice(-6);
}

function HeroCopy() {
  return (
    <div className="text-center mb-8">
      <h1 className="display text-[clamp(56px,13vw,220px)] select-none">IS IT A RUG?</h1>
      <p className="mt-4 md:mt-6 text-fg-2 text-base md:text-lg max-w-2xl mx-auto">Seven specialist agents read the chain, an advocate argues the other side, a judge decides in seconds. Every agent is <span className="text-fg">Verified by Concordium</span>; every verdict is hashed on-chain, signed post-quantum, then graded against what actually happened.</p>
    </div>
  );
}

const EXAMPLES = [
  { label: "LIBRA · rugged", mint: "Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU" },
  { label: "BONK · clean", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
];
function Examples({ onPick }: { onPick: (m: string) => void }) {
  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm">
      <span className="text-fg-4 self-center">try</span>
      {EXAMPLES.map(e => <button key={e.mint} onClick={() => onPick(e.mint)} className="pill pill-ghost h-8 text-xs">{e.label}</button>)}
      <span className="text-fg-4 self-center">or judge a live launch below</span>
    </div>
  );
}

function TopBar({ mint, startedAt }: { mint: string; startedAt: number }) {
  const [ms, setMs] = useState(0);
  useEffect(() => { const i = setInterval(() => setMs(Date.now() - startedAt), 100); return () => clearInterval(i); }, [startedAt]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-full bg-white text-black h-11 pl-5 pr-3 font-mono text-sm">
      <span className="truncate">{mint}</span>
      <span className="display-num text-base shrink-0">{(ms / 1000).toFixed(1)}s</span>
    </div>
  );
}

function LaneView({ lane, index }: { lane: Lane; index: number }) {
  const f = lane.finding;
  const danger = f && f.riskScore >= 65;
  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className={`rounded-2xl border ${f ? (danger ? "border-red" : "border-line-2") : "border-line"} bg-black/60 p-4 min-h-[112px]`}>
      <div className="flex items-center justify-between gap-2">
        <div className="display text-sm">{lane.name.toUpperCase()}</div>
        {f ? (
          <div className="flex items-center gap-2 mono text-xs">
            {f.revised && <span className="text-fg-4">was {f.revised.riskScore}</span>}
            <span className={`display-num text-lg ${danger ? "text-red" : "text-fg"}`}>{f.riskScore}</span>
            <span className="text-fg-3">conf {f.confidence.toFixed(2)}</span>
          </div>
        ) : lane.error ? <span className="mono text-xs text-red">failed</span> : <ProgressDots active={lane.started} />}
      </div>
      <div className="mt-2 mono text-xs leading-5 text-fg-2 min-h-[3rem] break-words">
        {f ? <span className="text-fg">{f.summary}</span> : lane.error ? <span className="text-red">{lane.error}</span> : lane.lines.length ? lane.lines.slice(-3).map((l, i, a) => <div key={i} className={i === a.length - 1 ? "shimmer" : ""}>{l}</div>) : <span className="shimmer">{lane.started ? "reading evidence" : "waiting"}</span>}
      </div>
    </motion.div>
  );
}

function ProgressDots({ active }: { active: boolean }) {
  return <span className="flex gap-1" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <motion.span key={i} className="w-1.5 h-1.5 bg-fg-3 inline-block" animate={active ? { opacity: [0.2, 1, 0.2] } : { opacity: 0.2 }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.12 }} />)}</span>;
}

/** First look from the fast tier while the swarm works: engine rules only, and it says what it did not read. */
function QuickStrip({ q }: { q: QuickVerdict }) {
  const tone = q.verdict === "DANGER" ? "border-red text-red" : q.verdict === "CAUTION" ? "border-fg-3 text-fg" : "border-line-2 text-fg";
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className={`mt-4 rounded-2xl border bg-black/60 p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="display text-xs text-fg-4">FIRST LOOK · {(q.ms / 1000).toFixed(1)}S · NO MODELS</span>
        <span className="display text-xl">{WORD[q.verdict]}</span>
        <span className="mono text-xs text-fg-3">risk {q.riskScore}/100</span>
        <span className="mono text-xs text-fg-4 ml-auto">full swarm verdict follows</span>
      </div>
      {q.flags.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{q.flags.map(f => <span key={f.code} title={f.message} className={`pill h-7 text-[11px] mono ${f.severity === "critical" ? "pill-red" : "pill-ghost"}`}>{f.code}</span>)}</div>}
      <div className="mt-2 mono text-[11px] text-fg-4">not read yet: {q.notChecked.join(" · ")}</div>
    </motion.div>
  );
}
