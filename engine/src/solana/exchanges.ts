// Known exchange hot wallets and launchpad launcher wallets on Solana, with
// their public sources (engine/data/exchanges.json, ported from the owner's
// aiagentzoo X-Ray engine). A funder found here is named ("funded from
// Binance") and never ties wallets together: it is everyone's wallet.
import { readFileSync } from 'node:fs';

interface Entry { address: string; exchange: string; label?: string }

let byAddress: Map<string, Entry> | null = null;
function load(): Map<string, Entry> {
  if (byAddress) return byAddress;
  byAddress = new Map();
  try {
    const raw = JSON.parse(readFileSync(new URL('../../data/exchanges.json', import.meta.url), 'utf8')) as { addresses?: Entry[] };
    for (const e of raw.addresses ?? []) if (e.address && e.exchange) byAddress.set(e.address, e);
  } catch { /* no list: every funder stays unnamed */ }
  return byAddress;
}

/** Launchpads whose launcher wallet funds every creator they onboard; like an exchange, it ties no one together. */
const LAUNCHERS: Record<string, string> = {
  '49CfXAr58cCTGJnYsbm16fEsE5JRpdR8QQP8E1ZinGCq': 'ClawPump',
};

/** The exchange or launcher a wallet belongs to, when it is a known shared wallet. */
export function exchangeOf(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  return load().get(wallet)?.exchange ?? LAUNCHERS[wallet] ?? null;
}
export const knownExchangeCount = () => load().size;
