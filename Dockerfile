# Sentinel API: gateway (Agent Cards, x402), MCP, A2A, audit and the verdict-track resolver.
# The site (web/) deploys separately; only its package.json is copied so the workspace graph resolves.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY engine/package.json engine/
COPY agents/package.json agents/
COPY concordium/package.json concordium/
COPY mcp/package.json mcp/
COPY web/package.json web/
RUN npm ci -w @sentinel/engine -w @sentinel/agents -w @sentinel/concordium -w @sentinel/mcp --include-workspace-root --no-audit --no-fund
# The lockfile is made on macOS; add the Linux x64 napi binary of the Yellowstone gRPC client (launch feed).
RUN if [ "$(uname -m)" = "x86_64" ]; then npm install --no-save --no-audit --no-fund @triton-one/yellowstone-grpc-napi-linux-x64-gnu@0.3.1; fi
COPY engine engine
COPY agents agents
COPY concordium concordium
COPY mcp mcp
RUN npm run build -w @sentinel/engine -w @sentinel/agents -w @sentinel/concordium -w @sentinel/mcp \
 && npm prune --omit=dev -w @sentinel/engine -w @sentinel/agents -w @sentinel/concordium -w @sentinel/mcp --include-workspace-root

FROM node:22-slim
# The native gRPC client (launch feed) verifies TLS against the system roots, which the slim image does not ship.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SENTINEL_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app /app
# Railway mounts the volume at /data owned by root after the image is built, so ownership set here does not
# survive the mount: the entrypoint fixes it, then drops to the unprivileged node user.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/* && mkdir -p /data
EXPOSE 4020
CMD ["sh", "-c", "chown -R node:node /data && exec gosu node node mcp/dist/scripts/serve.js"]
