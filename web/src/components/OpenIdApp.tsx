"use client";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

const STORE = { ios: "https://apps.apple.com/ca/app/concordium-id/id6746754485", android: "https://play.google.com/store/apps/details?id=com.idwallet.app" };

/** /verify/open?uri=wc:…  The QR lands here on the phone; we hand the WalletConnect pairing to the Concordium ID App. */
export function OpenIdApp() {
  const uri = useSearchParams().get("uri") ?? "";
  const ok = uri.startsWith("wc:");
  const deep = useMemo(() => `concordiumidapp://wc?uri=${encodeURIComponent(uri)}`, [uri]);
  useEffect(() => { if (ok) window.location.href = deep; }, [ok, deep]);
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="display text-red text-sm">VERIFIED CREATORS</div>
      <h1 className="display text-5xl mt-2">OPEN CONCORDIUM ID</h1>
      {ok ? (
        <>
          <p className="text-fg-2 mt-6">Approve the connection in the Concordium ID App, then approve the age proof. Return to your computer: Sentinel finishes there.</p>
          <a href={deep} className="pill mt-8 inline-flex">Open Concordium ID</a>
          <p className="mono text-xs text-fg-4 mt-8">No app? <a className="underline" href={STORE.ios}>App Store</a> · <a className="underline" href={STORE.android}>Google Play</a></p>
        </>
      ) : <p className="text-fg-3 mt-6 mono text-sm">This link needs a WalletConnect pairing. Scan the QR on sentinelagent.pro/verify.</p>}
    </div>
  );
}
