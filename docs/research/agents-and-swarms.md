# Sentinel: agents, swarms, protocols (research, 2026-10-30)

Stars/activity pulled live via `gh api` on 2026-10-30. Protocol facts come from web search of mostly secondary sources; items marked (verify) need a check against the primary spec before we build on them.

## 1. Multi-agent frameworks (state of the art)

| Project | What / maturity | TS | License | Fit for Sentinel |
|---|---|---|---|---|
| [ruvnet/ruflo](https://github.com/ruvnet/ruflo) (ex claude-flow), 80k stars, pushed today | Swarm orchestration for Claude Code, MCP tools, memory, consensus topologies | Yes | MIT | Dev-time tooling, not a runtime dependency. Do not hang the product on it. |
| [microsoft/autogen](https://github.com/microsoft/autogen) 61.6k; [ag2ai/ag2](https://github.com/ag2ai/ag2) 5k; [microsoft/agent-framework](https://github.com/microsoft/agent-framework) 14.4k | AutoGen is now the legacy line; Microsoft's successor is Agent Framework; AG2 is the community fork | Python/.NET | CC-BY-4.0 / Apache-2.0 / MIT | Skip (Python-first, heavy). |
| [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) 60k | Role/crew abstraction, very popular | No | MIT | Skip; no TS. |
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) 71k, last push Jan 2026 | Software-company role simulation; slowing | No | MIT | Skip; stale. |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) 44k / [langgraphjs](https://github.com/langchain-ai/langgraphjs) 3.4k | Graph state machines, checkpointing, human-in-loop; most production-grade orchestration | Yes | MIT | Strong option for fan-out/fan-in graph, but adds weight. |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js) 4k (py 30k); [openai/swarm](https://github.com/openai/swarm) 22k | Agents SDK is the supported successor to educational Swarm (last push Apr 2026) | Yes | MIT | Swarm is a teaching repo only. Agents SDK supports MCP, but OpenAI-centric; it can run other models via adapters. |
| [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) 1.8k | Claude Code's agent loop as a library: subagents, tools, MCP | Yes | Anthropic terms (no SPDX) | Good for tool-heavy agents; overkill for narrow analysts. |
| [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript) | Raw Messages API, tool use, structured outputs | Yes | Apache-2.0 | Best base layer for us. |
| [huggingface/smolagents](https://github.com/huggingface/smolagents) 30k | Code-writing minimal agents | Py | Apache-2.0 | Skip. |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) 29k | TS-native agents, workflows, evals, MCP server/client, A2A support | Yes | Elastic-style (NOASSERTION; verify) | Best TS framework if we want one; watch license. |
| [vercel/ai](https://github.com/vercel/ai) 27.6k | AI SDK: provider-agnostic, streaming UI hooks, agent loops | Yes | NOASSERTION (Apache-2.0 family, verify) | Good for UI streaming of agent events. |
| [google/adk-js](https://github.com/google/adk-js) 1.5k (py 22k) | Google ADK, native A2A | Yes | Apache-2.0 | Young in TS; skip. |

Verdict: our agents are narrow, mostly deterministic-then-one-LLM-call. The orchestration is `Promise.all` + a reducer. Use the plain Anthropic TS SDK plus our own ~200-line orchestrator (optionally LangGraph.js for checkpointing). Frameworks add risk and no demo value. Judges reward visible mechanism, not framework names.

## 2. Protocols

**MCP.** Latest spec revision is 2026-07-28 (Cloudflare changelog; a third-party post says it removes protocol-level sessions/initialize handshake from Streamable HTTP; verify at modelcontextprotocol.io). Prior 2025-11-25 revision is the one that replaced HTTP+SSE with Streamable HTTP. TS SDK: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) 13.7k stars; v1 is `@modelcontextprotocol/sdk` (maintenance), v2 is split into `@modelcontextprotocol/server` / `@modelcontextprotocol/client` (v2.4.0 on 2026-10-23, per releases.sh; verify). To publish: expose one HTTP endpoint (`/mcp`) speaking Streamable HTTP (POST JSON-RPC, optional SSE upgrade), register tools with zod/JSON-Schema inputs, deploy anywhere with HTTPS, list in registries (official MCP Registry, Smithery, Glama). Pick the v2 SDK only if it is stable by build time; otherwise pin v1 and accept both spec eras.

**A2A.** Spec [a2aproject/A2A](https://github.com/a2aproject/A2A) (26k stars, Linux Foundation); v1.0.0 is the first stable (Protobuf is normative; bindings: JSON-RPC 2.0, gRPC, HTTP+JSON). Older 0.3.x is still seen in the wild. Agent Card lives at `/.well-known/agent-card.json`: name, description, version, supported interfaces/URL, capabilities (streaming, pushNotifications), skills[] (id, name, description, tags, examples, input/output modes), securitySchemes, optional signature. TS SDK: [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js) (648 stars, active; npm `@a2a-js/sdk`, verify exact exports). Key task model: Task with states (submitted, working, input-required, completed, failed), Messages, Artifacts, streaming via SSE.

**x402.** HTTP 402 pay-per-request. Packages `@x402/core`, `@x402/evm`, `@x402/svm` (Solana SPL TransferChecked); Apache-2.0; moved under an x402 Foundation (Linux Foundation, Apr 2026, per secondary source). Free x402.org facilitator is testnet-only (Base Sepolia, Solana devnet); CDP facilitator supports mainnet Solana with API keys. Docs: [Solana x402 guide](https://solana.com/docs/payments/agentic-payments/x402), [CDP docs](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator.md). Note: a Concordium entry needs the payment/identity chain to be coherent; decide whether x402 settles on Solana (what the payer already holds) while accountability lives on Concordium.

**ERC-8004 ("Trustless Agents").** Draft ERC, three registries: Identity (ERC-721 agent id plus registration file/URI pointing to endpoints incl. MCP and A2A), Reputation (signed feedback records, off-chain aggregation), Validation (hooks for re-execution, zkML, TEE attestations; least settled, still under revision). Mainnet reference contracts live since early 2026 ([contracts](https://github.com/erc-8004/erc-8004-contracts), [awesome list](https://github.com/sudeepb02/awesome-erc8004)). Known weakness: Sybil/fake feedback; one analysis claims many registered agents are dead (unverified). **Concordium is not EVM**, so ERC-8004 contracts cannot be deployed there as-is. Realistic path: implement the same three-registry interface (identity/reputation/validation) as a Concordium smart contract (Rust, Wasm) or use Concordium's ID layer (verifiable credentials, zero-knowledge identity) as the identity root, and publish an ERC-8004-shaped registration JSON. Check Concordium hackathon docs for which contract language and SDK they expect.

**Composition.** ERC-8004/Concordium registry = who the agent is and its track record (discovery + accountability) -> registration file points to the A2A Agent Card (agent-to-agent tasks) and MCP endpoint (tool access for LLM clients) -> x402 gates both transports with a 402 challenge -> verdicts get hashed and anchored on-chain, reputation updated when outcomes (rug or not) resolve.

## 3. Swarm patterns and talks

Patterns, in order of demo value:
1. **Specialists + judge (orchestrator-worker).** Parallel independent analysts, each emitting a typed finding; judge aggregates. Default.
2. **Confidence-weighted voting.** score = sum(w_i * c_i * s_i) / sum(w_i * c_i), where w_i is a reputation weight, c_i self-confidence, s_i risk score. Trivial to explain, easy to visualize.
3. **Reputation-weighted ensemble.** w_i updated from backtests and from resolved outcomes; this is the bridge to the on-chain Reputation registry.
4. **Debate/challenge round, bounded.** Only run when specialists disagree beyond a threshold (e.g. holder agent says safe, bundle agent says critical). One rebuttal round, then judge. Shows deliberation without cost blowup.
5. **Blackboard.** Shared structured state (token facts: wallets, clusters, tx graph) that agents read and append to; avoids refetching and enables cross-agent hints (cluster finder posts wallet groups, sniper agent reuses them).
6. **Stigmergy.** Agents leave marks (flagged wallets, known-bad funders) in shared memory that later queries inherit. Cheap to implement as a persistent wallet-flag table; strong story: the swarm gets smarter with every query.

Visible swarm in UI: a node graph with the judge at the center and 6 specialist nodes that light up while working, streaming one-line findings as they arrive (SSE), each edge thickness = confidence-weighted vote, a live needle/gauge moving toward the verdict, a "dissent" badge when an agent disagrees, and a wallet-cluster graph overlay showing funding links. Replay a past verdict step by step.

Reading list (takeaway each):
- [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system): orchestrator + parallel subagents beat single agent but cost ~15x tokens; give each worker a clear objective and output format, and evaluate with small samples early.
- [Wang et al., Mixture-of-Agents](https://arxiv.org/abs/2406.04692): layered aggregation of multiple models outperforms the single best; aggregator quality matters.
- [Cemri et al., Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657): most failures are specification and inter-agent misalignment, not model capability; use strict schemas and verification.
- [Cognition, Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents): shared context matters; parallel agents making conflicting decisions is fragile. Argues for our design only if workers are read-only analysts (they are).
- [Anthropic, Building effective agents](https://www.anthropic.com/research/building-effective-agents): prefer simple composable workflows (routing, parallelization, evaluator) over frameworks.
- [Du et al., Improving factuality via multiagent debate](https://arxiv.org/abs/2305.14325): debate helps on reasoning/factuality but with diminishing returns after 2 rounds.
(Links from memory; talk and paper existence is solid but I did not re-fetch each page.)

## 4. Hackathon-winning patterns

Evidence is thin: I found no published Encode rubric. Encode requires a codebase and a demo video of at most 3 min ([Encode submission guide](https://encodeclub.notion.site/How-and-what-should-I-submit-40431f59f53d4264a88ea89595697fec)); generic guides ([Reskilll](https://blogs.reskilll.com/what-hackathon-judges-look-for-complete-judging-criteria-breakdown-2026/), [Devfolio](https://guide.devfolio.co/docs/guide/participating-in-hackathons/judging-1), [Sustained: five wins](https://sustained.substack.com/p/lessons-from-winning-five-hackathons)) agree: working demo over slides, a sharp real problem, sponsor-tech used in a load-bearing way, polish, and the video is the main artifact.

Rewarded: live end-to-end on real mainnet data; sponsor tech that cannot be removed without breaking the product; a number (accuracy on known rugs); one memorable visual. Pitfalls: mocked data presented as real; integrations that are decorative; too many features; no README/run instructions; demo that depends on live luck (cache a fallback); video that starts with slides.

3-minute video: 0:00-0:20 problem (one real rug, one sentence, cost in dollars). 0:20-0:50 paste a token address, swarm lights up. 0:50-1:50 walk the verdict: each agent's finding, one dissent resolved, final verdict. 1:50-2:25 an external agent calls Sentinel through MCP/A2A, hits 402, pays, gets verdict; show the Concordium registration and reputation entry. 2:25-2:50 proof: backtest on N historical rugs vs safe tokens. 2:50-3:00 roadmap and URL. Record a take with a pre-warmed cache.

## 5. LLM choice

Model IDs per the task brief: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5. I did not verify pricing or limits; check the [Anthropic models page](https://docs.anthropic.com/en/docs/about-claude/models) before budgeting. Use `@anthropic-ai/sdk` (Apache-2.0).

- **Allocation.** Haiku for specialist narration/explanations over precomputed numbers; Sonnet for the judge and for the ambiguous specialists (creator-history, bundle interpretation); Opus only for an optional "deep audit" paid tier. 
- **Structured output.** Define the verdict as a tool with a JSON schema and force `tool_choice`, or use native structured outputs if available on the chosen model; validate with zod, retry once on failure.
- **Latency.** Run 5-7 specialists in parallel (wall time = slowest, ~2-5 s with Haiku/Sonnet on short prompts); judge adds one serial call. Target p50 under 10 s including RPC fetches; stream partials. Use prompt caching for the static system prompts and rubric.
- **Cost.** Keep each specialist prompt to a compact feature JSON (hundreds of tokens), not raw transactions. Price per query via x402 well above token cost.
- **Deterministic vs LLM.** Deterministic code (no LLM): top-N holder concentration, mint/freeze authority, LP lock/burn, sniper detection (buys in first N slots), bundle detection (same-slot transfers), common-funder clustering (graph traversal), creator launch count. These are facts; the LLM must never compute them. LLM only for: interpreting patterns against the creator's history, producing the human-readable rationale, reconciling disagreements, and flagging novel tricks. This also makes the system reproducible and cheap, and is the honest answer to "is it just GPT in a trench coat".

## Recommendation for Sentinel

**Agents** (each = deterministic feature extractor + short LLM interpretation, output a Finding):
1. HolderAgent: top holders, Gini, excluding LP/burn addresses.
2. SniperAgent: early-slot buyers, their current holdings, sell behavior.
3. BundleAgent: same-slot/same-block coordinated buys and transfers.
4. FundingGraphAgent: common funding source clustering of top holders (the signature "swarm" visual).
5. CreatorAgent: deployer's prior tokens, outcomes, cross-links to flagged wallets (reads stigmergic flag table).
6. AuthorityLiquidityAgent: mint/freeze authority, LP lock/burn, liquidity depth, sell simulation (honeypot check) where possible.
7. Judge: aggregates, runs a challenge round if spread is high, emits the verdict.

**Blackboard:** token facts + wallet flags in a store (SQLite/Postgres or Redis). **Consensus rule:** hard-veto first (active freeze authority, unlocked mintable supply, or confirmed honeypot forces RED regardless of votes), else confidence-and-reputation-weighted mean of agent scores; spread > 0.35 triggers one debate round; verdict bands GREEN < 35 <= AMBER < 65 <= RED; final confidence = 1 - normalized dissent, capped by data completeness.

**Verdict JSON sketch:**
```json
{
  "schema": "sentinel.verdict/1",
  "token": "<mint>", "chain": "solana", "ts": 0,
  "verdict": "RED", "riskScore": 82, "confidence": 0.77,
  "vetoes": ["freeze_authority_active"],
  "findings": [{"agent": "bundle", "agentId": "<concordium-id>", "score": 90,
    "confidence": 0.8, "weight": 1.1, "evidence": [{"kind":"tx","ref":"<sig>"}],
    "summary": "..."}],
  "dissent": [{"agent": "holder", "score": 30, "rebuttal": "..."}],
  "consensus": {"rule": "veto+weighted_mean", "spread": 0.41, "debateRounds": 1},
  "attestation": {"hash": "<sha256 of canonical JSON>", "concordiumTx": "<hash>", "agentRegistry": "<ref>"}
}
```

**Where protocols sit.** Gateway service in front of the orchestrator exposes (a) MCP Streamable HTTP tool `assess_token(mint)` and (b) A2A Agent Card plus `message/send` with streaming; both wrapped by x402 middleware (402 challenge, verify via facilitator, then run). Each specialist is registered on Concordium (identity + reputation record); the Judge anchors the verdict hash; a resolver job later marks outcomes and updates agent reputation, which feeds the voting weights. Optionally expose specialists individually over A2A so third-party agents can hire one.

**Five things that make judges say "winner":**
1. A live mainnet demo where the swarm catches a real, recent rug, with the funding-graph visual.
2. A published backtest (precision/recall on N known rugs vs N healthy tokens), showing the swarm beats any single agent (ablation chart).
3. A second, independent agent (not ours, e.g. a Claude client) buys a verdict end to end via MCP/A2A and x402 on camera.
4. Concordium doing real work: agent identity, anchored verdict hashes, and reputation that visibly changes voting weights after outcomes resolve.
5. Honest engineering: deterministic facts vs LLM judgment clearly separated, dissent shown, confidence calibrated, and a repo anyone can run in one command.
