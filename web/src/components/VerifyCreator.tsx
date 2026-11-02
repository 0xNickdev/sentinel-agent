"use client";
import { useEffect, useState } from "react";
import { API, ago, ccdscanTx, getJSON, short } from "@/lib/api";

// Wallet surfaces we touch, typed to the calls we make. No SDK in the bundle: the Concordium wallet takes the
// verification request as JSON and serialises it itself; Phantom only signs bytes.
interface Phantom { connect(): Promise<{ publicKey: { toString(): string } }>; signMessage(m: Uint8Array, enc?: string): Promise<{ signature: Uint8Array }> }
interface ConcordiumWallet { connect(): Promise<string | undefined>; requestVerifiablePresentationV1(request: unknown): Promise<{ toJSON?: () => unknown }> }
type W = Window & { phantom?: { solana?: Phantom }; solana?: Phantom; concordium?: ConcordiumWallet };

interface Proof { wallet: string; claims: string[]; verifiedAt: number; requestTx: string; auditTx: string; requestExplorer: string; auditExplorer: string }
interface RequestResponse { request: unknown; requestTx: string; requestExplorer: string; message: string; expiresAt: number }

// Concordium ID App over WalletConnect: the same session method the official verification-web-ui uses.
const WC_PROJECT = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const CCD_TESTNET = "ccd:4221332d34e1694168c2a0c0b3fd0f27";
const WC_METHOD = "request_verifiable_presentation_v1";
type SignClientT = Awaited<ReturnType<typeof import("@walletconnect/sign-client").SignClient.init>>;
let wcClient: Promise<SignClientT> | null = null;
const signClient = () => (wcClient ??= import("@walletconnect/sign-client").then(m => m.SignClient.init({
  projectId: WC_PROJECT,
  metadata: { name: "Sentinel", description: "Verified creator proof for Sentinel, the accountable anti-rug oracle", url: typeof window === "undefined" ? "https://sentinelagent.pro" : window.location.origin, icons: ["https://sentinelagent.pro/favicon.ico"] },
})));

/** Deep link that opens the Concordium ID App on the WalletConnect pairing, from a camera scan or a tap. */
export const idAppLink = (wcUri: string) => `concordiumidapp://wc?uri=${encodeURIComponent(wcUri)}`;
/** What the QR holds: an https page of ours that hands off to the ID App. Phone cameras ignore custom schemes. */
const qrLink = (wcUri: string) => `${process.env.NEXT_PUBLIC_QR_ORIGIN || window.location.origin}/verify/open?uri=${encodeURIComponent(wcUri)}`;

