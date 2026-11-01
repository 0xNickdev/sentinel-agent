# Sentinel

**The rug oracle that answers for its calls.** Seven specialist agents and a judge decide whether a Solana token is a rug. Every verdict is a probability sealed into an append-only audit contract on Concordium **before** the outcome and graded against the outcome **after** it (1h, 24h, 7d), so the track record (Brier score, skill against the base rate, reliability per specialist) is public and reproducible. Every agent is registered in the Concordium Agent Registry under a Verified by Concordium badge, a verified human stands behind it, and other agents buy verdicts over MCP, A2A and HTTP with x402 micro-payments.

Every incumbent sells a score. Sentinel sells a record you can hold against what happened: `GET /track`, MCP `sentinel_track`.

Built for the Encode × Concordium Trusted Agents hackathon (Nov–Dec 2026).

## Live

| | |
|---|---|
| Site | https://sentinelagent.pro |
| API (gateway, MCP `/mcp`, A2A `/a2a`, x402 `/x402/verdict`, track `/track`) | https://api.sentinelagent.pro |
| Audit contract (verdicts + outcome grades), testnet | [`<13039,0>`](https://testnet.ccdscan.io/contracts/13039/0) |
| Agent Registry (CIS-8004 `<12802,0>`), testnet | tokens 981–989, all nine badges valid ([registry.json](concordium/cards/registry.json)) |
| Verdict signatures | ML-DSA-65, public key at https://api.sentinelagent.pro/.well-known/sentinel-keys.json |

| Agent | Token | Badge token address |
|---|---|---|
| Sentinel (gateway) | 981 | `JyP9XuYWbM5LAuY1BXBRN` |
| Judge | 982 | `JyP9XvdzXNaG12mhEPWxc` |
| Holders | 983 | `JyP9XwjUTQ5BqA1U88GxH` |
| Snipers & Bundles | 984 | `JyP9XxpxPRa7fHFHdSi8f` |
| Funding Graph | 985 | `JyP9XyvSKT53VQV4eCrRY` |
| Creator | 986 | `JyP9Y11vFUZyKXirwTVGZ` |
| Contract & Liquidity | 987 | `JyP9Y27QBW4u9exdA4hkR` |
| Market | 988 | `JyP9Y3Ct7XZpynCTKGUka` |
| Money Flow | 989 | `JyP9Y4JN3Z4kouSAhLdSi` |

Check any badge yourself: `GET https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9XuYWbM5LAuY1BXBRN?network=testnet`, or the hosted MCP tool `check_badge`.

```
 agent / bot ──MCP · A2A · HTTP──▶ Sentinel gateway ──x402 (CCD, sponsored tx)──▶ paid
                                        │
                                        ├── engine: deterministic evidence from Solana mainnet (holders, snipers, bundles,
                                        │           funding graph, creator, authorities, market, money flow)
                                        ├── swarm: 7 specialists + council + advocate + judge, vetoes, weighted consensus
                                        ├── Agent Registry (CIS-8004): 9 Agent Cards, Verified by Concordium badges
                                        ├── audit contract (Rust): sha256(verdict) appended before the outcome
                                        │     └── grades: outcome at 1h/24h/7d appended beside the verdict (resolver)
                                        ├── sampler: judges random live pump.fun launches so the track is not cherry-picked
                                        └── Concordium ID: verified-human creator proof (planned)
```

## Status

| Package | What | State |
|---|---|---|
| `engine/` | Chain-agnostic signals, Solana RPC adapter, Dexscreener market adapter, money-flow trace, launch feed (Yellowstone gRPC), outcome grading + proper scoring | Runs on mainnet; 32 tests |
| `agents/` | Swarm orchestrator (7 specialists, debate, anonymous council, advocate, judge), consensus with vetoes, ML-DSA-65 attestation, CLI | Live verdicts: LIBRA → RUGGED, BONK → SAFE; 29 tests |
| `concordium/` | Registry client + Agent Cards, audit contract (Rust) + client, verdict track resolver, launch sampler, x402 gateway/facilitator/payer, demo trader agent | Live on testnet; 14 + 4 tests |
| `mcp/` | MCP server, A2A agent, composed product server | Deployed on Railway; 7 tests |
| `web/` | Site: live swarm over SSE, verdict stamp, agent cards with badges, audit explorer with in-browser signature verification, track record, docs | Deployed on Vercel |

### An agent that asks before it buys

`node concordium/dist/scripts/trader-agent.js [mint]` is the scenario end to end: a trading agent reads Sentinel's Agent Card, checks its Verified by Concordium badge against the registry, pays 1 CCD over x402 (sponsored, no gas), and buys only a SAFE call it is reasonably sure of. It never trades; it prints the decision and the Concordium record of the call it acted on.

## Run it

```bash
npm install && npm run build && npm test
cp .env.example .env            # add ANTHROPIC_API_KEY and a Solana RPC URL
node agents/dist/cli.js --fixture rug                         # offline swarm run
node agents/dist/cli.js <mint> --save-snapshot snap.json      # live mainnet
node mcp/dist/scripts/serve.js                                # MCP + A2A + x402 + cards on :4020
node mcp/dist/scripts/mcp-client-demo.js <mint>               # another agent buys a verdict
SENTINEL_API_URL=http://localhost:4020 npm run dev -w web      # the site on :3000
```

Package READMEs: [engine](engine/), [agents](agents/README.md), [concordium](concordium/README.md), [mcp](mcp/README.md). Concept and research: [docs/](docs/).

## Principles

- **Facts are code, judgement is the model.** Every number comes from deterministic, tested code; the models interpret and explain, and the consensus rule can override the judge.
- **Accountable by construction.** A verified human owns the agents; the audit trail is on-chain and append-only; verdicts are reproducible from the evidence hash.
- **Honest.** Data gaps lower confidence and are stated. Nothing is mocked as real.
- **Defended.** Prompt-injection guards, strict inputs, rate limits, x402 settlement before release, append-only audit, and post-quantum (ML-DSA-65) verdict signatures. See [docs/SECURITY.md](docs/SECURITY.md).
