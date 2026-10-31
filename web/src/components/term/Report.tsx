"use client";
import Link from "next/link";
import { ccdscanTx, short, solscan, usd, type Verdict } from "@/lib/api";
import { VerifySignature } from "@/components/VerifySignature";
import { CopyButton } from "@/components/CopyButton";
import { KV, Label, LogLine, Rule } from "./Log";

export const WORD: Record<Verdict["verdict"], string> = { SAFE: "CLEAN", CAUTION: "RISKY", DANGER: "DANGER", RUGGED: "RUGGED" };
const WEIGHT: Record<string, string> = { decisive: "text-red", supporting: "text-fg", discounted: "text-fg-3", ignored: "text-fg-4" };
const SOURCE: Record<string, string> = { swarm_start: "swarm", consensus: "consensus", debate_start: "debate", veto: "veto", verdict: "verdict", advocate: "advocate", judge: "judge" };

/**
 * The verdict report, printed as plain text blocks in the session window.
 * Serves the home session (after the live log) and /audit/[digest] (with the stored transcript).
 */
export function Report({ v: raw, transcript = false, onRerun }: { v: Verdict; transcript?: boolean; onRerun?: () => void }) {
  // Records written before the structured judge lack these fields; render what exists.
  const v: Verdict = { ...raw, headline: raw.headline ?? "", decisive: raw.decisive ?? "", action: raw.action ?? "", cleanSignals: raw.cleanSignals ?? [], whatWouldChange: raw.whatWouldChange ?? [], scorecard: raw.scorecard ?? [], advocate: raw.advocate ?? null, rebuttal: raw.rebuttal ?? null, timeline: raw.timeline ?? [], topReasons: raw.topReasons ?? [], vetoes: raw.vetoes ?? [], flags: raw.flags ?? [], findings: raw.findings ?? [] };
  const rug = v.verdict === "DANGER" || v.verdict === "RUGGED";
  const m = v.evidence.market;
  const flows = v.evidence.flows;
  const record = `/audit/${v.attestation.digest}`;
  const name = [m?.name, m?.symbol].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
  return (
    <div>
      <div className="text-fg-3 mt-4">{name ? `${name} · ` : ""}<a className="act" href={solscan(v.mint)} target="_blank" rel="noreferrer">{v.mint}</a> · {new Date(v.at * 1000).toISOString().replace("T", " ").slice(0, 19)}Z</div>
      <div className={`display stamp text-[clamp(56px,10vw,128px)] mt-2 band-${v.verdict}`}>{WORD[v.verdict]}</div>
      <div className="mt-2 text-fg">risk <span className={rug ? "text-red" : ""}>{v.riskScore}</span>/100 · confidence {v.confidence.toFixed(2)} · {v.findings.length} agents · {v.vetoes.length} veto{v.vetoes.length === 1 ? "" : "es"} · {v.consensus.debateRounds} debate · {v.flags.length} flags · {(v.timing.totalMs / 1000).toFixed(1)}s</div>
      {v.vetoes.length > 0 && <div className="text-red mt-1">{v.vetoes.map(x => <div key={x.code}>VETO {x.code} · {x.agent} · {x.message}</div>)}</div>}

      {v.headline && <><Label red={rug}>headline</Label><div className="text-fg">{v.headline}</div></>}
      {v.decisive && <><Label>decisive</Label><div className="text-fg-2">{v.decisive}</div></>}
      {v.action && <><Label>action</Label><div className="text-fg"><span className="text-red">→</span> {v.action}</div></>}

      {v.topReasons.length > 0 && <><Label>why</Label>{v.topReasons.map((r, i) => <div key={i} className="grid grid-cols-[3ch_1fr] gap-x-2"><span className="text-red">{String(i + 1).padStart(2, "0")}</span><span className="text-fg">{r}</span></div>)}</>}
      {v.cleanSignals.length > 0 && <><Label>what is fine</Label>{v.cleanSignals.map((c, i) => <div key={i} className="grid grid-cols-[3ch_1fr] gap-x-2"><span className="text-fg-4">·</span><span>{c}</span></div>)}</>}
      {v.whatWouldChange.length > 0 && <><Label>would change</Label>{v.whatWouldChange.map((c, i) => <div key={i} className="grid grid-cols-[3ch_1fr] gap-x-2"><span className="text-fg-4">·</span><span>{c}</span></div>)}</>}
      {!v.headline && v.reasoning && <><Label>reasoning</Label><div className="whitespace-pre-wrap">{v.reasoning}</div></>}

      {(v.scorecard.length > 0 || v.findings.length > 0) && <>
        <Label>scorecard</Label>
        <div className="tt-wrap"><table className="tt w-full">
          <thead><tr><th>agent</th><th className="text-right">score</th><th className="text-right">conf</th><th>weight</th><th>why</th></tr></thead>
          <tbody>
            {(v.scorecard.length ? v.scorecard : v.findings.map(f => ({ agent: f.agent, weight: "supporting" as const, why: f.summary }))).map(s => {
              const f = v.findings.find(x => x.agent === s.agent);
              const hot = f && f.riskScore >= 65;
              return (
                <tr key={s.agent}>
                  <td className="text-fg">{s.agent}</td>
                  <td className={`text-right ${hot ? "text-red" : "text-fg"}`}>{f ? f.riskScore : "—"}{f?.revised ? <span className="text-fg-4"> ←{f.revised.riskScore}</span> : null}</td>
                  <td className="text-right text-fg-3">{f ? f.confidence.toFixed(2) : "—"}</td>
                  <td className={WEIGHT[s.weight] ?? "text-fg-2"}>{s.weight}</td>
                  <td className="wrap text-fg-2">{s.why}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </>}

      {v.findings.length > 0 && <>
        <Label>findings</Label>
        {v.findings.map(f => (
          <div key={f.agent} className="grid grid-cols-[10ch_1fr] gap-x-2 mb-1">
            <span className={f.riskScore >= 65 ? "text-red" : "text-fg-3"}>{f.agent}</span>
            <span><span className="text-fg">{f.summary}</span>{f.notable.slice(0, 3).map((n, i) => <div key={i} className="text-fg-3">· {n}</div>)}<div className="text-fg-4">{f.label.replace(/_/g, " ")} · {f.model} · {(f.ms / 1000).toFixed(1)}s{f.agentRegistryId ? ` · registry #${f.agentRegistryId}` : ""}</div></span>
          </div>
        ))}
      </>}

      {(v.advocate || v.rebuttal) && <>
        <Label>advocate / rebuttal</Label>
        {v.advocate && <div className="grid grid-cols-[10ch_1fr] gap-x-2"><span className="text-fg-3">advocate</span><span><span className="text-fg">for {v.advocate.arguesFor}: {v.advocate.thesis}</span>{v.advocate.points.map((p, i) => <div key={i}>· {p}</div>)}<div className="text-fg-4">weakest link: {v.advocate.weakestLink} · {v.advocate.model}</div></span></div>}
        {v.rebuttal && <div className="grid grid-cols-[10ch_1fr] gap-x-2 mt-1"><span className="text-red">judge</span><span className="text-fg-2">{v.rebuttal}</span></div>}
      </>}
      {v.dissent && <><Label red>dissent</Label><div>{v.dissent}</div></>}

      <Label>consensus</Label>
      <KV k="rule">{v.consensus.rule}</KV>
      <KV k="weighted">{v.consensus.weightedScore} · spread {v.consensus.spread} · suggested {v.consensus.suggestedBand} · completeness {v.consensus.completeness.score.toFixed(2)}</KV>
      {v.judge.overridden.length > 0 && <KV k="overrides">{v.judge.overridden.join("; ")}</KV>}
      {v.consensus.completeness.missing.length > 0 && <KV k="missing">{v.consensus.completeness.missing.join("; ")}</KV>}
      {v.consensus.failed.length > 0 && <KV k="failed">{v.consensus.failed.join(", ")}</KV>}

      <Label>evidence</Label>
      <KV k="holders">top-10 {v.evidence.holders.top10Pct}% · {v.evidence.holders.count} holders</KV>
      <KV k="snipers">bought {v.evidence.snipers.boughtPct}% · holding {v.evidence.snipers.holdingPct}% · {v.evidence.snipers.wallets.length} wallets</KV>
      <KV k="bundles">{v.evidence.bundles.boughtPct}% · {v.evidence.bundles.groups} groups · {v.evidence.bundles.wallets} wallets</KV>
      <KV k="linked">{v.evidence.linked.linkedPct}% · via creator {v.evidence.linked.linkedToCreatorPct}% · {v.evidence.linked.checked} checked</KV>
      {m && <KV k="market">liq {usd(m.liquidityUsd)} · fdv {usd(m.fdvUsd)} · 24h {usd(m.volume24hUsd)} · {m.pairs} pools · {m.topVenue ?? "?"}</KV>}
      {v.evidence.creator && <KV k="creator">{v.evidence.creator.address ?? "unknown"} · {v.evidence.creator.status}</KV>}
      {v.flags.length > 0 && <KV k="flags">{v.flags.map(f => <span key={f.code} className={f.severity === "critical" ? "text-red" : ""}>{f.code} </span>)}</KV>}
      {v.evidence.linked.clusters.length > 0 && <>
        <div className="text-fg-4 mt-2">funding clusters</div>
        {v.evidence.linked.clusters.map(c => <div key={c.funder} className="break-all"><span className={c.viaCreator ? "text-red" : "text-fg"}>{c.viaCreator ? "creator" : short(c.funder, 5)}</span> <span className="text-fg-4">→</span> {c.wallets.map(w => short(w, 4)).join(" ")} <span className="text-fg">{c.pct}%</span></div>)}
      </>}

      {flows && flows.trails.length > 0 && <>
        <Label>money flow</Label>
        <div className="text-fg-4">{flows.traced} wallet{flows.traced === 1 ? "" : "s"} traced · {flows.toExchangeSol} SOL to exchanges · {flows.toFunderSol} SOL back to the funder · {flows.recycledSol} SOL recycled</div>
        {flows.trails.slice(0, 12).map((t, i) => (
          <div key={`${t.from}-${i}`} className={`break-all ${t.endsAt === "exchange" ? "text-red" : "text-fg-2"}`}>
            {t.from === v.evidence.creator?.address ? "creator" : short(t.from, 4)} <span className="text-fg-4">──▸</span> {t.totalSol} SOL{t.hops.map((h, j) => <span key={j}> <span className="text-fg-4">──▸</span> {h.label ?? short(h.to, 4)}<span className="text-fg-4">({h.kind})</span></span>)}
          </div>
        ))}
      </>}

      <Label>attestation</Label>
      <KV k="digest">{v.attestation.digest}</KV>
      <KV k="concordium">{v.attestation.concordiumTx ? <a className="act text-fg" href={ccdscanTx(v.attestation.concordiumTx)} target="_blank" rel="noreferrer">{v.attestation.concordiumTx} ↗</a> : <span className="text-fg-4">anchor pending</span>}{v.stored?.auditSeq != null ? ` · seq ${v.stored.auditSeq}` : ""}</KV>
      <KV k="registry">{v.attestation.agentRegistry ?? <span className="text-fg-4">pending</span>}</KV>
      <KV k="models">{v.models.specialist} · {v.models.judge} · {v.models.engine}</KV>
      {v.attestation.signature && <>
        <KV k={v.attestation.signature.alg}><VerifySignature verdict={{ mint: v.mint, verdict: v.verdict, riskScore: v.riskScore, at: v.at, attestation: { digest: v.attestation.digest } }} signature={v.attestation.signature} /></KV>
        <KV k="signature">{short(v.attestation.signature.signature, 32)}</KV>
        <KV k="public key">{short(v.attestation.signature.publicKey, 32)}</KV>
      </>}

      {transcript && v.timeline.length > 0 && <>
        <Label>transcript</Label>
        {v.timeline.map((l, i) => <LogLine key={i} t={l.t} source={l.agent ?? SOURCE[l.type] ?? l.type} red={l.type === "veto" || l.type === "verdict" || l.type === "debate_start"}>{l.text}</LogLine>)}
      </>}

      <Rule />
      <div className="flex flex-wrap gap-x-3 text-fg-2">
        <Link href={record} className="act">[open record]</Link>
        {onRerun ? <button type="button" className="act" onClick={onRerun}>[re-run]</button> : <Link href={`/?mint=${v.mint}&fresh=1&n=${v.at}`} className="act">[re-run]</Link>}
        <CopyButton text={() => `${location.origin}${record}`} label="copy link" />
        <CopyButton text={JSON.stringify(raw, null, 2)} label="copy json" />
      </div>
    </div>
  );
}
