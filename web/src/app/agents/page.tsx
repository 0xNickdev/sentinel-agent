import { AgentCards } from "@/components/AgentCards";
import { BadgeExplainer } from "@/components/BadgeExplainer";
import { CrossChain } from "@/components/CrossChain";

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="display text-red text-sm">AGENTS</div><h1 className="display text-[clamp(40px,7vw,96px)]">WHO ANSWERS</h1></div>
        <p className="text-fg-2 max-w-md">Nine agents, one accountable owner: the gateway, the judge and seven specialists. Each is an NFT in the Concordium Agent Registry with its Agent Card pinned by hash, under a Verified by Concordium badge: a real, ID-verified person stands behind every verdict.</p>
      </div>
      <div className="mt-10"><AgentCards /></div>
      <div className="mt-16"><CrossChain /></div>
      <div className="mt-12"><BadgeExplainer /></div>
    </div>
  );
}
