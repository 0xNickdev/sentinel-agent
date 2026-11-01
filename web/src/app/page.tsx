import Link from "next/link";
import { AgentCards } from "@/components/AgentCards";
import { CheckFlow } from "@/components/CheckFlow";
import { Header } from "@/components/Header";
import { LaunchFeed } from "@/components/LaunchFeed";
import { Pricing } from "@/components/Pricing";
import { StatStrip } from "@/components/StatStrip";
import { RecentVerdicts } from "@/components/RecentVerdicts";

export default async function Home({ searchParams }: { searchParams: Promise<{ mint?: string; fresh?: string; n?: string }> }) {
  const { mint, fresh, n } = await searchParams;
  return (
    <>
      <CheckFlow initialMint={mint ?? ""} fresh={fresh === "1"} nonce={n ?? ""} />

      <section className="mx-auto max-w-7xl px-4 py-16">
        <StatStrip />
      </section>

      <LaunchFeed />

      <section className="mx-auto max-w-7xl px-4 py-16">
        <Header kicker="01" title="THE SWARM" copy="Facts are code, judgement is the model. Each specialist sees one evidence domain computed by deterministic, tested code and returns a typed finding. An advocate argues the other side. The judge weighs them under a rule that can override it: hard-fail vetoes, a confidence-weighted mean, one debate round when they split." />
        <AgentCards compact />
        <div className="mt-6"><Link href="/agents" className="pill pill-ghost">All agents and badges</Link></div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <Header kicker="02" title="TODAY'S VERDICTS" copy="Every verdict is stored with its evidence, hashed, appended to an audit contract on Concordium, and graded later against what the token did. Open any tile to see what the swarm saw." />
        <RecentVerdicts limit={8} />
        <div className="mt-6 flex flex-wrap gap-2"><Link href="/audit" className="pill pill-ghost">Audit explorer</Link><Link href="/track" className="pill pill-ghost">Track record</Link></div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <Header kicker="03" title="FOR AGENTS" copy="Sentinel is built to be called by other agents. One price per verdict, settled on Concordium over x402; no API keys, no subscriptions." />
        <Pricing />
        <div className="mt-6"><Link href="/docs" className="pill">Docs · MCP config</Link></div>
      </section>
    </>
  );
}
