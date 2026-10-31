# @sentinel/web

The showcase as one terminal: a persistent `sentinel ›` command line on every page, the home as a session (live launch log, then the swarm log, then the report), `/audit` as an `ls -l` table, `/agents` as a `ps` table, `/docs` as a man page. Next.js 16 (App Router), Tailwind 4.

- Design language: black, Geist Mono for everything, Doto (square dots, `ROND 0`) only for the wordmark and the verdict word, white + three greys + one red. No cards, no gradients, no pills: hairlines, columns, `›` prompts, bracketed `[actions]`, ASCII rules. CLEAN is white, RISKY outlined red, RUGGED solid red. Never green.
- Commands: paste a mint (or `verdict <mint>`), `audit [rugged|danger|risky|clean|anchored|pending|<mint>]`, `agents`, `docs`, `launches`, `help`, `clear`. `/` focuses the prompt.
- Component tree: `components/term/Shell` (command bar) · `Log` (`LogLine`, `Cursor`, `Label`, `KV`) · `Report` (the verdict renderer shared by the home session and `/audit/[digest]`) · `Session`, `LaunchLog`, `StatLine`, `AuditTable`, `AgentsTable`.
- The session never fakes the wait: the swarm streams over SSE (`/stream/verdict`) as `[05.3] agent › …` lines with the real clock; the only motion is appended lines, a blinking cursor and a 180 ms verdict stamp.
- Verdict signatures are verified in the browser (ML-DSA-65 via `@noble/post-quantum`) against the key published at `/.well-known/sentinel-keys.json`.
- Honours `prefers-reduced-motion` (all three animations off).

## Run

```bash
SENTINEL_API_URL=http://localhost:4020 npm run dev -w web      # site on :3000 (JSON via the /sentinel proxy); dev uses :3100 in this repo
NEXT_PUBLIC_SENTINEL_API_URL=http://localhost:4020              # the browser streams SSE straight from the API (CORS: SENTINEL_CORS_ORIGINS)
npm run build -w web && npm run start -w web
```

The API server (`node mcp/dist/scripts/serve.js`) must be running; seed it with `SENTINEL_SEED_SNAPSHOTS=<dir>` for a demo that never waits on RPC.
