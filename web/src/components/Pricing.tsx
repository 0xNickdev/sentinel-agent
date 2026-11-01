"use client";
import { useEffect, useState } from "react";
import { getJSON, type AgentsResponse } from "@/lib/api";
import { CopyButton } from "./CopyButton";

/** x402: the 402 panel and the three ways in. Sentinel's column is outlined red. */
export function Pricing() {
  const [price, setPrice] = useState<string>("1 CCD");
  const [payTo, setPayTo] = useState<string>("<owner account>");
  useEffect(() => { getJSON<AgentsResponse>("/api/agents").then(a => { if (a.price) { setPrice(`${Number(a.price.microCcd) / 1e6} CCD`); setPayTo(a.price.payTo); } }).catch(() => undefined); }, []);
  const req = `POST /x402/verdict HTTP/1.1\nContent-Type: application/json\n\n{"mint":"Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"}`;
  const res402 = `HTTP/1.1 402 Payment Required\nPAYMENT-REQUIRED: base64({\n  "x402Version": 2,\n  "accepts": [{ "scheme": "exact", "network": "ccd:testnet",\n                "amount": "1000000", "asset": "CCD",\n                "payTo": "${payTo.slice(0, 12)}…", "extra": { "feePayer": "<sponsor>" } }]\n})`;
  const res200 = `HTTP/1.1 200 OK\nPAYMENT-RESPONSE: base64({ "success": true, "transaction": "<concordium tx>" })\n\n{ "verdict": "RUGGED", "riskScore": 88, "confidence": 0.7, ... }`;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid gap-3">
        {[
          { name: "MCP", who: "Claude, GPT, any MCP client", how: `tools/call sentinel_verdict · ${price}`, hi: true },
          { name: "A2A", who: "agents speaking A2A v1.0", how: "SendMessage with a mint → Task with the verdict artifact" },
          { name: "HTTP", who: "bots and scripts", how: `POST /x402/verdict · ${price}` },
        ].map(p => (
          <div key={p.name} className={`rounded-2xl border p-5 ${p.hi ? "border-red" : "border-line-2"}`}>
            <div className="flex items-baseline justify-between"><div className="display text-2xl">{p.name}</div><div className="display-num text-red">{price}</div></div>
            <div className="mt-1 text-sm text-fg-3">{p.who}</div>
            <div className="mt-3 mono text-xs text-fg-2">{p.how}</div>
          </div>
        ))}
        <p className="text-sm text-fg-3">Payments settle on Concordium as sponsored transactions: the paying agent never needs CCD for fees, only for the price. Discovery, badge checks and audit lookups are free.</p>
      </div>
      <div className="rounded-2xl border border-line-2 bg-bg-1 overflow-hidden">
        <div className="flex items-center justify-between px-4 h-10 border-b border-line mono text-xs text-fg-3"><span>x402 handshake</span><CopyButton text={`${req}\n\n${res402}\n\n${res200}`} /></div>
        <pre className="p-4 mono text-[12px] leading-5 overflow-x-auto text-fg-2">{req}{"\n\n"}<span className="text-red">{res402}</span>{"\n\n"}<span className="text-fg">{res200}</span></pre>
      </div>
    </div>
  );
}
