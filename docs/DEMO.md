# Demo plan (video ≤ 3 min) and pre-flight

Everything the judges see must be real: live mainnet data, real model calls, real Concordium testnet transactions. Pre-warm what can be pre-warmed; never fake a wait.

## Script (2:50)

| t | Scene | What is on screen | What we say |
|---|---|---|---|
| 0:00–0:20 | The problem | LIBRA chart collapsing; "$107M taken in hours" | Every bot and agent trading memecoins needs a rug answer in seconds. Today it comes from anonymous scores nobody can audit or hold accountable. |
| 0:20–0:50 | Paste a token | Home page, paste a fresh pump.fun mint from the live launch feed, lanes light up | Six specialist agents read deterministic on-chain evidence; a judge rules. Watch them work. |
| 0:50–1:40 | The verdict | Verdict stamp, judge brief (headline, decisive fact, action), scorecard, advocate vs rebuttal, transcript replay | Facts are code, judgement is the model. The advocate argued the other side; the judge answered with numbers. |
| 1:40–2:15 | Accountable | Agent cards → click badge → Concordium Agent Registry check; audit record → CCDScan transaction; "Verify signature in browser" turns green | A verified human owns every agent. Every verdict is hashed into an append-only contract and signed post-quantum. |
| 2:15–2:40 | Agents pay agents | Terminal: MCP client demo buys a verdict: 402 → sponsored CCD payment → verdict JSON, CCDScan link to the payment | Any agent calls Sentinel over MCP or A2A and pays per verdict with x402 on Concordium, no API keys. |
| 2:40–2:50 | Close | Repo, site, path to production (CARPET as customer zero, mainnet registry, PLT stablecoin) | |

## Pre-flight (day of recording)

- [ ] `.env` complete: ANTHROPIC key, Helius RPC, Shyft gRPC, Concordium wallets (owner, submitter, sponsor, payer), `SENTINEL_PQ_SEED`, `SENTINEL_BASE_URL` (public https via tunnel), `SENTINEL_JUDGE_EFFORT=high`.
- [ ] Contract deployed, 8 agents registered, `cards/registry.json` and `cards/audit-contract.json` present, badges visible on /agents.
- [ ] Payer wallet funded with ≥ 50 CCD; sponsor ≥ 100 CCD; submitter ≥ 100 CCD.
- [ ] Snapshots pre-warmed for LIBRA and BONK (`SENTINEL_SEED_SNAPSHOTS`), plus two fresh pump.fun mints judged 10 minutes before recording (cache is 5 min: use `fresh=1` on camera only once).
- [ ] One full dry run of the MCP client demo and one A2A `SendStreamingMessage` from a second terminal.
- [ ] Browser: 1440×900, Chrome without wallet extensions (they log console errors), reduced motion off.
- [ ] Record the terminal with a dark theme and 16 px mono; keep the site and the terminal in one screen for the x402 scene.

## Fallbacks

- Helius 429 or slow RPC: the seeded snapshots answer instantly; the live feed still shows real launches.
- Facilitator finality slow (>15 s): keep talking over the CCDScan page; the verdict arrives when settlement finalises.
- Model refusal/fallback: the judge call carries `fallbacks: "default"`; the transcript will show the model that answered.

## The track beat (add after the audit explorer)

Open `/track` (or type `track` in the prompt). Say: "Every verdict you just saw is a probability sealed on Concordium before the outcome. The resolver re-reads the market at 1h, 24h and 7d, grades the outcome with published labels, and writes the grade beside the record. This is the Brier score, the skill against the base rate, the reliability diagram, and the same per specialist. Nobody else publishes this." Click a graded row: the grade anchor opens CCDScan on the `grade` transaction. Over MCP the same report is `sentinel_track`.
Pre-flight: run the server with the default horizons (`SENTINEL_RESOLVE_HORIZONS` unset) at least a day before the demo so 24h grades exist; the fresh launch judged live during the demo will show "…" until its first horizon, which is the honest state.
