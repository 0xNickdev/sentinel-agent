"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AGENTS, ccdscanTx, getJSON, short, type AgentsResponse } from "@/lib/api";

const JUDGE = { id: "judge", name: "Judge", movement: "stamp", domain: "Weighs the seven under the consensus rule: veto, weighted mean, one debate round, an advocate for the other side" };
const GATEWAY = { id: "gateway", name: "Sentinel", movement: "door", domain: "The entry point other agents call: MCP, A2A and x402 surface of the swarm. Its Agent Card is the one pinned in the registry" };

/** Bento of the agents with their Verified by Concordium badge pills and registry data. compact: the seven specialists and the judge (home); full: plus the gateway (agents page). */
export function AgentCards({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  useEffect(() => { getJSON<AgentsResponse>("/api/agents").then(setData).catch(() => undefined); }, []);
  const byKey = new Map(data?.agents.map(a => [a.key, a]));
  const list = compact ? [...AGENTS, JUDGE] : [GATEWAY, JUDGE, ...AGENTS];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((a, i) => {
        const reg = byKey.get(a.id);
        const span = a.id === "judge" ? "sm:col-span-2" : a.id === "gateway" ? "sm:col-span-2 lg:col-span-1" : "";
        return (
          <motion.article key={a.id} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ duration: 0.7, delay: Math.min(i, 6) * 0.07, ease: [0.16, 1, 0.3, 1] }} whileHover={{ rotateX: 2, rotateY: -2 }} className={`group relative rounded-2xl border bg-bg-1 p-5 flex flex-col ${a.id === "gateway" ? "border-red/60" : "border-line-2"} ${span}`}>
            <div className="flex items-start justify-between">
              <div className="display text-3xl text-fg-3 group-hover:text-fg transition-colors">{String(i + 1).padStart(2, "0")}</div>
              <span className="mono text-[11px] text-fg-4 flex items-center gap-2">{a.movement}<span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" aria-hidden="true" /></span>
            </div>
            <h3 className="display text-xl mt-6">{a.name.toUpperCase()}</h3>
            <p className="mt-2 text-sm text-fg-2">{a.domain}</p>
            {!compact && reg && <p className="mt-1 text-xs text-fg-3">{reg.role}</p>}
            <div className="mt-5 flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-2 pill text-xs h-8" title={reg?.badge ? `badge ${reg.badge}` : "registration pending"}><span className="dot" /> Verified by Concordium</span>
              <span className="mono text-[11px] text-fg-4">{reg?.badge ? `#${reg.tokenId} · ${short(reg.badge, 6)}` : `${data?.network ?? "testnet"} · pending`}</span>
            </div>
            {!compact && reg && (
              <div className="mt-3 flex flex-wrap gap-2 mono text-[11px] relative z-10">
                <a className="pill pill-ghost h-6 text-[10px]" href={reg.card} target="_blank" rel="noreferrer">Agent Card ↗</a>
                {reg.badgeCheck && <a className="pill pill-ghost h-6 text-[10px]" href={reg.badgeCheck} target="_blank" rel="noreferrer">Check badge ↗</a>}
                {reg.cardTx && <a className="pill pill-ghost h-6 text-[10px]" href={ccdscanTx(reg.cardTx)} target="_blank" rel="noreferrer">Card pinned ↗</a>}
                {reg.trackRecordTx && <a className="pill pill-ghost h-6 text-[10px]" href={ccdscanTx(reg.trackRecordTx)} target="_blank" rel="noreferrer">Track record on-chain ↗</a>}
              </div>
            )}
            {reg?.badgeCheck && <a className="absolute inset-0" href={reg.badgeCheck} target="_blank" rel="noreferrer" aria-label={`Check ${a.name} badge`} />}
          </motion.article>
        );
      })}
    </div>
  );
}
