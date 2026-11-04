# Novelty research, 3 Nov 2026

Two passes: six Anthropic publications (smart contracts, backdooring classifiers, NLA, AuditBench, SHADE-Arena, automated weak-to-strong) and arXiv 2025–2026. Abstracts and summary pages were read, not every full PDF; check method details before citing them in the submission.

## Note on arXiv:2509.04781
It is "The LLM Has Left The Chat: Evidence of Bail Preferences in LLMs" (Ensign, Sleight, Fish), not a crypto paper. Only weak use: an explicit `abstain` output per specialist, measured in the audit trail, with one fixed elicitation format.

## What Sentinel already has
Outcome grading at 1h/24h/7d with Brier and reliability (`/track`), verdict hashes anchored on Concordium before the outcome, static reliability weights plus a peer council score in `agents/src/consensus.ts`, ML-DSA-65 signatures, verified-human badges, creator ID proofs.

## Ranked plan (5 weeks to 9 Dec)

| # | Feature | What to build | Backing | Effort |
|---|---|---|---|---|
| 1 | Track-record-weighted consensus | Replace static weights with each agent's rolling Brier/skill from graded verdicts (Dawid-Skene style per band); publish the weights on /track; ablation vote vs debate vs weighted | 2508.17536 (debate ≈ voting), 2509.05396 (peer-pressure flips), 2601.19921, 2511.07678; Anthropic automated W2S (noisy-label EM); no paper found doing outcome-weighted LLM-agent aggregation | M |
| 2 | Monitor agent with on-chain suspicion score | Independent model reads all specialist and judge reasoning against the evidence; 0–100 suspicion (ungrounded claims, ignored high-confidence agent, injection signs) goes into the signed, anchored verdict; evaluate with a planted saboteur specialist, publish catch rate vs false positives | Anthropic SHADE-Arena (monitors with access to reasoning do much better) | S–M |
| 3 | "Can you fool Sentinel?" adversarial arena | Hostile token names/URIs (prompt injection), engineered evasion (multi-hop sniper funding, slot-spread buys, fragmented exits); quarantine creator-controlled text; publish attack success before/after; anchor prompt and eval-set hashes so prompt poisoning is detectable | Anthropic backdooring classifiers (≈32 poisoned examples suffice); 2503.16248 CrAIBench; 2604.15367 SoK agentic commerce; 2511.15463 fragmented rug pulls; no paper found testing a rug detector against an adaptive attacker | M |
| 4 | Outcome-graded reputation in the Agent Registry | Per-agent Brier/skill as registry metadata pointing to graded on-chain records; pitch: feedback reputation is broken, outcomes are not | 2606.26028 (ERC-8004: 3–15% valid registrations; most feedback is Sybil), 2604.23280 | S |
| 5 | Bias auditor with counterfactual tokens | Same token, one attribute flipped (Concordium-verified creator or not, famous name, market cap); measure verdict shift; signed weekly report. Answers "is the ID a pay-to-be-safe loophole?" | Anthropic AuditBench | M |
| 6 | Commit-reveal power meter | Show per agent "N of ~350 graded verdicts needed to detect a 0.02 edge"; leak-proof by construction because the hash is anchored first | 2605.00420 Foresight Arena, 2506.00723, 2603.11324 | S |
| 7 | Conformal verdict sets with abstention | {DANGER, RUGGED} at 90% coverage from repeated sampling; abstain when risk exceeds budget | 2508.05544, 2509.01455 | M |
| 8 | XGBoost baseline and manipulation classes | 5-minute XGBoost on engine features graded next to the swarm; label DANGER by class (wash trading, creator obfuscation, copycat, coordinated sell, fragmented exit) | 2608.20271, 2609.10246, 2511.15463, 2504.07132 SolRPDS | M |

Dropped: NLA interpretability (needs model weights; Sentinel calls Claude over the API). Smart-contract exploit agents (SCONE-bench is EVM-only, $1,738 per bug found); borrow only its dollar-weighted scoring idea for the track record.

Stretch, unbacked academically: a bond behind verdicts, slashed on Brier loss (TRUST 2510.20188 covers auditors only).

## Caveats
- 2607.02795 (sniper cohorts): an Oct 2026 correction withdrew its numbers; cite the method only.
- 2604.15367: the token-metadata detail came from search summaries, not the abstract.
