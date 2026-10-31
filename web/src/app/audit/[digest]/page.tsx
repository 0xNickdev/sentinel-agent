import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApi, short, type Verdict } from "@/lib/api";
import { Report } from "@/components/term/Report";
import { Label } from "@/components/term/Log";

export const dynamic = "force-dynamic";

/** One stored record: the same report renderer as the live session, plus the stored transcript. */
export default async function AuditRecord({ params }: { params: Promise<{ digest: string }> }) {
  const { digest } = await params;
  if (!/^[0-9a-f]{64}$/.test(digest)) notFound();
  const res = await fetch(`${serverApi()}/verdicts/${digest}`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) notFound();
  const v = (await res.json()) as Verdict;
  return (
    <div>
      <Label><Link href="/audit" className="act">audit</Link> › record {short(digest, 12)}{v.stored ? ` · stored ${new Date(v.stored.at * 1000).toISOString().slice(0, 19).replace("T", " ")}Z` : ""}</Label>
      <Report v={v} transcript />
    </div>
  );
}
