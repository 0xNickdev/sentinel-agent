import { Session } from "@/components/term/Session";

export default async function Home({ searchParams }: { searchParams: Promise<{ mint?: string; fresh?: string; n?: string }> }) {
  const { mint, fresh, n } = await searchParams;
  return <Session initialMint={mint ?? ""} fresh={fresh === "1"} nonce={n ?? ""} />;
}
