# Concordium developer stack for Sentinel (as of 2026-10-30)

Sources: official docs repo (github.com/Concordium/concordium.github.io, cloned and read), the live hosted MCP service (queried), npm/crates.io, the Encode programme page (as captured in a public repo's notes). "VERIFIED" = read in official docs or tested live. "UNVERIFIED" = my inference.

## 0. Hackathon facts (Encode x Concordium "Trusted Agents Hackathon")
Page: https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon (I could not fetch it directly; the details below come from a verbatim capture in https://github.com/danielx2d4144/noctagent-credit/blob/main/docs/hackathon-rules.md).
- Dates: launch Mon 2 Nov; six workshops Mon/Wed 15:00 UTC (2-18 Nov); build window opens Thu 19 Nov; **Checkpoint 1 Sun 22 Nov 23:59 UTC** (create project, team, idea); office hours Tue/Fri 15:00 UTC; **submissions close Wed 9 Dec 23:59 UTC**; judging 10-11 Dec.
- Must run on **Concordium testnet** and make "meaningful use" of at least one of: Concordium ID / Verify and Access, Agent Registry + badge, x402, PLTs, sponsored transactions, Agent Registry MCP server.
- Submit: description, public repo, demo video <=3 min, **a CCDExplorer link showing agent/contract/transactions**, and a "path to production" (mainnet).
- Judging: depth of Concordium integration, credible path to production, end-to-end demo works, usefulness. Not tx counts. **No prizes advertised** on the page.
- Pre-existing agents explicitly allowed (brief is "take an agent you already run on EVM/Solana and make it accountable"). Suggested directions include "Accountable agents: audit trails supporting EU AI Act Art. 12" and "Private, verified users: gate a service on age" - Sentinel hits four of five directions.
- Past winners: only found the older Concordium ID Connect Hackathon: Hublab (1st, quest platform gated by Concordium ID), ChainRamp (whitelists, age/location checks via ID). Nothing on previous Encode x Concordium events. Reference peer submission: noctagent-credit (agent gated by registry via hosted MCP; early stage).

## 1. Agent Registry (CIS-8004)
Docs: https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/ (cis-8004, cis-8, agent-card, concordium-badge, mcp-service, indexer) and how-to `how-to/integrations/agent-registry.html`.

**Contracts (testnet, from live `contract_info`)**
- CIS-8004 Agent Registry: `<12802,0>`, module `142462ff638f53b7bbeae8911d23579ed23e5e3c7e9a0353606019628121a5c6`, admin `3whdieGHx43KKRwQYbC5pAUdmWZ61B7yreNRU9i36MtdCvajR8`
- CIS-8 External Key Registry: `<12801,0>`, module `3236c12f...9afd`
- Mainnet: CIS-8004 `<10082,0>`, CIS-8 `<10081,0>`. Explorer: https://testnet.ccdscan.io (CCDScan; the hackathon says "CCDExplorer", same purpose; https://ccdexplorer.io also exists).

**Model.** Each agent = CIS-2 NFT (u64 token_id). On-chain state: `owner` (native account), `agent_uri`, `metadata_hash` (SHA-256 of the exact card bytes), optional `external_reference` (Cis8), `metadata` map (reserved key `agentWallet`), `status` Active|Revoked. Entrypoints: `register`, `revoke`, `setAgentURI`, `setMetadata`, `setAgentWallet`, `transfer`, `updateOperator` (+ admin `upgrade`, `setExternalRegistries`). Events: Registered, Revoked, TokenMetadataChanged, Transfer, UpdateOperator. Transfers clear `agentWallet`.

**Agent Card.** One JSON that is simultaneously an ERC-8004 registration file and an A2A v1.0 Agent Card. Fields: `type` (`https://eips.ethereum.org/EIPS/eip-8004#registration-v1`), `name` (<=128), `description` (<=2048), `image`, `version`, `provider{organization,url}`, `supportedInterfaces[{url,protocolBinding,protocolVersion}]`, `capabilities{streaming,pushNotifications,extensions[]}`, `skills[{id,name,description,tags}]`, `services[{name,endpoint,version}]` (e.g. A2A, MCP), `x402Support` (bool), `active`, `registrations[{agentId, agentRegistry:"ccd:<chain>:<index>.<sub>"}]`, `defaultInputModes/OutputModes`.

**Badge.** Not a new contract: the badge string IS the agent's CIS-2 token address, Base58Check (`Mf22soLh1NuZYFgBK8iSs`) or CAIP-19 `ccd:<first 32 hex of genesis hash>/cis-2:<short>`. Mainnet CAIP-2 `ccd:9dd9ca4d19e9393877d2c44b70f89acb`. Testnet genesis prefix is different (I believe `ccd:4221332d34e1694168c2a0c0b3fd0f27`; UNVERIFIED - read it from `get_badge_json` on a real testnet token). Embedded in the card as an A2A extension:
```json
"capabilities":{"extensions":[{"uri":"https://docs.concordium.com/a2a-extensions/concordium-badge/v1","required":false,
 "params":{"tokenAddress":"ccd:<chain>/cis-2:<short>","owner":{"account":"ccd:<chain>:<acct>"},
 "contracts":{"cis8004":"ccd:<chain>:12802.0","cis8":"ccd:<chain>:12801.0"},
 "verification":{"service":"Concordium Agent Registry","verifyUrl":"https://agent-registry-mcp.concordium.com/v1/badge-check/<short>","mcp":"https://agent-registry-mcp.concordium.com/mcp"}}}]}
```
**Verification algorithm (trustless):** parse token address -> confirm contract is a trusted CIS-8004 registry -> `agent_of(token_id)` and require status Active -> fetch `agent_uri`, SHA-256 the raw bytes, compare to `metadata_hash` -> optionally CIS-8 binding. The "badge issuance" is simply registering from an account that has a Concordium identity (the owner account is itself ID-backed); no separate approval step is documented. Note: docs do not say the badge reveals ID attributes; it proves an accountable verified account owns the agent.

**Cross-chain.** Link a Solana/ETH/Cosmos/Fetch.ai key: `build_cis8_canonical_bytes` -> sign with external key -> `build_cis8_register` from the Concordium account -> register agent with `external_reference = Cis8`. Resolve by `agent_by_external_reference` / `owner_of_key`. ERC-8004 tooling reads the card's `registrations` entry. Solana-specific reader tooling: only third-party (npm `concordium-agentgate` 0.2.3, checks found/active/cardHashMatches/verified); no official Solana program found.

**Hosted MCP server (VERIFIED live, no auth, CORS open):**
- MCP: `https://agent-registry-mcp.concordium.com/mcp` (JSON-RPC over HTTP, send `accept: application/json, text/event-stream`); health `/healthz`; Swagger `/docs`; `/openapi.json`. Networks mainnet/testnet/devnet; pass `"network":"testnet"` in tool args. Testnet backend gRPC `https://grpc.testnet.concordium.com:20000`.
- REST: `GET /v1/get-badge-JSON/{badge}`, `/v1/check-badge/{badge|account}` (alias `/v1/badge-check/`), `/v1/verify-agent-card/{badge}`, `/v1/build-set-agent-uri/{badge}`.
- Indexer REST: `https://agent-registry-indexer.concordium.com/`.
- ~40 tools: discovery (`list_agents`, `search_agents`, `recent_registrations`, `recent_transfers`, `agent_history`), lookups (`agent_by_token_address`, `agent_by_external_reference`, `agents_by_owner`, `agent_of`, `get_metadata`, `get_agent_wallet`, `is_active`, `owner_of_key`), builders (`build_register`, `build_revoke`, `build_set_agent_uri`, `build_set_metadata`, `build_set_agent_wallet`, `build_transfer`, `build_update_operator`, `build_set_external_reference`, `build_cis8_*`), utilities (`build_agent_card`, `build_agent_badge`, `get_badge_json`, `check_badge`, `check_account_badges`, `verify_agent_card`, `token_address`, `parse_token_address`, `contract_info`, `network_status`, `agent_registry_capabilities`).
- **Holds no keys.** Builders return `{hex, schema_json}` parameter bytes; you wrap them in an UpdateContract tx and sign/submit yourself (web-sdk `Transaction`/`updateContract` with the receive name `agent_registry.register` style - confirm exact receive names from `schema_json`). Docker for self-hosting: `concordium/agent-registry-mcp:latest`, port 3000.
- GAP: `build_agent_card` call with only `network` errored `missing string name`; schema via `tools/list`. Docs don't give a worked end-to-end testnet registration script; the programme workshops presumably do. Plan to script it: build_agent_card -> host JSON at public HTTPS URL -> SHA-256 -> build_register -> sign -> check_badge.

## 2. Concordium ID / Verify and Access
Docs: `how-to/concordium-id/verify-and-access/*`, `tutorials/verify-access/*`, `tutorials/using-ID-in-dApps/zk-proofs-tutorial`.
- Flow: your backend runs the **Credential Verification Service** (Docker `concordium/credential-verification-service:0.1.0`, ports 8000 API/8001 monitoring, env `CREDENTIAL_VERIFICATION_SERVICE_NODE_GRPC_ENDPOINT=https://grpc.testnet.concordium.com:20000`, `..._ACCOUNT=/keys/private.export` = a funded account that pays ~EUR0.02 anchor fees). Frontend uses `@concordium/verification-web-ui` (0.2.1; tutorial pinned ^0.1.0; SSR-incompatible, use dynamic import) + Reown/WalletConnect project ID. QR scanned by the **Concordium ID App** (or any compatible wallet).
- Steps: (1) `POST {verifier}/verifiable-presentations/create-verification-request` with `{connectionId, resourceId, contextString, public_info, requestedClaims:[{type:"identity", source:["identityCredential"], issuers:[...], statements:[{type:"AttributeInRange", attributeTag:"dob", lower:"19000101", upper:"<today-18y as YYYYMMDD>"}]}]}`; service anchors a Verification Request Anchor (VRA) on-chain. (2) User approves in the app; proof returns to the browser. (3) Backend `POST {verifier}/verifiable-presentations/verify` with `{auditRecordId, presentation, verificationRequest}` -> verified/failed; a Verification Audit Anchor (VAA) is written on-chain. You store the off-chain Verification Audit Record (VAR) yourself; no PII is stored on-chain or by the service.
- Testnet issuers: `did:ccd:testnet:idp:0` ... `idp:3` (mainnet analog `did:ccd:mainnet:idp:0..3`). Create a testnet identity in the wallet with provider "Concordium testnet IP" (instant, fake docs).
- Other statements: `RevealAttribute`, `AttributeInSet`/`NotInSet` (nationality, countryOfResidence, ISO-3166 alpha-2), `AttributeInRange`. "Is a real person": there is no separate liveness attribute; possessing a valid ID credential from a trusted IDP is the claim. Use age>=18 (+ optionally not-in-sanctioned-set) as the proof. UNVERIFIED: whether the verifier service ever returns anything beyond pass/fail for non-revealed attributes (it should not).
- SDKs (npm, current): `@concordium/web-sdk` 12.0.2, `@concordium/wallet-connectors` 0.9.0, `@concordium/browser-wallet-api-helpers` 3.3.0, `@concordium/react-components` 0.9.0-alpha.0, `@concordium/id-app-sdk` 0.1.6 (https://github.com/Concordium/id-app-sdk; docs thin), `@concordium/verification-web-ui` 0.2.1. Deprecated: `@concordium/common-sdk`, `@concordium/node-sdk`. The older direct route (web-sdk Web3 ID / `requestVerifiablePresentation` via browser wallet, `VerifiablePresentation` verify in code) still exists in zk-proofs-tutorial but the Verifier Service path is the documented 2026 one.
- Doc inconsistency: one page says testnet gRPC port 20001, all examples and the hosted MCP use `grpc.testnet.concordium.com:20000`. Use 20000 (verified working by MCP service).

## 3. x402 on Concordium
- Official package: **`@x402/concordium` 2.29.0** (monorepo https://github.com/x402-foundation/x402, deps `@concordium/web-sdk ^12`, `@x402/core ~2.29.0`). Exports `./exact/client`, `./exact/server`, `./exact/facilitator`. Also `@x402/express`, `@x402/hono`, `@x402/fetch`, `@x402/paywall` at 2.29.0.
- Scheme `exact`, network CAIP-2 `ccd:<genesis32>` (mainnet `ccd:9dd9ca4d19e9393877d2c44b70f89acb`; testnet constant exported by the package, check `dist` for the testnet CAIP2 constant). Assets: native CCD (6 dec) and PLTs (e.g. EURR, USDR; decimals fetched from chain). `price:"$0.01"` resolves to StablR USDR by default; register a money parser for another PLT.
- Mechanism: **V1 sponsored transactions**. Client builds + sender-signs a transfer naming the facilitator as sponsor (from `requirements.extra.feePayer`), sends `PAYMENT-SIGNATURE` header with `{signedTransaction, sender}`. Facilitator applies 9 verify rules, adds sponsor signature, submits, waits for finalization (~10s). User never needs CCD for fees (but does need the token to pay).
- Server snippet: `new ExactConcordiumScheme()` from `/exact/server`; route `{scheme:"exact", network, payTo, price:{amount:"10000", asset:"CCD"}}` registered through x402 express/hono middleware.
- Facilitator: `ExactConcordiumScheme({signer: toConcordiumFacilitatorSigner(addr, privKey, {host,port,useTls:true}), requireFinalization:true, finalizationTimeoutMs:60000})`; you host it yourself (no public Concordium facilitator found). It needs a funded sponsor account (CCD for fees). `/supported` advertises feePayer.
- Alternative (community PoC, not needed): https://github.com/rgraulus/xcf-concordium-facilitator (Fastify, PLT transfer matching, JWS receipts; older txHash flow). Official docs page `how-to/integrations/x402-integration` is conceptual only (old txHash + `X-PAYMENT` flow); package README is authoritative.
- Testnet payments need a **PLT**. A native-CCD price works with no PLT request, so use CCD for the demo and PLT as the stretch.

## 4. PLTs and sponsored transactions
- PLT (CIS-7) issuance on testnet is a **manual governance step**: fund account, host metadata JSON (IPFS/Pinata), submit the Google Form linked from https://docs.concordium.com/en/mainnet/tutorials/plt/request-plt.html. Turnaround unknown; request on day one (before Checkpoint 1). Operations after creation via web-sdk (`@concordium/web-sdk@11.0.0` pinned in the PLT tutorial; v12 used by x402 package), concordium-client, rust-sdk. No public faucet for arbitrary PLTs.
- Sponsor service (docs `tutorials/protocol-level-sponsored-transactions/set-up-a-sponsor-service`): Node backend holding sponsor wallet; user's frontend gets a sponsorable tx, sponsor signs:
```ts
const builder = Transaction.tokenUpdate({tokenId: TokenId.fromString(id), operations: Cbor.encode(ops)});
const sponsorable = builder.addMetadata({sender, nonce: nonce.nonce, expiry: TransactionExpiry.futureMinutes(5)})
  .addSponsor(sponsorAccount).build();
const sponsored = await Transaction.sponsor(sponsorable, sponsorSigner);   // Transaction.toJSON(sponsored) to ship over HTTP
```
  Client then signs as sender and submits. Working example: https://github.com/Concordium/concordium-dapp-examples/tree/main/DevnetSponsoredTx. Older contract-level (CIS-3 permit) sponsoring also exists but is not needed.

## 5. Smart contracts and reading chain data
- Toolchain: Rust + `wasm32-unknown-unknown`, `cargo-concordium` **5.0.0** (crates.io; repo https://github.com/Concordium/concordium-smart-contract-tools), `concordium-std` **11.0.0**, `cargo concordium init|build --out m.wasm.v1|test`; verifiable builds `--verifiable docker.io/concordium/verifiable-sc:<rust>`. Deploy/init via `concordium-client` (`module deploy`, `contract init`, `contract update`, `--grpc-ip grpc.testnet.concordium.com --grpc-port 20000 --secure`), or web-sdk/rust-sdk, or `@concordium/ccd-js-gen` 1.2.1 for typed TS clients. Tutorials: docs `tutorials/hello-world`, `how-to/smart-contracts/*`.
- Audit-log contract (my design, UNVERIFIED code, not compiled): state = `StateMap<u64, ([u8;32] hash, Timestamp, AccountAddress submitter)>` + counter; entrypoints `record(hash, subject_id)` (restrict to an authorized-submitter list set at init) and `view(seq)`; **emit a `#[derive(Serialize)]` event via `logger.log(&Event::Verdict{seq, subject, hash})`** on every record. No update/delete entrypoints = append-only. Cheaper alternative needing no contract: `registerData` transactions (up to 256 bytes) carrying the hash; and the CCD-level contract call is only needed for the "audit contract" story judges look for. Do both: contract call is the primary.
- Reading: CCDScan testnet https://testnet.ccdscan.io (contract page shows events); node SDK `ConcordiumGRPCNodeClient("grpc.testnet.concordium.com", 20000, credentials.createSsl())` from `@concordium/web-sdk/nodejs`; useful calls `getBlockItemStatus`, `getModuleEvents`/`getInstanceInfo`, `getBlocksFinalized` + `getBlockTransactionEvents` for indexing. Public gRPC v2 endpoint list in `how-to/infrastructure`; testnet default `grpc.testnet.concordium.com:20000`. Wallet-proxy REST also exists for account tx history. Indexing alternative: https://github.com/Concordium/concordium-transaction-logger (Postgres).

## 6. Wallets / faucet
- Testnet account needs an identity first (Browser Wallet or CryptoX mobile / "Concordium Wallet for Web"; IDP "Concordium testnet IP"). Faucet: wallet -> account -> Activity -> **Request CCD** -> 20,000 CCD, **once per account and only if it has no prior incoming transfers.** No public programmatic faucet API found (GAP). Workaround for many accounts: create each account via wallet, request once, then fund agent/sponsor/facilitator accounts by transfer from the main one. Export keys from the wallet (account `.export` file for Verifier Service/`parseWallet`).
- Programmatic key handling: `buildAccountSigner(parseWallet(file))` or `buildBasicAccountSigner(hexKey)` from web-sdk.

## 7. Build plan implications
**Minimal viable path (priority order)**
1. Day 1: create 3 testnet accounts (agent owner, sponsor/facilitator, audit submitter), faucet each once from a fresh account; file the PLT form (stretch).
2. Registry: write Sentinel orchestrator + each sub-agent's Agent Card (`build_agent_card`), host over HTTPS (stable URL, byte-exact), `build_register` -> sign -> `check_badge`. Add MCP + A2A `services`, `x402Support:true`. Optionally CIS-8-bind the Solana key the swarm uses. Consumers verify via `/v1/check-badge/{badge}` before trusting a peer agent.
3. Audit contract: deploy append-only contract (testnet), call `record(verdict_hash, token_mint)` per verdict; show CCDScan link. Hash = SHA-256 of canonical verdict JSON (store JSON off-chain, content-addressed).
4. x402: `@x402/express` (or hono) + `@x402/concordium` server scheme, self-hosted facilitator with sponsor key, price in CCD first. Agents/clients pay per query without holding fee CCD.
5. Creator ID proof: Verifier Service container + `@concordium/verification-web-ui`, statement dob upper bound (age>=18); on success, write VAA reference and attach a "verified-human creator" flag (store only auditRecordId/anchor hash, never PII) into the verdict, with the hash going to the audit contract.

**Risks**
- Docs are thin on: end-to-end `register` signing code, testnet badge CAIP, id-app-sdk usage, programmatic faucet, PLT turnaround. Budget time in workshops/office hours (Tue/Fri).
- Version drift: verification-web-ui 0.x, x402 package targets web-sdk 12 while PLT tutorial uses 11; pin exact versions.
- Verifier Service needs Docker + public reachability for the mobile ID App/Reown; Reown project ID required; ID App flow is manual in demo (record the video early).
- Facilitator sponsor key is a hot key with CCD; testnet only. Facilitator finality ~10s per payment: latency in demo.
- "Real person" claim = valid Concordium ID credential + age proof; do not market as liveness.
- Honest framing for judges: the badge proves an accountable verified owner exists, it does not prove Sentinel's verdicts are correct. Verdict quality and the path-to-production write-up (mainnet registry `<10082,0>`, mainnet contract, real PLT such as USDR) count under judging.
- Checkpoint 1 (22 Nov) and final (9 Dec 23:59 UTC) are hard dates; submission needs the CCDExplorer link, so deploy the contract and register agents by ~1 Dec.
