#!/usr/bin/env node
// sentinel-guard <mint> [--quick|--full] [--max-ccd N] [--gateway URL] [--json]
// Exit code: 0 allow, 1 warn, 2 block — so a shell script or a bot can gate a buy on it.
// Pays for the full verdict when CONCORDIUM_PAYER_WALLET (or _ADDRESS + _KEY) is set.
import { createGuard, describe } from './index.js';
import { concordiumPayerFromEnv } from './concordium.js';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const mint = argv.find((a, i) => !a.startsWith('--') && !['--max-ccd', '--gateway'].includes(argv[i - 1] ?? ''));
if (!mint) { console.error('usage: sentinel-guard <mint> [--quick|--full] [--max-ccd N] [--gateway URL] [--json]'); process.exit(64); }
const network = process.env.CONCORDIUM_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const pay = concordiumPayerFromEnv('CONCORDIUM_PAYER', network);
const max = opt('--max-ccd');
const gateway = opt('--gateway') ?? process.env.SENTINEL_GATEWAY_URL;
const guard = createGuard({ network, ...(pay ? { pay } : {}), ...(max ? { maxPriceCcd: Number(max) } : {}), ...(gateway ? { gateway } : {}) });
const d = await guard.check(mint, { mode: flag('--full') ? 'full' : flag('--quick') ? 'quick' : 'auto' });
console.log(flag('--json') ? JSON.stringify(d, null, 2) : describe(d));
process.exit(d.action === 'allow' ? 0 : d.action === 'warn' ? 1 : 2);