/** The ID App may answer with the presentation itself, a JSON string, or a wrapper holding it. */
function presentationOf(r: unknown): unknown {
  const v = typeof r === "string" ? JSON.parse(r) : r;
  if (v && typeof v === "object" && "verifiablePresentationJson" in v) return presentationOf((v as { verifiablePresentationJson: unknown }).verifiablePresentationJson);
  if (v && typeof v === "object" && "verifiablePresentation" in v) return presentationOf((v as { verifiablePresentation: unknown }).verifiablePresentation);
  return v;
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

async function concordiumWallet(timeoutMs = 2500): Promise<ConcordiumWallet | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const c = (window as W).concordium;
    if (c) return c;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = [
  { k: "SOLANA", t: "Connect the creator wallet", d: "The Solana wallet that launched your tokens. Sentinel matches it to the fee payer of each mint's first transaction." },
  { k: "ANCHOR", t: "Sentinel anchors a request", d: "A Verify and Access request (age 18+ from a Concordium identity provider) bound to your wallet, written to Concordium as a CCDVRA." },
  { k: "SIGN", t: "Sign the challenge", d: "Your Solana wallet signs a message naming that anchor. No transaction, no fee." },
  { k: "PROVE", t: "Prove with Concordium ID", d: "Your Concordium wallet answers with a zero-knowledge proof. Your birth date, name and documents never leave it." },
  { k: "AUDIT", t: "Verified and anchored", d: "Sentinel checks both proofs and anchors the audit record (CCDVAA). Every verdict on your tokens now says a verified human stands behind them." },
];

/** /verify: bind a Solana creator wallet to a Concordium ID zero-knowledge proof. */
export function VerifyCreator() {
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [req, setReq] = useState<RequestResponse | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<{ wallet: string; verified: boolean; proof: Proof | null } | null>(null);
  const [list, setList] = useState<Proof[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [qr, setQr] = useState<{ img: string; uri: string } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => { getJSON<{ enabled: boolean; proofs: Proof[] }>("/id/proofs").then(r => { setList(r.proofs); setEnabled(r.enabled); }).catch(() => setList([])); }, [proof]);

  const run = async (f: () => Promise<void>) => { setErr(null); setBusy(true); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const connectSolana = () => run(async () => {
    const p = (window as W).phantom?.solana ?? (window as W).solana;
    if (!p) throw new Error("No Solana wallet found. Install Phantom (or a wallet that injects window.solana) and reload.");
    const r = await p.connect();
    const w = r.publicKey.toString();
    setWallet(w);
    const existing = await getJSON<{ verified: boolean; proof: Proof | null }>(`/id/creator/${w}`).catch(() => null);
    if (existing?.verified && existing.proof) { setProof(existing.proof); setStep(4); return; }
    setStep(1);
  });

  const anchor = () => run(async () => {
    const res = await fetch(`${API}/id/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) });
    const j = await res.json() as RequestResponse & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    setReq(j); setStep(2);
  });

  const signChallenge = () => run(async () => {
    const p = (window as W).phantom?.solana ?? (window as W).solana;
    if (!p || !req) throw new Error("Solana wallet disconnected");
    const { signature } = await p.signMessage(new TextEncoder().encode(req.message), "utf8");
    setSig(hex(signature)); setStep(3);
  });

  const submit = async (presentation: unknown, r: RequestResponse | null = req, sg: string | null = sig) => {
    if (!r || !sg) throw new Error("start again");
    const res = await fetch(`${API}/id/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestTx: r.requestTx, presentation, solanaSignature: sg }) });
    const j = await res.json() as { verified: boolean; proof?: Proof; error?: string };
    if (!res.ok || !j.verified || !j.proof) throw new Error(j.error ?? `HTTP ${res.status}`);
    setProof(j.proof); setStep(4);
  };

  const prove = () => run(async () => {
    if (!req || !sig) throw new Error("start again");
    const c = await concordiumWallet();
    if (!c) throw new Error("No Concordium wallet found. Install the Concordium Wallet for Web, add a testnet identity, then reload.");
    await c.connect();
    const vp = await c.requestVerifiablePresentationV1(req.request);
    await submit(presentationOf(typeof vp?.toJSON === "function" ? vp.toJSON() : vp));
  });

  // ID App: pair first, then anchor a request whose ConnectionID is the WalletConnect session topic (that is how the
  // app finds the request), then sign that request with the Solana wallet, then ask the app for the proof.
  const proveWithIdApp = () => run(async () => {
    if (!wallet) throw new Error("connect the Solana wallet first");
    if (!WC_PROJECT) throw new Error("WalletConnect is not configured on this site (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID).");
    const p = (window as W).phantom?.solana ?? (window as W).solana;
    if (!p) throw new Error("Solana wallet disconnected");
    const client = await signClient();
    const { uri, approval } = await client.connect({ optionalNamespaces: { ccd: { methods: [WC_METHOD], chains: [CCD_TESTNET], events: [] } } });
    if (!uri) throw new Error("WalletConnect returned no pairing URI");
    const QR = await import("qrcode");
    // The QR holds an https hand-off page (phone cameras ignore custom schemes); the tap link uses the app scheme directly.
    setQr({ uri: idAppLink(uri), img: await QR.toDataURL(qrLink(uri), { margin: 1, width: 280, color: { dark: "#000000", light: "#ffffff" } }) });
    let topic: string | null = null;
    try {
      const session = await approval();
      topic = session.topic;
      setQr(null);
      // Send the request to the app as soon as it is anchored: the app is waiting on the pairing screen.
      setPhase("Anchoring the request on Concordium (about 10 s). Keep the ID App open.");
      const res = await fetch(`${API}/id/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, connectionId: topic }) });
      const r = await res.json() as RequestResponse & { error?: string };
      if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`);
      setReq(r); setStep(2);
      setPhase("Approve the age proof in the Concordium ID App.");
      const vp = await client.request({ topic, chainId: CCD_TESTNET, request: { method: WC_METHOD, params: r.request as object } });
      setPhase("Last step: sign the challenge in your Solana wallet.");
      const { signature } = await p.signMessage(new TextEncoder().encode(r.message), "utf8");
      const sg = hex(signature);
      setSig(sg); setStep(3);
      setPhase("Verifying and anchoring the audit record…");
      await submit(presentationOf(vp), r, sg);
    } finally {
      setQr(null); setPhase(null);
      if (topic) client.disconnect({ topic, reason: { code: 6000, message: "done" } }).catch(() => undefined);
    }
  });

  const check = () => run(async () => {
    const w = lookup.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) throw new Error("not a Solana address");
    setFound(await getJSON(`/id/creator/${w}`));
  });

  const action = [
    { label: "Connect Solana wallet", go: connectSolana },
    { label: "Anchor the request", go: anchor },
    { label: "Sign the challenge", go: signChallenge },
    { label: "Prove with Concordium ID", go: prove },
  ][step];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="display text-red text-sm">VERIFIED CREATORS</div><h1 className="display text-[clamp(40px,7vw,96px)]">STAND BEHIND IT</h1></div>
        <p className="text-fg-2 max-w-md">Launching a token? Bind your creator wallet to a Concordium ID zero-knowledge proof: a real person, 18+, from a regulated identity provider. Sentinel stores no name, no date, no document. Only that the proof verified, and the two Concordium anchors anyone can check.</p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr] items-start [&>*]:min-w-0">
        <div className="rounded-2xl border border-line-2 p-5 sm:p-6">
          <ol className="space-y-5">
            {STEPS.map((s, i) => {
              const done = i < step || (i === 4 && step === 4), cur = i === step && step < 4;
              return (
                <li key={s.k} className="grid grid-cols-[auto_1fr] gap-4">
                  <span className={`display-num text-lg w-9 h-9 rounded-full inline-flex items-center justify-center border ${done ? "bg-fg text-black border-fg" : cur ? "border-red text-red" : "border-line-2 text-fg-4"}`}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3"><span className="display text-xs text-fg-4">{s.k}</span><span className={done || cur ? "text-fg" : "text-fg-3"}>{s.t}</span></div>
                    <p className="text-sm text-fg-3 mt-1">{s.d}</p>
                    {i === 0 && wallet && <div className="mono text-xs text-fg-2 mt-2 break-all">{wallet}</div>}
                    {i === 1 && req && <a className="mono text-xs text-fg-2 hover:text-fg underline decoration-line-2 mt-2 inline-block" href={req.requestExplorer} target="_blank" rel="noreferrer">CCDVRA {short(req.requestTx, 8)} ↗</a>}
                    {i === 2 && sig && <div className="mono text-xs text-fg-2 mt-2">ed25519 {short(sig, 10)}</div>}
                    {i === 4 && proof && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a className="pill" href={proof.auditExplorer} target="_blank" rel="noreferrer">Audit anchor ↗</a>
                        <a className="pill-ghost pill" href={proof.requestExplorer} target="_blank" rel="noreferrer">Request anchor ↗</a>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 pt-5 border-t border-line flex flex-wrap items-center gap-3">
            {action ? (
              <>
                <button onClick={action.go} disabled={busy || !enabled} className="pill disabled:opacity-50">{busy ? "Working…" : step === 3 ? "Browser wallet" : step >= 1 ? `${action.label} · browser wallet` : action.label}</button>
                {step >= 1 && <button onClick={proveWithIdApp} disabled={busy || !enabled} className="pill pill-ghost disabled:opacity-50">Concordium ID App · QR</button>}
              </>
            ) : (
              <span className="display text-red">VERIFIED HUMAN CREATOR</span>
            )}
            {step === 1 && <span className="mono text-xs text-fg-4">about 10 s: waits for Concordium finalization</span>}
            {step >= 1 && <span className="mono text-xs text-fg-4 basis-full">ID App: scan once, then approve in Phantom and in the app; Sentinel anchors the request for that session.</span>}
            {!enabled && <span className="mono text-xs text-red">creator proofs are off on this server</span>}
          </div>
          {qr && (
            <div className="mt-5 rounded-2xl border border-line-2 p-5 flex flex-col sm:flex-row items-center gap-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.img} alt="WalletConnect QR code for the Concordium ID App" width={200} height={200} className="rounded-xl bg-white p-2 shrink-0" />
              <div className="min-w-0">
                <div className="display text-xs text-red">SCAN WITH CONCORDIUM ID APP</div>
                <p className="text-sm text-fg-3 mt-2">Scan with your phone camera (or the scanner in the Concordium ID App), approve the connection, then approve the age proof. The app proves 18+ without revealing your birth date.</p>
                <a href={qr.uri} className="mono text-xs text-fg-2 underline decoration-line-2 mt-3 inline-block sm:hidden">open on this phone</a>
              </div>
            </div>
          )}
          {phase && <div className="mt-4 rounded-xl border border-line-2 p-3 mono text-xs text-fg-2"><span className="text-red">●</span> {phase}</div>}
          {err && <div className="mt-4 rounded-xl border border-red p-3 mono text-xs text-red break-words">{err}</div>}
        </div>

        <div className="space-y-8">
          <div>
            <div className="display text-sm text-red mb-4">CHECK A CREATOR</div>
            <div className="rounded-2xl border border-line-2 p-4">
              <div className="flex gap-2">
                <input value={lookup} onChange={e => setLookup(e.target.value)} onKeyDown={e => e.key === "Enter" && check()} placeholder="Solana wallet address" className="flex-1 min-w-0 h-10 rounded-full bg-bg-1 border border-line-2 px-4 mono text-sm outline-none focus:border-fg-3" />
                <button onClick={check} className="pill-ghost pill shrink-0">Check</button>
              </div>
              {found && (
                <div className="mt-3 mono text-xs">
                  {found.verified && found.proof
                    ? <span className="text-fg">verified human · {found.proof.claims.join(", ")} · {ago(found.proof.verifiedAt)} · <a className="underline decoration-line-2" href={ccdscanTx(found.proof.auditTx)} target="_blank" rel="noreferrer">audit ↗</a></span>
                    : <span className="text-fg-3">no Concordium ID proof for {short(found.wallet, 6)}</span>}
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="display text-sm text-red mb-4">VERIFIED CREATOR WALLETS</div>
            <div className="rounded-2xl border border-line-2 p-4 tt-wrap">
              <table className="tt">
                <thead><tr><th>wallet</th><th>claim</th><th>when</th><th>audit</th></tr></thead>
                <tbody>
                  {list && list.length === 0 && <tr><td colSpan={4} className="text-fg-4">none yet · be the first</td></tr>}
                  {!list && <tr><td colSpan={4} className="text-fg-4">loading</td></tr>}
                  {(list ?? []).map(p => (
                    <tr key={p.wallet} className="row">
                      <td className="text-fg">{short(p.wallet, 5)}</td>
                      <td className="text-fg-3">{p.claims.join(", ")}</td>
                      <td className="text-fg-3">{ago(p.verifiedAt)}</td>
                      <td><a className="text-fg-2 hover:text-fg" href={ccdscanTx(p.auditTx)} target="_blank" rel="noreferrer">{short(p.auditTx, 5)} ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-2xl border border-line p-4 text-sm text-fg-3">
            <div className="display text-xs text-fg-4 mb-2">WHAT IT MEANS</div>
            A verified human is accountable, not automatically honest. The Creator agent weighs it as a strong positive for accountability; it never cancels a sell-off, an insider ring or a pullable pool.
          </div>
        </div>
      </div>
    </div>
  );
}
