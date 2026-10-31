# Sentinel — accountable anti-rug agent swarm on Concordium

Hackathon entry: Encode × Concordium "Make your Agents Accountable" (2 Nov – 9 Dec 2026, submissions close Wed 9 Dec 23:59 UTC). Standalone product, separate from CARPET (the owner's Solana launchpad at carpet.money, repo ../carpet-redesign). Nothing from CARPET's contracts, backend, keys or deploys lives here; only analysis logic was ported into `engine/`.

## Owner & working style
- Russian-speaking founder; reply in Russian, keep English in code and docs.
- Wants end-to-end execution, premium cohesive design, honest opinions. No AI attribution in commits, professional commit messages, never commit secrets or RPC/API keys. Don't push/commit without an explicit ask.
- Public repo is a submission requirement, so every file here is assumed public.

## What we are building
A swarm of specialised analysis agents that judges whether a Solana token is a rug, exposed to other agents through MCP/A2A, paid per query over x402, with every agent registered in the Concordium Agent Registry under a Verified by Concordium badge (a verified human — the owner — stands behind it) and every verdict hashed into an on-chain audit trail (EU AI Act Art. 12). Token creators can attach a Concordium ID proof ("verified human, 18+") without any personal data being stored.

Concordium components used (judging rewards depth): Concordium ID / Verify and Access · Agent Registry + Verified by Concordium badge · MCP server · x402 payments · sponsored transactions (optional) · audit contract on testnet.

## Layout
- `docs/BRIEF.md` — the hackathon brief, dates, judging, submission list
- `docs/CONCEPT.md` — product concept, architecture, swarm design, demo flow, path to production
- `docs/research/` — research notes (Concordium stack, agent frameworks, competitors, design references)
- `engine/` — TypeScript analysis engine (holders, snipers, bundles, funding graph, creator history, authorities), chain-agnostic core + Solana adapter; ported from CARPET's indexer
- `agents/` — swarm orchestrator: specialist agents, consensus, verdict schema
- `concordium/` — registry registration, ID proofs, x402 server, audit contract (Rust, concordium-std)
- `mcp/` — MCP + A2A surface for other agents
- `web/` — showcase site: live verdicts, agent cards, audit explorer; motion-first (anime.js / Motion.dev, kokonutui-style components)

## Conventions
- npm workspaces, TypeScript strict, Node 22. Tests with vitest. One package per folder above.
- Secrets only in `.env` (gitignored); `.env.example` documents every variable.
- Design language: black, dot-matrix display type, one red accent, white pills — same family as CARPET so the two products read as siblings, but Sentinel has its own mark.
