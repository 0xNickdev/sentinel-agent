# Where Sentinel stands, and what would make it the only one of its kind

Date: 2026-10-31. Four parallel research passes (hackathon field, agent-native security market, academic literature 2024–2026, GitHub sweep). Everything below is sourced; [UNVERIFIED] marks claims we could not confirm. Russian summary was given to the owner in chat; this file is the English record.

## 1. Honest position

**What already stands.** Integration depth is real: CIS-8004 registration with the badge (pending the public origin), x402 over `@x402/concordium` with sponsored transactions (first paid verdict anchored on testnet), an audit contract `<13036,0>`, MCP + A2A, PQ-signed verdicts. Judges score depth of integration, path to production, a working end-to-end demo and usefulness (docs/BRIEF.md). On the first three we are ahead of anything public for this hackathon; the only competitor repo found so far is NoctAgent Credit (ID-gated borrowing agent) ([repo](https://github.com/danielx2d4144/noctagent-credit)).

**What is not novel.** "A swarm of specialist agents that debates whether a token is a rug, with a devil's advocate" is a shipped product category:
- VerdictSwarm (Sentien Labs): "6 adversarial AI agents debate", devil's advocate, dissent shown, ERC-8004 #37960 on Base with x402Support; zero feedback, zero validations, no live MCP/A2A ([8004 explorer](https://erc-8004.quicknode.com/agents/base-mainnet/37960), [mcp.so](https://mcp.so/servers/verdictswarm-mcp)).
- Argus (OKX / Circle listing): three model families stake stablecoins on SAFE/RISKY/SCAM, dissenter pays, ELO on-chain, $0.01–0.02 via x402 on X Layer ([Circle](https://partners.circle.com/partner/argus), [HackQuest](https://hackquest.io/projects/Argus-ns9L5q)). Live volume [UNVERIFIED].
- Agentic Shield (Solana, 4 specialists, hackathon), DeepSnitch (5 agents, promotional), AuditAgent (signed score into an attestation registry, AMD hackathon).
- MCP rug checks (GoPlus, Webacy, Blockaid, Birdeye wrappers, SendAI `rugCheck`) and x402 rug checks at $0.003–0.02 (Token Safety X402, True402, NodeFlare) are commodity.

**Weak spots against past winners.** Concordium's winners (Proctora, VeriLoan, Blockbet at Encode London 2025; Hublab et al. 2024) all used the ID layer as the core mechanic and stacked two or more primitives ([Concordium](https://www.concordium.com/article/next-gen-builders-harness-concordiums-privacy-preserving-tech)). Our Concordium ID use (creator proof) is a planned field, not a flow. The swarm takes ~4 min on old tokens, and nothing is live for real users yet.

**Verdict.** As it stands: a credible top-3 candidate on integration and polish, but not a sure winner, because the headline claim ("debating agents") is one others already make. Prize pool, judge list and rubric were not found anywhere [UNVERIFIED until the hacker pack opens 2 Nov].

## 2. The gap, confirmed from three directions

Three independent passes land on the same empty niche:

- **Market:** no verdict service publishes an outcome-scored track record; no service binds a verifiable human to the agent; ERC-8004 reputation is Sybil-dominated (73.5 % / 59.2 % / 90.6 % of reviewers Sybil on ETH / BSC / Base) and the Validation Registry is empty ([arXiv:2606.26028](https://arxiv.org/abs/2606.26028), [llm4agents audit](https://llm4agents.com/blog/erc-8004-registries-onchain-audit)). Concordium itself says: "ERC-8004 solves discovery, not accountability" ([article](https://www.concordium.com/article/erc-8004-explained-what-it-solves-and-the-gap-it-leaves)).
- **Literature:** "No crypto-risk system publishes auto-graded verdicts with a calibration curve." Only Foresight Arena (commit-reveal, Brier, no live results) and Noisyxl/brier (hash-chained prediction ledger, 116★) come close ([arXiv:2605.00420](https://arxiv.org/abs/2605.00420), [brier](https://github.com/Noisyxl/brier)).
- **GitHub:** nobody combines a specialist swarm, hash-anchored verdicts resolved against real outcomes, a human-verified badge, x402 over MCP/A2A and PQ signatures. Closest partials: internet-court (dispute stack, 7k★, no verdicts), thirdeye / cabal-hunter (forensics, no accountability).

Concordium's own 16 Jul 2026 article is our thesis in their words: identity → declared authority (scope committed in the Agent Card) → execution evidence (logs signed with the registered key, linked to the card hash), citing EU AI Act Art. 12 ([article](https://www.concordium.com/article/your-ai-agent-can-create-liability-can-you-prove-what-it-was-authorised-to-do)). CEO line: "Payment tells you an agent can spend. It doesn't tell you who answers for it."

## 3. The claim to own

> **Sentinel is the only rug oracle whose calls are sealed on-chain before the outcome, graded against the outcome after it, and backed by a bond under a human-verified identity.**

Every other product sells a score. Sentinel sells a *record*: a verdict you can hold against what happened, and a party who pays when it was wrong.

## 4. What to build (priority order, 19 Nov – 9 Dec)

### 4.1 Outcome-graded verdict track (the headline)
- **Seal:** at verdict time commit `sha256(verdict ‖ P(rug) ‖ evidence root ‖ salt)` to the audit contract (already anchored; add the probability and the salt, reveal is the existing record). Commit-reveal shape follows Foresight Arena.
- **Resolve:** a resolution oracle re-reads each judged mint at T+1h, T+24h, T+7d and grades it with the two label definitions the literature settled on: *TVL rug* (liquidity max drawdown > 99 %) and *Idle rug* (no trades for > 80 % of lifetime) ([arXiv:2608.20271](https://arxiv.org/abs/2608.20271)); plus *creator exit* (sold ≥ 80 %, holds < 1 %) from our own flows. Grades are written to the contract as a second record type.
- **Score:** Brier and log score per horizon, reliability diagram, per-specialist attribution (which agent's risk score was closest), all on the site and in the Agent Cards' `skills` description. Report against the base rate: 74–84 % of pump.fun launches rug ([arXiv:2602.13480](https://arxiv.org/abs/2602.13480)), so a skill score vs base rate, AUPRC and MCC are the honest numbers, not AUC. Power: ~350 resolved predictions to show a 2-point edge at 80 % power (Foresight Arena); the launch feed gives us that volume in days.
- **Why it wins:** it is the accountability Concordium says ERC-8004 lacks, it is measurable in the demo ("here is our last 300 calls, graded"), and it gives the registry badge a track record nobody else has.

### 4.2 Money-back verdict (skin in the game)
- The judge posts a bond in a PLT (or CCD) per epoch. A paid SAFE verdict that resolves *TVL rug* within 24 h triggers an automatic refund of the x402 payment to the buyer from the bond, via a sponsored transaction. Argus stakes between its own agents; nobody refunds the buyer. Dispute path later via Internet Court-style adjudication, not now.
- Uses three primitives at once (PLT, sponsored tx, x402) and makes "a human answers for it" literal.

### 4.3 Creator identity as a core mechanic (what past winners did)
- A token creator proves "verified human, 18+" with Concordium Verify and Access; the proof is bound to the Solana creator key by a signed challenge; only the proof hash and the mint go on-chain. The engine's `verified_creator` flag becomes a real flow, with a `creator_unverified` note on everything else. No personal data stored, revealable only via Privacy Guardians: the "accountable, not endorsed" framing.

### 4.4 Evidence-bound claims (anti-hallucination)
- ABF-Bench showed general agents "cite records they never retrieved"; the purpose-built harness that forces every claim to cite a retrieved record reached 75 % edge recall vs 10 % for Claude Code ([arXiv:2610.23656](https://arxiv.org/abs/2610.23656)). Make every specialist evidence item carry the hash of the on-chain record it came from (signature or account slice), roll them into the evidence root in the sealed commit, and drop any claim without a citation before the judge sees it. Add an injection test suite with payloads in token names, metadata URIs and memos ([arXiv:2610.26438](https://arxiv.org/abs/2610.26438), [arXiv:2604.15367](https://arxiv.org/abs/2604.15367)); wrap all untrusted text with `@stackone/defender`.

### 4.5 Standing watch (counterfactual made actionable)
- `whatWouldChange` already exists. Turn each item into a trigger the engine can evaluate (liquidity < X, creator sells, lock expires). A paid verdict carries a 24 h watch; when a trigger fires the swarm re-judges and anchors a revised verdict with a diff. Nobody ships counterfactuals in this space; the literature warns they are only reliable when re-evaluated in a fresh context ([arXiv:2509.09396](https://arxiv.org/abs/2509.09396)), which is exactly what a re-run is.

### 4.6 A write-up with numbers (optional, after 4.1)
- Ablation on ≥ 300 graded tokens: single judge vs anonymous council vs council + advocate vs vetoes; measure flip rate, fact attrition, calibration. The literature says sycophantic debate falls below a single agent (−1.9 to −4.5 pts, collapse 80–86 %) and deliberation erases up to 72 % of critical facts ([arXiv:2509.23055](https://arxiv.org/abs/2509.23055), [arXiv:2606.03032](https://arxiv.org/abs/2606.03032)), while anonymisation removes identity bias ([arXiv:2510.07517](https://arxiv.org/abs/2510.07517)). Our council is anonymous, our debate is capped at one round with a central judge: the design already matches the evidence. Proving it on live tokens would be a first.

## 5. Design rules the literature imposes

- Keep debate to ≤ 2 rounds, central judge, heterogeneous roles; a single sycophantic peer can poison the shared context.
- Calibrate abstention *after* debate, not before: conformity voids guarantees calibrated on solo answers ([arXiv:2609.04445](https://arxiv.org/abs/2609.04445)).
- The devil's advocate yields some inauthentic dissent (4.9 %); show its rebuttal as a separate record, never fold it into the score.
- Position bias in LLM judges reaches 75 % first-position preference; keep specialist findings in randomised order for the judge.
- Cross-launchpad shift is unsolved (pump.fun → Raydium MCC collapses to −0.07); report scores per venue.
- Collector configuration decides what a detector sees (two pump.fun collectors overlap < 1 % of mints, [arXiv:2609.18975](https://arxiv.org/abs/2609.18975)); document the Shyft gRPC feed's filter as part of the record.
- EU AI Act Art. 12 has no fixed field list outside biometrics; prEN 18229-1 / ISO/IEC DIS 24970 pending. Our record (inputs hash, model ids, prompts version, outputs, timestamps, operator identity) should be documented as a proposed field set, not as compliance.
- PQ: keep ML-DSA-65 as forward-compatibility with Concordium's Jan 2027 PQC roadmap item; the hybrid Ed25519 + ML-DSA-65 layout from the OpenA2A AIP draft is the pattern to follow. Not the headline.

## 6. Adopt / do not reinvent

Adopt: `x402-foundation/x402` `mechanisms/concordium` (canonical, 6.8k★); A2A v1.0 JWS-signed Agent Cards; MCP 2026-07-28 `outputSchema` for structured verdicts; `@stackone/defender` on every on-chain text ingress; forecastbench scoring code; EigenAI signed inference receipts or Phala dstack if we want attested inference later.
Do not reinvent: council mechanics (Karpathy llm-council, 26k★, dormant), registries, payments, TEE attestation, dispute adjudication (internet-court), basic risk flags (RugCheck / GoPlus).

## 7. Naming

An unrelated "Sentinel" security oracle exists on X Layer ([listing](https://skillsmp.com/creators/checkra1neth/sentinel/skill), page returned 403) [UNVERIFIED]. Check before the final brand and domain.

## Sources used by the research passes
Hackathon: [Encode programme](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon), [Agent Registry launch](https://concordium.substack.com/p/the-concordium-agent-registry-is), [badge](https://www.concordium.com/article/the-verified-by-concordium-badge-the-trust-mark-that-travels-with-your-agent), [Agent Card](https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/agent-card.html), [x402 Foundation](https://www.concordium.com/article/concordium-x402-foundation), [roadmap](https://www.concordium.com/roadmap), [registry traction](https://www.tokenpost.com/news/technology/37668), [XDC](https://blockchainreporter.net/xdc-network-selects-concordium-as-exclusive-identity-verification-layer-for-ai-agents), [AgentGate](https://mcpservers.org/servers/youraitools-co-guides-x402-agent-verification).
Market: [GoPlus MCP](https://mcp.so/servers/goplus-mcp), [Webacy](https://www.webacy.com/blog/webacy-is-now-agent-native), [Blockaid](https://blockaid.io/blog/how-to-build-smarter-safer-onchain-ai-agents-with-blockaid), [Nansen MCP](https://docs.nansen.ai/mcp/overview), [Helius MCP](https://www.helius.dev/docs/agents/overview.md), [Token Safety X402](https://mcp.so/servers/token-safety-x402), [NodeFlare](https://nodeflare.app/blog/onchain-due-diligence-ai-trading-agents), [x402 Bazaar](https://docs.x402.org/extensions/bazaar), [WachAI](https://hol.org/registry/agent/uaid:aid:38wKogErNVwXB82ESGd5sUk6syXdtYBNy55sX5g84oomd5JLXMvG2wvKHSneH2F4ih), [a16z](https://a16zfrontier.com/posts/article/5-ways-blockchains-help-ai-agents/), [GenLayer court](https://cryptobriefing.com/genlayer-ai-court-validators/), [thirdweb x402 upto](https://portal.thirdweb.com/changelog/dynamic-pricing-for-x402-resources).
Literature: arXiv 2608.20271, 2602.13480, 2603.24625, 2609.10246, 2504.07132, 2609.18975, 2610.23656, 2604.04211, 2512.00417, 2610.26438, 2512.02261, 2606.13685, 2606.19544, 2411.15594, 2509.23055, 2606.03032, 2505.21588, 2510.07517, 2606.19826, 2505.21503, 2609.04445, 2603.20975, 2307.02762, 2402.01830, 2406.08598, 2502.18535, 2605.08922, 2605.00420, 2608.28482, 2507.04562, 2606.26028, 2606.12128, 2511.03434, 2512.00110.
GitHub: [llm-council](https://github.com/karpathy/llm-council), [autoresearch](https://github.com/karpathy/autoresearch), [erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts), [internet-court-skill](https://github.com/internet-court/internet-court-skill), [x402](https://github.com/x402-foundation/x402), [a2a-x402](https://github.com/google-agentic-commerce/a2a-x402), [dstack](https://github.com/Phala-Network/dstack), [forecastbench](https://github.com/forecastingresearch/forecastbench), [brier](https://github.com/Noisyxl/brier), [defender](https://github.com/StackOneHQ/defender), [noble-post-quantum](https://github.com/paulmillr/noble-post-quantum), [thirdeye](https://github.com/AIEngineerX/thirdeye), [cabal-hunter-mcp](https://github.com/paulf280-ui/cabal-hunter-mcp).
