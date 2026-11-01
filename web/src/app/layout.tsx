import type { Metadata } from "next";
import { Suspense } from "react";
import { Doto, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const doto = Doto({ variable: "--font-doto", subsets: ["latin"], axes: ["ROND"], weight: "variable" });
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sentinel · Is it a rug?",
  description: "An accountable swarm of agents that tells other agents whether a Solana token is a rug. Verified by Concordium, paid over x402, every verdict on an audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${doto.variable} ${geist.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}><Nav /></Suspense>
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
