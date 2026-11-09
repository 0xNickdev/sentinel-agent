# Sentinel Guard

One call between a Solana trading agent and a buy: **allow**, **warn** or **block**, with the reason and an on-chain audit link.

```ts
import { createGuard } from '@sentinel/guard';
import { concordiumPayer } from '@sentinel/guard/concordium';

const guard = createGuard({ pay: concordiumPayer({ address, privateKeyHex }), maxPriceCcd: 2 });

const d = await guard.check(mint);   // { action: 'block', reason: 'DANGER on the free screen · liquidity_drained', … }
if (d.action !== 'allow') return;

// or wrap the buy itself: a block throws GuardBlockedError, the swap never runs
const safeBuy = guard.wrap(buy, (mint, amount) => mint);
```

## What it does, in order

1. **Checks who answers.** Reads Sentinel's Agent Card and confirms its *Verified by Concordium* badge with the Concordium Agent Registry: on-chain agent, active, owner, card hash. The badge must belong to the gateway being called, so a look-alike endpoint with someone else's badge is refused. A verified human stands behind the oracle, or the guard does not trust it.
2. **Screens for free.** `GET /quick/:mint`: mint and freeze authority, Token-2022 extensions, holders, liquidity, market shape. A hard red flag (live mint authority, drained pool) blocks here, and nothing is paid.
3. **Reuses a paid verdict.** If anyone bought a full verdict on this mint in the last hour, the guard decides on it.
4. **Pays for the full swarm only when needed.** Nine agents, about 1 CCD over x402 on Concordium; the payment is a sponsored transfer, so the agent never holds CCD for fees. An idempotency key means a retry is never charged twice; `maxPriceCcd` stops a price change from surprising the wallet. The verdict comes back signed (ML-DSA-65) and anchored in Concordium's audit trail.

It **fails closed**: an unverifiable oracle, a network error, an unreadable answer or a refused price is a `block`, never an `allow`. A clean free screen alone is a `warn`, because it does not read snipers, funding or the creator.

## Policy

```ts
createGuard({ policy: { block: ['DANGER', 'RUGGED'], minConfidence: 0.6, maxRisk: 40, quickSafe: 'warn', reuseFullSec: 3600 } });
```

`check(mint, { mode })`: `'auto'` (default) pays only when the free screen cannot decide, `'quick'` never pays, `'full'` always pays.

## Spending mandate

Limits a trading bot cannot talk itself out of, because they live in code, not in the prompt.

```ts
const guard = createGuard({ pay, mandate: { maxPerTrade: 0.5, maxPerDay: 2, onlyBands: ['SAFE'], expiresAt } });
const buy = guard.wrap(swap, (mint, sol) => mint, { amountOf: (mint, sol) => sol });
await buy(mint, 0.7);   // GuardBlockedError: buy of 0.7 is over the per-trade limit of 0.5 (no verdict was paid for)
```

Limits are checked before the token, so an over-limit buy never costs a verdict. The amount is reserved before the check, so concurrent buys cannot all slip under the same remaining limit; a blocked or failed buy releases it. `onlyBands` refuses buys backed only by the free screen. `guard.spent()` reports the rolling 24 h total.

## Guarantee

When the guard pays for a verdict that the gateway's guarantee covers, the decision says so (`d.guarantee`): a paid SAFE on a token that rugs within 24 h is refunded to the paying account automatically. Terms and every claim: [`/guarantee`](https://api.sentinelagent.pro/guarantee).

## ElizaOS

```ts
import { sentinelGuardPlugin, guardAction } from '@sentinel/guard/eliza';

// an action the agent can call: CHECK_TOKEN_RISK
plugins: [sentinelGuardPlugin(guard)]

// or put the guard in front of an existing swap action: blocked tokens are never bought
const guardedSwap = guardAction(swapAction, guard, { onWarn: d => d.riskScore !== null && d.riskScore < 30 });
```

Typed structurally against `@elizaos/core` 1.x, so it adds no dependency on it.

## CLI

```bash
sentinel-guard <mint> [--quick|--full] [--max-ccd 2] [--json]
# exit 0 allow · 1 warn · 2 block; pays when CONCORDIUM_PAYER_WALLET (or _ADDRESS + _KEY) is set
```

On testnet, 9 Nov 2026:

```
BLOCK Bo9jh3… DANGER on the free screen · liquidity_drained · oracle verified by Concordium (badge JyP9XuYWbM5LAuY1BXBRN)
ALLOW DezXAZ… SAFE · risk 20 · confidence 0.75 · audit https://sentinelagent.pro/audit/4db98c06… · oracle verified by Concordium
```

The first call was free and took a second. The second paid 1 CCD ([tx](https://testnet.ccdscan.io/transactions/6da3aa21096bf10ea8d9aa93fdae78732ed9a59c90a97c0852dc44fc58dda334)) and took about five minutes, because the swarm read BONK's history from scratch. A repeat within the hour reused that verdict in seven seconds.
