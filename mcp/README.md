# @sentinel/mcp

The agent-facing surface of Sentinel, mounted on one Hono app together with the Concordium gateway.

| Endpoint | Protocol | What |
|---|---|---|
| `POST /mcp` | MCP Streamable HTTP (stateless) | Tools `sentinel_verdict` (paid over x402 when a paywall is configured; streams progress notifications), `sentinel_agents`, `sentinel_check_badge`, `sentinel_audit` |
| `POST /a2a`, `GET /a2a` | A2A v1.0 JSON-RPC (+SSE) | `SendMessage` / `SendStreamingMessage` with a mint → Task: submitted → working (one status per specialist) → completed with the verdict as a data artifact. The card carries the Verified by Concordium extension |
| `GET /.well-known/agent-card.json` | registry card, byte-exact | Hash-pinned on the Concordium Agent Registry |
| `POST /x402/verdict` | HTTP + x402 | Pay-per-verdict for plain HTTP agents |
| `GET /verdicts`, `GET /verdicts/:digest` | JSON | Recent verdicts and the full record behind a digest |

Pay per verdict, not per protocol message: on `/mcp` only `tools/call sentinel_verdict` goes through the x402 gate, so `initialize`, `tools/list`, agent discovery and badge checks are free.

## Run

```bash
npm run build
node mcp/dist/scripts/serve.js                       # :4020, reads .env (every Concordium piece optional)
node mcp/dist/scripts/mcp-client-demo.js <mint>      # an external agent: lists tools, checks the badge, buys a verdict, prints progress
SENTINEL_SEED_SNAPSHOTS=./snapshots node mcp/dist/scripts/serve.js   # pre-warmed TokenSnapshot JSON files for the demo
```

Claude Desktop / any MCP client: add `http://<host>:4020/mcp` as a Streamable HTTP server. To pay, the client's fetch must be x402-aware (`payingFetch` from `@sentinel/concordium`, see `mcp-client-demo.ts`).

## Tests

`npm test -w mcp` drives the real MCP client SDK against the app in-process (fake model, offline fixtures): tools list, verdict with progress + logging notifications, audit lookup, A2A card, blocking and streaming tasks.
