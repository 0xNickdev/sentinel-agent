// Refresh the registered Sentinel agents in place (no new mints).
//   node dist/scripts/refresh-cards.js              rebuild cards/*.json (A2A card + ERC-8004 fields), print hashes
//   node dist/scripts/refresh-cards.js --pin        then pin each changed card on-chain (setAgentURI, same URI, new hash)
//   node dist/scripts/refresh-cards.js --metadata   write the outcome-graded track record into each agent's registry metadata
// Deploy the API with the new card files BEFORE --pin, so the served bytes match the pinned hash.
// Needs CONCORDIUM_OWNER_WALLET and SENTINEL_BASE_URL in .env.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@sentinel/agents';
import { agentCards, type SentinelAgentKey } from '../agents-manifest.js';
import { accountFromEnv, nodeClient, updateContract } from '../chain.js';
import { agentOf, buildAgentCard, buildSetAgentUri, callRegistryTool, withErc8004, type BuiltUpdate, type Network } from '../registry.js';

loadEnv();
const args = process.argv.slice(2);
const pin = args.includes('--pin');
const metadata = args.includes('--metadata');
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const baseUrl = process.env.SENTINEL_BASE_URL;
if (!baseUrl) { console.error('SENTINEL_BASE_URL is required'); process.exit(1); }
const owner = accountFromEnv('CONCORDIUM_OWNER');
if (!owner) { console.error('CONCORDIUM_OWNER_WALLET is required'); process.exit(1); }
const ownerAddress = owner.address.toString();
const log = (m: string) => console.error(m);

const cardsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cards');
const registryFile = join(cardsDir, 'registry.json');
const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as Record<SentinelAgentKey, { tokenId: number; tokenAddress: string; agentUri: string; metadataHash: string; registerTx?: string; setUriTx?: string; refreshTx?: string; metadataTxs?: Record<string, string> }>;
const cards = agentCards({ baseUrl, ownerAccount: ownerAddress });
// The gateway carries Sentinel's CIS-8-bound Solana key (see cis8-bind.ts / link-agent-key.ts).
const cis8File = join(cardsDir, 'cis8.json');
if (existsSync(cis8File)) {
  const b = JSON.parse(readFileSync(cis8File, 'utf8')) as { externalKey: { namespace: string; public_key_hex: string } };
  cards.gateway.externalReference = { kind: 'Cis8', namespace: b.externalKey.namespace, identifier: base58Encode(Buffer.from(b.externalKey.public_key_hex, 'hex')) };
}
const client = pin || metadata ? nodeClient(network, process.env.CONCORDIUM_NODE) : null;
const send = (u: BuiltUpdate) => updateContract(client!, network, owner, u.contract_address, u.receive_name, u.parameter_hex, u.suggested_energy ?? 30_000, log);

for (const key of Object.keys(registry) as SentinelAgentKey[]) {
  const reg = registry[key];
  const input = cards[key];
  const built = await buildAgentCard(network, { ...input, tokenId: reg.tokenId });
  const { json, hash } = input.erc8004 ? withErc8004(built.agent_card_json, input.erc8004) : { json: built.agent_card_json, hash: built.metadata_hash_hex };
  writeFileSync(join(cardsDir, `${key}.json`), json);
  const a = await agentOf(network, reg.tokenId);
  const onChain = (a?.metadata_hash_hex as string | undefined) ?? a?.metadata_hash ?? null;
  log(`■ ${key} (token ${reg.tokenId}) card ${hash.slice(0, 12)}… on-chain ${String(onChain).slice(0, 12)}…${onChain === hash ? ' (pinned)' : ''}`);
  if (pin && onChain !== hash) {
    const r = await send(await buildSetAgentUri(network, ownerAddress, reg.tokenId, reg.agentUri, hash));
    reg.metadataHash = hash; reg.refreshTx = r.hash;
    writeFileSync(registryFile, JSON.stringify(registry, null, 2));
    log(`  pinned ${r.explorer}`);
  }
}

if (metadata) {
  // Reputation from outcomes, not feedback: each agent's graded record, read from the public /track.
  type Summary = { n: number; brier: number | null; skill: number | null };
  const track = await (await fetch(`${baseUrl}/track`)).json() as { verdicts: number; graded: number; horizons: Array<{ label: string; graded: number; judge: Summary; agents: Array<{ agent: string; summary: Summary }> }> };
  const h = track.horizons.find(x => x.label === '24h' && x.graded > 0) ?? track.horizons.find(x => x.graded > 0) ?? track.horizons[0];
  const asOf = new Date().toISOString().slice(0, 10);
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
  for (const key of Object.keys(registry) as SentinelAgentKey[]) {
    const reg = registry[key];
    const s: Summary | undefined = key === 'judge' || key === 'gateway' ? h?.judge : h?.agents.find(a => a.agent === key)?.summary;
    const record = { horizon: h?.label ?? null, graded: s?.n ?? 0, brier: s?.brier ?? null, skill: s?.skill ?? null, verdicts: track.verdicts, asOf, source: `${baseUrl}/track` };
    reg.metadataTxs ??= {};
    for (const [k, v] of [['trackRecord', JSON.stringify(record)], ['trackRecordUrl', `${baseUrl}/track`]] as const) {
      const u = await callRegistryTool<BuiltUpdate>('build_set_metadata', { network, token_id: reg.tokenId, key: k, value_hex: hex(v), sender: ownerAddress });
      const r = await send(u);
      reg.metadataTxs[k] = r.hash;
      writeFileSync(registryFile, JSON.stringify(registry, null, 2));
      log(`  ${key} ${k} ${r.explorer}`);
    }
  }
}

function base58Encode(bytes: Uint8Array): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
