# @sentinel/concordium

Everything that makes the swarm accountable on Concordium testnet.

| Piece | What it does | Where |
|---|---|---|
| **Agent Registry (CIS-8004)** | One Agent Card and one agent NFT per Sentinel agent (gateway, judge, six specialists) under the owner's ID-backed account. Cards are built by the hosted registry MCP, hosted byte-exact by the gateway, and pinned on-chain by SHA-256. Consumers call `check_badge` before trusting a verdict. | `src/registry.ts`, `src/agents-manifest.ts`, `src/scripts/register-agents.ts` |
| **Audit trail contract** | `sentinel_audit`: append-only log of verdict digests (Rust, concordium-std 11). `record` is restricted to authorised submitters (the judge), there is no update or delete, every record emits a `Verdict` event. EU AI Act Art. 12 record keeping. `grade` appends the outcome at a horizon beside the record. | `audit-contract/`, `src/audit.ts`, `src/scripts/deploy-audit.ts` |
| **Verdict track** | Resolver grades every sealed verdict against what happened (1h / 24h / 7d), anchors the grade, and `/track` publishes Brier, skill vs base rate, reliability and per-specialist scores. The accountability the registry badge does not carry. | `src/track.ts`, `GET /track`, MCP `sentinel_track` |
| **x402 pay-per-verdict** | `POST /x402/verdict` answers 402 with Concordium payment requirements; the paying agent signs a V1 sponsored CCD transfer, our facilitator sponsors the fee and submits, the verdict streams back. Agents pay agents, no API keys. | `src/x402.ts`, `src/gateway.ts`, `src/scripts/serve.ts`, `src/scripts/pay-for-verdict.ts` |

## Build and test

```bash
# contract (needs rustup target wasm32v1-none and cargo-concordium 5)
cd audit-contract && cargo concordium build --out sentinel_audit.wasm.v1 --schema-out schema.bin && cargo test
# TypeScript
npm run build -w concordium && npm test -w concordium
```

The TS tests use fake fetch for the registry, the real module schema for parameter encoding, and an in-process facilitator for the 402 handshake. No keys, no network.

## Going live on testnet

1. Put wallet export files in `keys/` (gitignored) and point `.env` at them: `CONCORDIUM_OWNER_WALLET`, `CONCORDIUM_SUBMITTER_WALLET`, `CONCORDIUM_SPONSOR_WALLET`, `CONCORDIUM_PAYER_WALLET`. Each account needs faucet CCD.
2. Set `SENTINEL_BASE_URL` to the public https origin that will serve the cards (the gateway, behind a tunnel or a host).
3. `node dist/scripts/deploy-audit.js` deploys and initialises the contract; writes `cards/audit-contract.json`.
4. `node dist/scripts/register-agents.js` registers the eight agents; writes `cards/*.json` and `cards/registry.json` (token ids, badge addresses, tx hashes). `--dry-run` only builds cards.
5. `node dist/scripts/serve.js` runs the gateway on 4020 (cards, x402 verdicts, audit) and the facilitator on 4021.
6. `node dist/scripts/pay-for-verdict.js <mint>` buys one verdict as an external agent and prints the 402 → paid → verdict trace with the CCDScan link.

## Contract interface

```
init    sentinel_audit            InitParam { submitters: [AccountAddress] }
receive record                    RecordParam { digest: [u8;32], chain, subject, verdict, risk_score: u8, agent_ids: [u64], observed_at: u64 } → u64 seq
receive view                      u64 → Record
receive count                     → u64
receive info                      → Info { admin, submitters, count }
receive setSubmitter (admin)      SubmitterParam { account, allowed }
receive grade                     GradeParam { seq, horizon: u32, labels: [String], rugged: bool, liquidity_bps: u16, price_bps: u16, observed_at: u64 }  (submitters; once per horizon; never edits the record)
receive grades                    u64 → [Grade]
event   Verdict { seq, digest, chain, subject, verdict, risk_score, agent_ids, submitter } · Graded { seq, horizon, rugged, liquidity_bps, submitter } · SubmitterChanged { account, allowed }
```

### The track

A verdict is a probability (`risk_score / 100` = P(rug)) sealed on chain before the outcome. The resolver (`src/track.ts`) re-reads the market at 1h, 24h and 7d, grades the outcome with the labels of arXiv:2608.20271 (TVL rug: liquidity down more than 99%; idle: no trades left; plus price collapse and creator exit), and records the grade beside the verdict with `grade`. `GET /track` and the MCP tool `sentinel_track` score the whole history: Brier and log score, skill against the base rate, a reliability diagram, and the same per specialist. The verdict record is never touched; a grade is one more append.

Testnet registry contracts: CIS-8004 `<12802,0>`, CIS-8 `<12801,0>`; hosted MCP `https://agent-registry-mcp.concordium.com/mcp`.
