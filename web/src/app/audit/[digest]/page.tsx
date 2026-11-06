import Link from "next/link";
import { notFound } from "next/navigation";
import { ccdscanTx, serverApi, short, solscan, usd, type Verdict } from "@/lib/api";
import { WORD, normalise } from "@/lib/verdict";
import { VerifySignature } from "@/components/VerifySignature";
import { JudgeBrief } from "@/components/JudgeBrief";
import { FindingCards } from "@/components/FindingCards";
import { MoneyFlow } from "@/components/MoneyFlow";
import { ConnectionGraph } from "@/components/ConnectionGraph";
import { OutcomeChips, OutcomeTable } from "@/components/Outcomes";
import { Transcript } from "@/components/Transcript";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";

/** One stored record: the stamp, the judge's brief, outcomes, attestation, consensus, findings, evidence, money flow, transcript. */
export default async function AuditRecord({ params }: { params: Promise<{ digest: string }> }) {
  const { digest } = await params;
  if (!/^[0-9a-f]{64}$/.test(digest)) notFound();
  const res = await fetch(`${serverApi()}/verdicts/${digest}`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) notFound();
  const raw = (await res.json()) as Verdict;
  const v = normalise(raw);
  const m = v.evidence.market;
  const outcomes = v.outcomes ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mono text-xs text-fg-3 flex flex-wrap gap-3"><Link href="/audit" className="hover:text-fg">← audit</Link><span>record</span><span className="text-fg">{short(digest, 12)}</span>{v.stored && <span>stored {new Date(v.stored.at * 1000).toISOString().slice(0, 19).replace("T", " ")}Z{v.stored.auditSeq != null ? ` · seq ${v.stored.auditSeq}` : ""}</span>}</div>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <div className="mono text-fg-3 break-all">{m?.name ?? ""} {m?.symbol ? `· ${m.symbol}` : ""} · <a className="hover:text-fg" href={solscan(v.mint)} target="_blank" rel="noreferrer">{v.mint}</a></div>
          <h1 className={`display text-[clamp(56px,12vw,180px)] band-${v.verdict}`}>{WORD[v.verdict]}</h1>
        </div>
        <div className="display-num md:text-right"><div className="text-5xl">{v.riskScore}<span className="text-fg-4 text-2xl">/100</span></div><div className="text-fg-3 mt-1">confidence {v.confidence.toFixed(2)}</div></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 pill pill-ghost text-xs mono pill-wrap">judged in {(v.timing.totalMs / 1000).toFixed(1)}s · {v.findings.length} agents · {v.vetoes.length} veto{v.vetoes.length === 1 ? "" : "es"} · {v.consensus.debateRounds} debate · {v.flags.length} flags</span>
        {outcomes.length > 0 && <OutcomeChips outcomes={outcomes} riskScore={v.riskScore} />}
      </div>
      {v.vetoes.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{v.vetoes.map(x => <span key={x.code} className="pill pill-red h-8 text-xs mono" title={x.message}>VETO · {x.code} · {x.agent}</span>)}</div>}

      <div className="mt-10"><JudgeBrief v={v} scorecard={false} /></div>

      <Section title="OUTCOMES" copy="Graded at fixed horizons after the call. A rug is liquidity down more than 99%, no trades left, the labels of arXiv:2608.20271, or a pool under 1% of market cap. Each grade is written next to the record on Concordium and never edited.">
        <OutcomeTable outcomes={outcomes} riskScore={v.riskScore} />
      </Section>

      <Section title="ATTESTATION">
        <dl className="grid gap-3 md:grid-cols-2 mono text-xs">
          <Row k="digest sha256" v={v.attestation.digest} />
          <Row k="observed at" v={new Date(v.at * 1000).toISOString()} />
          <Row k="Concordium record" v={v.attestation.concordiumTx ? <a className="text-fg hover:text-red" href={ccdscanTx(v.attestation.concordiumTx)} target="_blank" rel="noreferrer">{v.attestation.concordiumTx} ↗</a> : <span className="text-fg-4">anchor pending</span>} />
          <Row k="agent registry" v={v.attestation.agentRegistry ?? <span className="text-fg-4">pending</span>} />
          <Row k="models" v={`${v.models.specialist} · ${v.models.judge} · ${v.models.engine}`} />
          <Row k="timing" v={`agents ${(v.timing.agentsMs / 1000).toFixed(1)}s · judge ${(v.timing.judgeMs / 1000).toFixed(1)}s · total ${(v.timing.totalMs / 1000).toFixed(1)}s`} />
          {v.attestation.signature && <Row k={`signature ${v.attestation.signature.alg}`} v={<span className="break-all">{short(v.attestation.signature.signature, 32)}</span>} />}
          {v.attestation.signature && <Row k="public key" v={<span className="break-all">{short(v.attestation.signature.publicKey, 32)}</span>} />}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {v.attestation.signature && <VerifySignature verdict={{ mint: v.mint, verdict: v.verdict, riskScore: v.riskScore, at: v.at, attestation: { digest: v.attestation.digest } }} signature={v.attestation.signature} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/?mint=${v.mint}&fresh=1&n=${v.at}`} className="pill pill-ghost">Re-run fresh</Link>
          <CopyButton text={JSON.stringify(raw, null, 2)} label="Copy record JSON" />
        </div>
      </Section>

      <Section title="CONSENSUS">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mono text-xs">
          <Stat k="weighted mean" v={String(v.consensus.weightedScore)} /><Stat k="spread" v={String(v.consensus.spread)} /><Stat k="suggested" v={WORD[v.consensus.suggestedBand]} /><Stat k="debate rounds" v={String(v.consensus.debateRounds)} /><Stat k="completeness" v={v.consensus.completeness.score.toFixed(2)} />
        </div>
        <div className="mt-3 mono text-xs text-fg-3">rule {v.consensus.rule} · judge {v.judge.model} · {(v.judge.ms / 1000).toFixed(1)}s</div>
        {v.judge.overridden.length > 0 && <ul className="mt-3 mono text-xs text-fg-3 space-y-1">{v.judge.overridden.map((o, i) => <li key={i}>rule override: {o}</li>)}</ul>}
        {v.consensus.debated.length > 0 && <div className="mt-3 mono text-xs text-fg-3">debated: {v.consensus.debated.join(", ")}</div>}
        {v.consensus.failed.length > 0 && <div className="mt-3 mono text-xs text-red">failed: {v.consensus.failed.join(", ")}</div>}
        {v.consensus.completeness.missing.length > 0 && <div className="mt-3 mono text-xs text-fg-3">missing data: {v.consensus.completeness.missing.join("; ")}</div>}
      </Section>

      <Section title="FINDINGS">
        <FindingCards v={v} />
        <div className="mt-3"><ConnectionGraph v={v} /></div>
      </Section>

      <Section title="EVIDENCE">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mono text-xs">
          <Stat k="top-10 holders" v={`${v.evidence.holders.top10Pct}% · ${v.evidence.holders.count} holders`} /><Stat k="snipers" v={`bought ${v.evidence.snipers.boughtPct}% · hold ${v.evidence.snipers.holdingPct}%`} /><Stat k="bundled" v={`${v.evidence.bundles.boughtPct}% · ${v.evidence.bundles.groups} groups · ${v.evidence.bundles.wallets} wallets`} /><Stat k="linked wallets" v={`${v.evidence.linked.linkedPct}% · creator ${v.evidence.linked.linkedToCreatorPct}% · ${v.evidence.linked.checked} checked`} />
          {m && <><Stat k="liquidity" v={usd(m.liquidityUsd)} /><Stat k="fdv" v={usd(m.fdvUsd)} /><Stat k="24h volume" v={usd(m.volume24hUsd)} /><Stat k="pools" v={`${m.pairs} · ${m.topVenue ?? "?"}`} /></>}
          {v.evidence.creator && <Stat k="creator" v={`${v.evidence.creator.address ? short(v.evidence.creator.address, 6) : "unknown"} · ${v.evidence.creator.status}`} />}
        </div>
        {v.evidence.linked.clusters.length > 0 && (
          <div className="mt-4 rounded-2xl border border-line-2 p-4">
            <div className="display text-xs mb-3">FUNDING CLUSTERS</div>
            {v.evidence.linked.clusters.map(c => (
              <div key={c.funder} className="mono text-xs flex flex-wrap items-center gap-2 py-1 border-t border-line first:border-0">
                <span className={c.viaCreator ? "text-red" : "text-fg"}>{c.viaCreator ? "creator" : short(c.funder, 5)}</span><span className="text-fg-4">→</span>
                {c.wallets.map(w => <span key={w} className="pill pill-ghost h-6 text-[10px]">{short(w, 4)}</span>)}
                <span className="ml-auto display-num">{c.pct}%</span>
              </div>
            ))}
          </div>
        )}
        {v.evidence.flows && v.evidence.flows.trails.length > 0 && <div className="mt-4"><MoneyFlow flows={v.evidence.flows} creator={v.evidence.creator?.address} limit={20} /></div>}
        {v.flags.length > 0 && <div className="mt-3 flex flex-wrap gap-2 mono text-[11px]">{v.flags.map(f => <span key={f.code} className={`pill h-7 ${f.severity === "critical" ? "pill-red" : "pill-ghost"}`} title={f.message}>{f.code}</span>)}</div>}
      </Section>

      {v.timeline.length > 0 && (
        <Section title="TRANSCRIPT" copy="Every event the swarm emitted during this run, in order. Replay types them back at ten times real speed.">
          <Transcript lines={v.timeline} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, copy, children }: { title: string; copy?: string; children: React.ReactNode }) {
  return <section className="mt-12"><div className="display text-sm text-red mb-2">{title}</div>{copy && <p className="text-sm text-fg-3 mb-4 max-w-3xl">{copy}</p>}<div className={copy ? "" : "mt-4"}>{children}</div></section>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="rounded-xl border border-line p-3 min-w-0"><dt className="text-fg-4">{k}</dt><dd className="mt-1 text-fg break-all">{v}</dd></div>;
}
function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl border border-line p-3"><div className="text-fg-4">{k}</div><div className="display-num text-base text-fg mt-1">{v}</div></div>;
}
