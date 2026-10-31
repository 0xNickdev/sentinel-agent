"use client";
import { useState } from "react";

/** Verify the ML-DSA-65 signature in the browser: fetch the published key, hash, verify. Nothing leaves the page. */
export function VerifySignature({ verdict, signature }: { verdict: { mint: string; verdict: string; riskScore: number; at: number; attestation: { digest: string } }; signature: { alg: string; publicKey: string; signature: string } }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "bad" | "unknown-key">("idle");
  const [err, setErr] = useState<string | null>(null);
  async function verify() {
    setState("busy"); setErr(null);
    try {
      const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js");
      const keys = await fetch("/sentinel/.well-known/sentinel-keys.json").then(r => r.json()).catch(() => null) as { attestation?: { publicKey: string } } | null;
      const msgText = `${verdict.attestation.digest}|${verdict.mint}|${verdict.verdict}|${verdict.riskScore}|${verdict.at}`;
      const msg = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msgText)));
      const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map(b => parseInt(b, 16)));
      const ok = ml_dsa65.verify(hex(signature.signature), msg, hex(signature.publicKey), { context: new TextEncoder().encode("sentinel.verdict/1") });
      if (!ok) return setState("bad");
      setState(keys?.attestation?.publicKey && keys.attestation.publicKey !== signature.publicKey ? "unknown-key" : "ok");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setState("bad"); }
  }
  const msg = { idle: "", busy: "verifying…", ok: "signature valid · key matches /.well-known/sentinel-keys.json", bad: "SIGNATURE INVALID", "unknown-key": "valid, but signed by a different key than the one published" }[state];
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      <button type="button" onClick={verify} disabled={state === "busy"} className="act">[{state === "busy" ? "verifying" : "verify"}]</button>
      <span className="text-fg-4">{signature.alg} (FIPS 204) · sha256(digest ‖ mint ‖ verdict ‖ score ‖ at) · ctx sentinel.verdict/1</span>
      {msg && <span className={state === "ok" ? "text-fg" : "text-red"}>{msg}</span>}
      {err && <span className="text-red">{err}</span>}
    </span>
  );
}
