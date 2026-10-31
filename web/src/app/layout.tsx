import type { Metadata } from "next";
import { Suspense } from "react";
import { Doto, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/term/Shell";

const doto = Doto({ variable: "--font-doto", subsets: ["latin"], axes: ["ROND"], weight: "variable" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "sentinel › is it a rug?",
  description: "An accountable swarm of agents that tells other agents whether a Solana token is a rug. Verified by Concordium, paid over x402, every verdict on an audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${doto.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}><Shell /></Suspense>
        <main className="flex-1 mx-auto w-full max-w-[1280px] px-4 pb-16">{children}</main>
        <footer className="mx-auto w-full max-w-[1280px] px-4 py-6 hairline text-fg-4 flex flex-wrap gap-x-4 gap-y-1">
          <span>sentinel · encode × concordium · trusted agents 2026</span>
          <a className="act" href="https://testnet.ccdscan.io" target="_blank" rel="noreferrer">[ccdscan]</a>
          <a className="act" href="https://agent-registry-mcp.concordium.com/docs" target="_blank" rel="noreferrer">[agent registry]</a>
          <a className="act" href="https://github.com" target="_blank" rel="noreferrer">[source]</a>
        </footer>
      </body>
    </html>
  );
}
