# Sentinel

**The rug oracle that answers for its calls.** Seven specialist agents and a judge decide whether a Solana token is a rug. Every verdict is a probability sealed into an append-only audit contract on Concordium **before** the outcome and graded against the outcome **after** it (1h, 24h, 7d), so the track record (Brier score, skill against the base rate, reliability per specialist) is public and reproducible. Every agent is registered in the Concordium Agent Registry under a Verified by Concordium badge, a verified human stands behind it, and other agents buy verdicts over MCP, A2A and HTTP with x402 micro-payments.

Every incumbent sells a score. Sentinel sells a record you can hold against what happened: `GET /track`, MCP `sentinel_track`.

Built for the Encode × Concordium "Make your Agents Accountable" hackathon (Nov–Dec 2026).

```
 agent / bot ──MCP · A2A · HTTP──▶ Sentinel gateway ──x402 (CCD, sponsored tx)──▶ paid
                                        │
                                        ├── engine: deterministic evidence from Solana mainnet (holders, snipers, bundles,
                                        │           funding graph, creator, authorities, market)
                                        ├── swarm: 6 specialists (Haiku) + judge (Opus), veto + weighted consensus, debate
                                        ├── Agent Registry (CIS-8004): 8 Agent Cards, Verified by Concordium badges
                                        ├── audit contract (Rust): sha256(verdict) appended, EU AI Act Art. 12
                                        │     └── grades: outcome at 1h/24h/7d appended beside the verdict (resolver)
                                        └── Concordium ID: verified-human creator proof (planned)
```

## Status

| Package | What | State |
|---|---|---|
| `engine/` | Chain-agnostic signals, Solana RPC adapter, Dexscreener market adapter, money-flow trace, launch feed (Shyft gRPC), outcome grading + proper scoring | Runs on mainnet; 31 tests |
| `agents/` | Swarm orchestrator (7 specialists, debate, anonymous council, advocate, judge), consensus with vetoes, ML-DSA-65 attestation, CLI | Live verdicts: LIBRA → RUGGED, BONK → SAFE; 29 tests |
| `concordium/` | Registry client + Agent Cards, audit contract (Rust) + client, verdict track resolver, x402 gateway/facilitator/payer | Live on testnet: contract `<13039,0>`, first paid verdict anchored; 13 + 4 tests |
| `mcp/` | MCP server, A2A agent, composed product server, paying MCP client demo | End-to-end with real models; 4 tests |
| `web/` | Showcase site: live swarm over SSE, verdict stamp, agent cards with badges, audit explorer with in-browser signature verification, docs | Builds; runs against the API |

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
