# Sentinel — concept

> A swarm of specialist agents that tells other agents whether a token will rug them — and can prove who stands behind the answer.

## The problem
Every trading bot, Telegram sniper and AI assistant that touches meme coins needs a "is this a rug?" answer in under a second. Today that answer comes from anonymous APIs and bots. Nobody knows who runs them, nobody can audit what they said yesterday, and a "clean" verdict can be bought. The same is true in reverse: a token creator who is a real, accountable human has no way to prove it without doxxing.

## The product
**Sentinel** is an agent-native rug-risk oracle:

1. **Swarm analysis.** Six specialist agents each own one evidence domain and a judge agent reaches a consensus verdict with a confidence score. The expensive, deterministic parts (holder maths, funding graphs) are code; the LLM agents interpret, cross-examine and explain.
2. **Agent-native surface.** Verdicts are served over **MCP** (tool `sentinel.verdict`) and **A2A** (Agent Card), so any agent — Claude, GPT, a trading bot — can call Sentinel as a tool.
3. **Pay per answer.** Each query is a micro-payment over **x402** on Concordium testnet (CCD or PLT). No API keys, no subscriptions; agents pay agents.
4. **Accountable by construction.** Sentinel and every specialist agent are registered in the **Concordium Agent Registry** under a **Verified by Concordium** badge: a verified human (the founder) stands behind the swarm, and that is readable from Solana/EVM via ERC-8004. Consumers check the badge before trusting a verdict.
5. **Audit trail.** Every verdict is hashed (inputs, evidence, verdict, model versions) and appended to a Concordium testnet contract. That is the EU AI Act Art. 12 record: anyone can prove what Sentinel said, when, about what.
6. **Verified creators (shipped).** A token creator binds their Solana wallet to a **Concordium ID** zero-knowledge proof (real person, 18+) through Verify and Access at sentinelagent.pro/verify. Sentinel stores nothing personal: the wallet, the claim, the time and two on-chain anchors (CCDVRA request, CCDVAA audit record). The proof follows the wallet, so it covers every token that wallet launches, on any launchpad.

## The swarm
| Agent | Evidence it owns | Output |
|---|---|---|
| **Holders** | top-10 concentration, program vaults excluded, whale drift | concentration score, notable wallets |
| **Snipers & Bundles** | buys in the first slots, same-slot multi-wallet buys, Jito bundles | % supply sniped/bundled, still holding? |
| **Funding Graph** | who first funded each top wallet; clusters; creator's circle; hub exclusion (CEX/faucet) | linked clusters, % linked, creator-linked % |
| **Creator** | past tokens and their fate, sold-all / sold-some, fee extraction, social reuse, Concordium ID proof present? | creator trust score |
| **Contract & Liquidity** | mint/freeze authority, Token-2022 extensions (transfer fee, permanent delegate), metadata mutability, LP burned/locked, pool type | hard-fail flags |
| **Market** | price/volume shape, wash patterns, holder growth vs volume | manipulation score |
| **Judge** | all of the above + disagreement between agents | verdict `SAFE / CAUTION / DANGER / RUGGED`, confidence, one-paragraph reasoning, top 3 reasons |

Consensus rule: hard-fail flags (authorities live, honeypot extension, LP pullable) short-circuit to DANGER; otherwise the judge weighs agent scores by each agent's calibrated reliability (tracked against outcomes) and must explain any disagreement. Every agent's input and output is part of the audit record.

## Where Concordium sits
```
 agent/bot ──MCP/A2A──▶ Sentinel gateway ──x402 (CCD/PLT)──▶ paid
                              │
                              ├── swarm (engine + LLM agents)
                              │
                              ├── Agent Registry: Sentinel + 7 agents, Verified by Concordium badge, Agent Cards
                              ├── Audit contract: append(verdictHash, mint, ts, agentIds)
                              └── ID / Verify and Access: creator proofs (ZK, nothing stored)
 Solana mainnet (read-only) ◀── engine adapters (RPC / Helius)
```

## Demo flow (≤ 3 min)
1. An agent (Claude via MCP) asks Sentinel about a token. Gateway answers 402 → agent pays on Concordium testnet → verdict streams back, agents' work visible live in the UI.
2. Verdict DANGER on a known rug, SAFE on a clean token; the funding-graph cluster is shown.
3. Click the badge: Agent Registry entry, Verified by Concordium, Agent Card. Click the audit link: CCDExplorer transaction with the verdict hash.
4. Creator flow: the founder connects the creator wallet at /verify, signs a challenge, proves 18+ with the Concordium wallet; Sentinel anchors the audit record and every verdict on that wallet's tokens shows "verified human creator". No data stored.
5. Across chains: Sentinel's Solana key resolves through CIS-8 to the verified owner and through the gateway's external reference to the agent and its badge; each agent's registry metadata carries its graded track record.

## Path to production
- First customer: CARPET (carpet.money) shows Sentinel verdicts on every token page.
- Then: Telegram scanners and trading bots (MCP/x402 ready), other launchpads, wallets.
- Mainnet: Agent Registry + badge on Concordium mainnet, x402 with PLT stablecoin, sponsored transactions so human users never touch CCD; LEI/company identity for the operating entity.

## Why this wins (our thesis)
- Depth: five Concordium components in one coherent flow, each load-bearing, none decorative.
- It works: the analysis engine already runs on real data (ported from a live launchpad), so the six weeks go into the Concordium integration and the demo.
- Usefulness: rugs are the number-one loss vector in meme markets; the first users are agents that already exist.
- Credible production path: a live launchpad as customer zero.
