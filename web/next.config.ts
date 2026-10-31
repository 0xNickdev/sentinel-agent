import type { NextConfig } from "next";

// The site talks to the Sentinel server through a same-origin proxy so the
// browser needs no CORS and no API URL: /sentinel/* → SENTINEL_API_URL/*.
const api = process.env.SENTINEL_API_URL ?? "http://localhost:4020";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/sentinel/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
