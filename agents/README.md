# @sentinel/agents

The swarm: seven specialist agents, a council, an advocate and a judge on top of the deterministic engine.

```
engine.analyze(snapshot) ─► evidence ─┬─► Holders ──────┐
                                      ├─► Snipers & Bundles
                                      ├─► Funding Graph  ├─► debate? ─► council (anonymous peer ranking) ─► consensus (veto + weighted mean) ─► advocate ─► Judge ─► reconcile ─► verdict + sha256 digest
                                      ├─► Creator        │
                                      ├─► Contract & Liquidity
                                      ├─► Market        │
                                      └─► Money Flow ───┘
```

- **Facts are code, judgement is the model.** Every number an agent sees comes from `@sentinel/engine`; agents interpret and explain, they never compute. Prompts say so, and the schema forces typed findings.
- **Consensus with veto.** Hard-fail flags (live mint/freeze authority, permanent delegate, pullable LP, drained liquidity, creator cashed out to an exchange) are detected by code and floor the verdict at `DANGER`. Otherwise the score is Σ w·c·s / Σ w·c over agents (w = reliability weight, c = self-confidence, s = risk score). Spread above 35 points triggers one debate round between the two extremes. When the council ran, w becomes w × (0.7 + 0.6 × councilScore), so a finding its peers rank weakest keeps 70% of its weight and one they rank strongest gets 130%. `aggregate()` stays pure: the scores are passed in. The judge's answer is reconciled against the rule and every override is recorded.
- **Council.** After the debate, each specialist that reported receives the other findings anonymised (Finding A, B, C… in shuffled order; no agent names, ids or models, only risk score, confidence, label, summary, evidence and notes) and ranks them by evidential strength: verified on-chain facts that bear on whether a holder loses money above inference above thin samples, with a one-line reason each. Modelled on Karpathy's llm-council (drafts → anonymous peer ranking → chairman synthesis). `councilScore` is the mean normalised rank an agent received (1 = always ranked strongest). It scales the consensus weight and is shown to the judge as a second opinion on which findings to trust, never as a vote on the verdict. Runs on the specialist model at low effort, at most six calls in flight; a failed or unparsable ranking is skipped, and with fewer than two usable rankings `council` is null and no scores are applied. `SENTINEL_COUNCIL=0` or `council: false` turns it off.
- **Streaming.** `runSwarm()` is an async generator of `SwarmEvent`s: agent start, thinking summaries, findings, vetoes, debate, council (start, one ranking per agent, scores), consensus, advocate, judge, verdict. The CLI renders them as lanes; the web UI and MCP server consume the same stream.
- **Audit.** The verdict carries the evidence, every finding, the models used and a canonical sha256 digest, which `concordium/` appends to the audit contract.

## Run

```bash
npm run build -w engine -w agents
node agents/dist/cli.js --fixture rug                       # offline, textbook rug
node agents/dist/cli.js --fixture clean                     # offline, clean launch
node agents/dist/cli.js <mint> --save-snapshot snap.json    # live Solana mainnet via SOLANA_RPC_URL
node agents/dist/cli.js --snapshot snap.json --no-debate    # replay a saved snapshot
```

Needs `ANTHROPIC_API_KEY` in the repo-root `.env`. Models and effort are configurable (`SENTINEL_*_MODEL`, `SENTINEL_*_EFFORT`, see `.env.example`). Verdict JSON goes to stdout, progress to stderr.

## Tests

`npm test -w agents` runs the consensus rule and the orchestrator against a fake model; no network, no key.
