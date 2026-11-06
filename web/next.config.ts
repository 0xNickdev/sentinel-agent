import type { NextConfig } from "next";

// The site talks to the Sentinel server through a same-origin proxy so the
// browser needs no CORS and no API URL: /sentinel/* → SENTINEL_API_URL/*.
const api = process.env.SENTINEL_API_URL ?? "http://localhost:4020";

const nextConfig: NextConfig = {
  // Phones on the LAN open /verify/open from the ID App QR during local testing (e.g. SENTINEL_DEV_ORIGINS=192.168.1.20).
  allowedDevOrigins: (process.env.SENTINEL_DEV_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/sentinel/:path*", destination: `${api}/:path*` },
      // Agents look for /llms.txt at the site root; the API writes it so prices and URLs stay current.
      { source: "/llms.txt", destination: `${api}/llms.txt` },
    ];
  },
};

export default nextConfig;
