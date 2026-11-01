# Deploy — sentinelagent.pro

Two public hostnames, both served from the machine that runs Sentinel, through one Cloudflare named tunnel.
Nothing listens on a public port; Cloudflare terminates TLS and forwards to localhost.

| Hostname | Origin | What it serves |
|---|---|---|
| `api.sentinelagent.pro` | `http://localhost:4020` | gateway, Agent Cards (byte-exact), MCP `/mcp`, A2A `/a2a`, x402 `/x402/verdict`, SSE streams |
| `sentinelagent.pro` | `http://localhost:3100` | the Next.js site (`npm run build -w web && npm run start -w web -- -p 3100`) |

## 1. DNS — move the zone to Cloudflare (one-time, at GoDaddy)

Cloudflare Tunnel needs to own the DNS records, so the domain is delegated to Cloudflare; GoDaddy keeps the registration only.

1. Cloudflare dashboard → *Add a site* → `sentinelagent.pro` → Free plan. Cloudflare shows two nameservers, e.g. `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`.
2. GoDaddy → *My Products* → domain → *DNS* → *Nameservers* → *Change* → *I'll use my own nameservers* → paste the two Cloudflare nameservers → Save.
3. Delete nothing else at GoDaddy; its default A/CNAME records stop mattering once the nameservers change. Propagation is usually 5–30 minutes (up to 24 h).

Do not add A or CNAME records by hand at GoDaddy: the tunnel creates the right CNAMEs in Cloudflare in step 2.

## 2. Tunnel (on the Sentinel machine)

```bash
brew install cloudflared                       # already installed: 2026.10.6
cloudflared tunnel login                       # opens the browser, pick sentinelagent.pro
cloudflared tunnel create sentinel             # writes ~/.cloudflared/<id>.json  (keep it out of the repo)
cloudflared tunnel route dns sentinel api.sentinelagent.pro
cloudflared tunnel route dns sentinel sentinelagent.pro
cp deploy/cloudflared.example.yml ~/.cloudflared/config.yml   # fill in tunnel id and credentials path
cloudflared tunnel run sentinel
```

Keep it running as a service so the cards stay reachable while the registry badge is checked:

```bash
sudo cloudflared service install               # launchd on macOS; logs under /Library/Logs/com.cloudflare.cloudflared.*
```

## 3. Sentinel env for the public origin

In `.env` (never committed):

```
SENTINEL_BASE_URL=https://api.sentinelagent.pro
SENTINEL_CORS_ORIGINS=https://sentinelagent.pro,http://localhost:3100
NEXT_PUBLIC_SENTINEL_API_URL=https://api.sentinelagent.pro
```

Then rebuild the site (`NEXT_PUBLIC_*` is baked in at build time) and restart the API.
The Agent Cards embed `SENTINEL_BASE_URL`, so change it **before** registering agents; a later change needs `set-agent-uri` on every registered agent.

## 4. Register the agents

```bash
curl -s https://api.sentinelagent.pro/healthz
curl -s https://api.sentinelagent.pro/agents/judge/agent-card.json | shasum -a 256   # must match the hash the registry stores
node concordium/dist/scripts/register-agents.js
```

## Cloudflare settings that matter

- SSL/TLS → *Full* is fine (origin is plain http on loopback; the tunnel is encrypted end to end).
- Do not enable *Rocket Loader* / *Auto Minify* / *Email obfuscation* on `api.*`: they rewrite bodies, and Agent Cards must be served byte-exact. Simplest: a Configuration Rule for hostname `api.sentinelagent.pro` that disables all performance features.
- Cache: leave default. The API sends `cache-control: no-store` on streams; Cloudflare does not buffer `text/event-stream`.
- Rate limiting at the edge is optional; the API already has a per-IP token bucket.

## Later: site on Vercel instead of the tunnel

If the site moves to Vercel, keep `api.*` on the tunnel and point the apex at Vercel in Cloudflare DNS (A `@` → `76.76.21.21`, CNAME `www` → `cname.vercel-dns.com`, both **DNS only**, grey cloud). Remove the apex ingress rule from the tunnel config.
