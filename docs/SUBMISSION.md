# Submission copy (Encode project page)

Text for the project page, the checkpoint, the video and outreach. Numbers that move are linked, not quoted; check the ones marked *(update)* on the day.

## Checkpoint 1 (by Sun 22 Nov, 23:59 UTC): project created, team added, idea shared

**Name:** Sentinel

**One line:** A rug-check agent that pays you back when it is wrong.

**Idea (short):**

Trading agents buy memecoins on the word of risk scores nobody answers for. Sentinel is a swarm of nine registered agents that judges a Solana token and sells the verdict to other agents over x402. What makes it accountable is not the badge alone, it is what happens after the answer: every verdict is sealed on Concordium before the outcome, graded against the market a day later, and scored in public; a paid SAFE that rugs within 24 hours is refunded to the buyer automatically. It runs in production on Concordium testnet today: [sentinelagent.pro](https://sentinelagent.pro).

## Project page (final submission, by Wed 9 Dec, 23:59 UTC)

### 1. Description

**What it is.** Sentinel answers one question for trading agents: is this Solana token a rug? Seven specialist agents read deterministic on-chain evidence (holders, snipers and bundles, funding graph, creator history, contract and liquidity, market shape, where the money went after sells). An advocate argues the other side, a judge rules, and the verdict is sold per call over MCP, A2A or plain HTTP.

**Why it is accountable.** A badge says who is responsible. It does not say whether the answer was right, and it costs the agent nothing to be wrong. Sentinel adds the two things a badge cannot carry:

- **A sealed, graded record.** Each verdict carries a probability, hashed into an append-only contract before the outcome is known. A resolver re-reads the market at 1 hour, 24 hours and 7 days, grades the outcome with published labels, and anchors the grade beside the verdict. The [track page](https://sentinelagent.pro/track) scores the whole history with proper scoring rules (Brier, skill against the base rate, reliability), per agent. The specialists' weights in the consensus and the calibration of the judge's probability are learned from that record. We have restarted the score twice because our own grading was wrong, and the page says so.
- **Consequences.** A paid SAFE verdict whose token is graded rugged within 24 hours is refunded to the payer automatically, in the asset they paid in, with a memo naming the verdict. It has paid out on testnet. The [guarantee book](https://api.sentinelagent.pro/guarantee) shows revenue, refunds and what is at risk.

**For buyers.** [Sentinel Guard](https://www.npmjs.com/package/sentinelagent-guard) is an npm package that puts this behind one call: it checks Sentinel's badge with the Agent Registry, checks the graded track record against the buyer's own minimum, screens for hard red flags for free, pays for the full verdict only when needed, and blocks the swap if the answer is bad. A buyer can refuse an oracle whose record is not good enough before paying it anything.

**Concordium components used.**

| Component | Use |
|---|---|
| Agent Registry (CIS-8004) and Verified by Concordium badge | nine agents, tokens 981–989, each card an A2A Agent Card and ERC-8004 file, hash-pinned on chain; every agent's registry metadata carries its graded track record |
| Agent Registry MCP server | buyers check the badge before paying |
| x402 | 1 CCD or 0.01 EUDemo per verdict, in-process facilitator |
| Protocol-Level Tokens | EUDemo accepted next to CCD; refunds go back in the asset paid |
| Sponsored transactions | the facilitator pays the fee, the calling agent holds no gas |
| Smart contract | `sentinel_audit`: append-only verdict records and outcome grades (EU AI Act Art. 12 record keeping) |
| Concordium ID, Verify and Access | token creators attach a zero-knowledge proof (verified human, 18+) to their Solana wallet; nothing personal is stored |
| CIS-8 External Key Registry | Sentinel's Solana key is bound to the verified owner |

### 2. Repository

https://github.com/0xNickdev/sentinel-agent

### 3. Demo video (3 min)

Script below.

### 4. Explorer links

- Audit contract `<13039,0>`: https://testnet.ccdscan.io/contracts/13039/0 (open the same contract on CCDExplorer and paste that URL in the form)
- First automatic refund: transaction `37b8b592…` (full hash in the README)
- Gateway agent badge: https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9XuYWbM5LAuY1BXBRN?network=testnet

### 5. Path to production

1. **Mainnet registry and payments.** Register the nine agents on mainnet, price verdicts in a mainnet stablecoin PLT, keep CCD as the second asset.
2. **The guarantee as collateral.** Today the refund pool is an account Sentinel funds. With Protocol-Level Locks (Simple Locks, January 2027) the pool becomes a lock a buyer can read on chain before paying: recipients are the payers on record, the amount is the pool. The same lock shape bounds what a buying agent may spend on verdicts.
3. **First customers.** CARPET, the owner's Solana launchpad, is customer zero: every launch there will carry a Sentinel verdict. Guard is on npm for any trading agent; *(update: teams using it)*.
4. **Accuracy.** The score is public, so the roadmap is too: read the first minutes of the trade tape (the signal that separates survivors from dead launches), widen the sample beyond pump.fun, and let the guarantee's price follow the graded record.
5. **Corporate identity.** The owner account moves from a personal identity to an LEI-backed one, so the accountable party is a company.

## Demo video script (2:55)

| t | On screen | Voice |
|---|---|---|
| 0:00–0:15 | A dead pump.fun chart; a risk score next to it saying "SAFE" | Agents buy tokens on scores like this one. When the score is wrong, nothing happens to whoever gave it. |
| 0:15–0:45 | sentinelagent.pro: paste a live mint, lanes light up, verdict stamp, judge's brief | Sentinel is nine registered agents. Seven read on-chain evidence, an advocate argues the other side, a judge rules. |
| 0:45–1:10 | Agent cards, badge check in the Agent Registry, the verdict's CCDScan transaction, "verify signature" turns green | A verified person owns every agent. The verdict and its probability are hashed on Concordium before anyone knows the outcome. |
| 1:10–1:45 | `/track`: horizon tabs, Brier and skill tiles, reliability chart, specialists table with weights, the line about void grades and superseded rules; click a graded row to its `grade` transaction | A day later the resolver grades it. This is every call we made and how it turned out, scored against the base rate. The weights and the calibration are learned from this record. Twice we found our own grading was wrong and restarted the score in public. |
| 1:45–2:20 | Terminal: `trader-agent` checks the badge, gets 402, pays 1 CCD (sponsored), receives the verdict; then `/guarantee`: the PAYDAY claim, refund transaction on CCDScan, the book | Another agent pays per verdict with x402 and holds no gas. And if a paid SAFE rugs within a day, the buyer is refunded automatically. This one did, and this is the refund. |
| 2:20–2:40 | Editor: five lines of Guard with `minOracleSkill`; run it, a buy is blocked before any payment | Guard puts it behind one call. A buyer sets the record an oracle must have, and refuses to pay one that does not have it. |
| 2:40–2:55 | Path to production slide: mainnet, the pool as a Protocol-Level Lock, CARPET | Accountability is not the badge. It is what the agent owes you when it is wrong. |

Pre-flight is in [DEMO.md](DEMO.md). Record `/track` only when the 24 h tab has rule 3 grades of both kinds.

## Message to other teams (Discord, short)

> We built a pre-trade check you can drop into your agent: `npm i sentinelagent-guard`. One call before a swap returns allow / warn / block for a Solana token. It checks our Verified by Concordium badge, pays per verdict over x402 on testnet (1 CCD, fee sponsored), and refunds you automatically if a paid SAFE rugs within 24 h. Every verdict we have made is graded in public: sentinelagent.pro/track. If your agent trades or holds Solana tokens, try it and tell us what breaks. Happy to check your agent's badge from ours in return.
