# Sentinel: competitors, data sources, rug signals, demo cases

Date: 2026-10-30. Confidence note: web search returned thin results (no official pricing pages for RugCheck, SolSniffer, GoPlus, Birdeye security; no 2026 rug coverage). Items marked [VERIFY] come from prior knowledge or third-party summaries. Check each before the demo, especially mint addresses and free-tier numbers.

## 1. Competitive landscape

| Tool | Signals computed | API / pricing | Misses | Agent-native? |
|---|---|---|---|---|
| RugCheck.xyz | Risk score + risk list (severity), mint/freeze authority, top holders %, LP lock/burn, creator balance, insider network graph, metadata mutability, Token-2022 extension flags | Public read endpoints reportedly keyless, 429s on bursts; bulk endpoints need JWT via wallet-sign auth ([community doc](https://termo.ai/skills/rugcheck), [swagger](https://api.rugcheck.xyz/swagger/index.html)). Resellers wrap it, e.g. [oanor](https://oanor.com/api/rugcheck-api) (free 100/mo, paid from about EUR12) | Single opaque score, no signed verdicts, no accountability, no cross-token creator-cluster history by default, static (not re-judged) | Partly: third-party MCP wrappers exist ([glama](https://glama.ai/mcp/servers/lx1112/token-safety-check)); no native agent payments |
| GoPlus Security | Honeypot, buy/sell tax, mint/freeze, transfer-fee, closable, holders, LP (Solana token API in Beta, SPL and SPL-2022, plus tx simulation) ([docs](https://docs.gopluslabs.io/)) | Tiered: Free, Test, Beginner, Growth, Pro, Ultra; amounts not retrieved [VERIFY] | Rule-based flags only, no behavioral/funding graph, Solana coverage shallower than EVM | API-first, no MCP/payments |
| SolSniffer | "Snifscore" from 20+ indicators ([comparison](https://madeonsol.com/compare/goplus-security-vs-solsniffer)) | Free tier + paid [VERIFY] | Score only, no provenance | API only |
| Token Sniffer | EVM-centric similarity/contract scan; weak on Solana | Free web, paid API | Not Solana-native | No |
| DEXTools / Dexscreener | DEXTools "audit" panel (mint, LP lock, taxes) and community score; Dexscreener shows liquidity, boosts, socials, tx counts; no verdict | Dexscreener public API free (about 300 rpm on pair endpoints) [VERIFY]; DEXTools paid | Descriptive not judgmental; paid boosts can mislead | API yes, no safety verdict |
| Bubblemaps | Holder cluster map, insider/connected wallets via transfers; famously exposed LIBRA clusters ([Cointelegraph](https://cointelegraph.com/news/libra-token-likely-tied-melania-memecoins-bubblemaps)) | Paid API / "Intel desk" [VERIFY]; no MCP found in search | Visual, human-read; no verdict, no recourse | API-ish, not agent-native |
| Birdeye security | `token_security` endpoint: ownership, mintable, freezable, top-holder concentration, mutable metadata ([docs](https://docs.birdeye.so/reference/get-defi-token_security)) | API key (`X-API-KEY`, `x-chain: solana`), compute-unit billing; free tier is small and security endpoints may be paid [VERIFY] | Flags, not graph/behavior | API-first, no verdict |
| Hapi | Address-level risk/AML labels (compliance), threat feeds | Enterprise | Not meme-token behavior | API |
| TrenchRadar and similar | Dev history, sniper/bundle dashboards, alerts [VERIFY] | Subscription | Dashboards for humans | No |
| pump.fun native | Creator/dev-holding display, bonding-curve progress, "graduated" status; mint/freeze are renounced by design, which hides rather than reduces risk | Frontend API unofficial/flaky | Bundles, snipers and team clusters not judged | No |
| Telegram bots (Rick, Soul Scanner, etc.) | Chat-based scan: authorities, top holders, bundle %, dev history, sniper count | Free/freemium | Heuristic, no audit trail, not callable by agents | No (human UI) |

### The gap Sentinel can own
1. **Accountability**: every incumbent emits an unsigned score. Sentinel's verdicts are signed by a verified operator identity and anchored to Concordium, so a wrong call is attributable and challengeable.
2. **Agent-native commerce**: pay-per-verdict (x402-style or Concordium-native payment) with a machine schema and MCP tool. Today's tools assume a human or an API-key subscription.
3. **Audit trail**: hash of the evidence bundle plus signal values and timestamps on-chain; verdict is re-checkable and trackable against outcome (rugged within N hours?). This gives a public track record, which no competitor publishes.
4. **Swarm consensus**: independent specialist agents (authority, holders, funding graph, creator history, liquidity) vote; disagreement is surfaced as a confidence value instead of hidden in a score.
5. **Funding-graph linked wallets**: trace first-funder chains (CEX hot wallet excluded) across top holders, snipers and creator across prior tokens. Bubblemaps shows this visually; nobody sells it as a verdict API.

## 2. Data sources (mainnet read-only)

- **Public RPC** (`api.mainnet-beta.solana.com`): heavily rate limited (about 100 req / 10 s per IP, 40 per method per 10 s, 40 connections [VERIFY]); `getProgramAccounts`/`getTokenLargestAccounts` often blocked or slow. Fine only as a fallback.
- **Helius** (primary): Free plan = 1M credits/month, 10 RPC req/s, 2 req/s for DAS and Enhanced APIs, webhooks up to 100k addresses ([rate limits](https://www.helius.dev/docs/billing/rate-limits), [plans](https://helius.dev/docs/billing/plans), per search summary, plans page dated 2026-04-07). Use `getAsset` (DAS: authorities, Token-2022 extensions, mutability), `getTokenAccounts` (holders, paginated), Enhanced Transactions `parsed` history (swaps, transfers), webhooks for new mints. 2 req/s DAS is the bottleneck: cache by mint and batch.
- **Shyft, QuickNode, Triton**: Shyft has a free tier with REST token/holder/tx endpoints [VERIFY]; QuickNode free endpoint is limited, add-ons paid; Triton is enterprise (skip for demo).
- **Birdeye API**: key required; good for OHLCV, holders, `token_security`, new listings; free tier too small for swarm fan-out [VERIFY]. Optional.
- **Jupiter**: Price API (Lite tier free, key-gated since 2025 [VERIFY]), token list/search and Strict list for verification flags; quote API free for liquidity/price-impact probing (sell-simulation proxy for honeypot).
- **DEX/pool reads**: pump.fun bonding curve account via RPC (PDA from mint, decode reserves, creator, `complete` flag); Raydium and Meteora pools via program accounts or Dexscreener `/latest/dex/tokens/{mint}` (free, no key) for pair addresses, liquidity, age. LP burn/lock: check LP mint supply vs burn address balance, and locker program (Streamflow, Meteora lock) holdings.
- **Solscan Pro / Solana FM**: Solscan public API now key/paid; Solana FM limited. Use only for human-facing explorer links.
- **RugCheck public API** as a cross-check/baseline signal (and as evaluation baseline to beat).

**Free-enough hackathon stack**: Helius free (DAS + enhanced tx) + public RPC fallback + Dexscreener (no key) + Jupiter quote + RugCheck public API as baseline. Pre-fetch and cache the 5 demo mints so the demo never hits limits.

Measured 2026-10-30: the RPC-only engine path (5 signature pages + 600 parsed txs + funder tracing) took 224–242 s per old, busy token on a Helius free key with two runs in parallel (429 back-off dominated). For young pump.fun mints the history is small and the launch window is real; for old tokens like BONK the "launch window" is just the oldest of the last 5000 signatures, so the sniper/bundle/creator figures describe a recent slice and the creator is wrong. Fix before the demo: snapshot cache + Helius DAS `getAsset` for creator/authorities, and a signature walk that stops early for old mints.

## 3. Canonical rug signals and how to compute them

| Signal | Compute | Practical threshold |
|---|---|---|
| Mint authority | Mint account `mintAuthority` != null (DAS `getAsset` or `getAccountInfo` parsed) | Any non-null = high risk (critical for non-pump tokens) |
| Freeze authority | `freezeAuthority` != null | Non-null = high risk (honeypot capable) |
| Top-10 concentration | `getTokenLargestAccounts`/DAS holders; exclude LP pool vaults, bonding curve, burn, known CEX | >30% warn, >50% critical; single non-LP holder >10% critical |
| Sniper buys | Buys in first N slots after pool creation (N = 2 to 5 slots, about 1-2 s) from fresh wallets | >=5 wallets or >15% supply in first 5 slots = flag |
| Bundled buys | Multiple wallets buying in same slot / same Jito bundle (tip transfer to a Jito tip account in tx, shared slot) | >=5 same-slot wallets or bundle holding >10% supply = flag |
| Shared funding | For top-N holders + snipers, find first SOL inflow source (parsed transfers); cluster by common funder within 24-48 h; exclude CEX hot wallets | Cluster holding >20% supply = critical (LIBRA: 82% in one cluster per [Bubblemaps](https://cointelegraph.com/news/libra-token-likely-tied-melania-memecoins-bubblemaps)) |
| Creator sold | Creator wallet token balance delta and sell txs since launch | Sold >50% of initial within first hour = critical; any dump pre-graduation = flag |
| Creator history | Prior mints by creator (pump.fun create ix by signer; Helius history) and their outcome (liquidity drop >90%, price -90%) | >=2 prior dead tokens = high risk; serial launcher >10/week = flag |
| LP burned/locked | LP token supply held by burn/locker vs total; pump.fun graduated pools to Raydium/PumpSwap burn LP by design | <80% burned/locked and not pump-graduated = high |
| Liquidity depth | Pool SOL reserves; Jupiter quote of 1-2% supply sell | <$10k liquidity or >20% price impact on small exit = flag |
| Metadata mutability | Metaplex `isMutable`, update authority | Mutable + non-null update authority = low/medium |
| Token-2022 extensions | `TransferFeeConfig` (fee >5% or withdraw authority), `PermanentDelegate`, `TransferHook`, `DefaultAccountState=Frozen`, `NonTransferable`, `ConfidentialTransfer` | PermanentDelegate or TransferHook or fee >10% = critical |
| Honeypot / sell sim | Jupiter quote sell route exists + `simulateTransaction` of a sell if feasible; check holders have ever sold (non-insider sells) | No sell route = critical |
| Social reuse | Hash image/name/links across tokens; same Twitter/Telegram/website on several mints; domain age | Reused handle on dead tokens = flag; no socials = low |
| Wash/volume | Unique traders vs tx count; self-trade loops | Few wallets generating most volume = flag |

**Evaluation data**: no canonical public labelled Solana rug dataset I could confirm [VERIFY]. Options: academic work on pump.fun rug pulls (search arXiv "pump.fun rug pull detection" and "Solana rug pull dataset"); RugCheck's own flagged `rugged` field as weak labels; Dune dashboards on pump.fun token outcomes; build labels yourself: token with liquidity drop >90% within 24 h or creator dump >80% = rug. Compare Sentinel verdicts against RugCheck baseline on 100-200 recent pump.fun mints.

## 4. Demo cases

Rugs / insider-driven collapses (verify on Solscan; mints from memory):
- **LIBRA** (Feb 2025), Milei-promoted. Team sniped at launch, insiders cashed out about $87M-$107M, 82% supply in one cluster, LP pulled via Meteora ([Cointelegraph](https://cointelegraph.com/news/milei-libra-token-scandal-107m-rug-pull), [TRM](https://trmlabs.com/post/the-libra-affair-tracking-the-memecoin-that-launched-a-scandal-in-argentina)). Mint `Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU` [VERIFY].
- **MELANIA** (Jan 2025), same launcher sniped ([Blockworks](https://www.blockworks.com/news/libra-memecoin-sausage-gross)). Mint `FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P` [VERIFY]. Good funding-graph case linking to LIBRA.
- **HAWK** (Dec 2024, edge of window): $500M to under $60M in 20 min ([KYM](https://knowyourmeme.com/memes/events/hawk-tuah-girls-hawk-meme-coin-rug-pull-scandal)); mint not confirmed, look it up.
- **YZY** (Aug 2025): 14 wallets tied to Hayden Davis bought one minute after launch ([The Block](https://www.theblock.co/news/ecosystems/2025-08-25-libra-token-facilitator-earns-12-million-sniping-kanye-west-memecoin-bubblemaps)); mint unconfirmed.
- 2026 rugs: none found by search; pull fresh ones from Dexscreener (new pairs, liquidity < 5% of peak) at demo time.

Contrast / clean (large, renounced authorities, deep liquidity):
- **BONK** `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`
- **WIF** `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`
- **JUP** `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`
- TRUMP `6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN` is a useful "gray" case (high insider/team concentration with locked vesting, not a rug).

## Recommendation

**10 signals to ship first** (all computable from Helius + Dexscreener + Jupiter):
1. Mint authority 2. Freeze authority 3. Top-10 holder concentration excluding LP/curve 4. Token-2022 dangerous extensions 5. Creator sold / creator balance 6. Creator history (prior dead tokens) 7. Same-slot bundled buys 8. Early sniper share (first 5 slots) 9. Shared-funder cluster supply % (the differentiator) 10. LP burned/locked + liquidity depth with Jupiter sell-quote honeypot check.
(Defer: social reuse, metadata mutability as low-weight, wash volume.)

**Data stack (free)**: Helius free key (cache aggressively, 2 req/s DAS) + public RPC fallback + Dexscreener no-key API + Jupiter quote + RugCheck public API as baseline to benchmark against. Pre-warm cache for demo mints; webhooks only if showing live new-mint stream.

**5 demo addresses** (LIBRA and BONK verified against Dexscreener on 2026-10-30; the rest still to verify):
- Rug: LIBRA `Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU` — verified: 8 pairs, $5.3k liquidity vs $2.6M FDV, $160/24h; swarm verdict RUGGED
- Rug / linked: MELANIA `FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P` (shows creator-cluster overlap with LIBRA)
- Clean: BONK `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` — verified: 30 pairs, $1.17M liquidity, $1.5M/24h; swarm verdict SAFE
- Clean: JUP `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`
- Live: one fresh pump.fun mint chosen at demo time (shows real-time judgement, and a 2026 rug if one appears)

Sources: [Helius rate limits](https://www.helius.dev/docs/billing/rate-limits), [Helius plans](https://helius.dev/docs/billing/plans), [Birdeye token_security](https://docs.birdeye.so/reference/get-defi-token_security), [GoPlus docs](https://docs.gopluslabs.io/), [RugCheck API](https://api.rugcheck.xyz/swagger/index.html), [Cointelegraph Bubblemaps](https://cointelegraph.com/news/libra-token-likely-tied-melania-memecoins-bubblemaps), [TRM LIBRA](https://trmlabs.com/post/the-libra-affair-tracking-the-memecoin-that-launched-a-scandal-in-argentina).
