// Register the eight Sentinel agents in the Concordium Agent Registry.
//   node dist/scripts/register-agents.js [--dry-run] [--only gateway,judge]
// Flow per agent: build pre-mint card → register (mints NFT, pins uri+hash) →
// rebuild card with token_id → write card to cards/ → setAgentURI with the new
// hash. Cards must then be served byte-exact at SENTINEL_BASE_URL (gateway.ts).
// Needs CONCORDIUM_OWNER_WALLET (export file) and SENTINEL_BASE_URL in .env.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransactionHash } from '@concordium/web-sdk';
import { loadEnv } from '@sentinel/agents';
import { agentCards, SENTINEL_AGENT_KEYS, type SentinelAgentKey } from '../agents-manifest.js';
import { accountFromEnv, nodeClient, updateContract } from '../chain.js';
import { buildAgentCard, buildRegister, buildSetAgentUri, sha256Hex, tokenAddress, type Network } from '../registry.js';

loadEnv();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] ?? '').split(',') as SentinelAgentKey[] : [...SENTINEL_AGENT_KEYS];
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const baseUrl = process.env.SENTINEL_BASE_URL;
if (!baseUrl) { console.error('SENTINEL_BASE_URL is required (public https origin where cards are served)'); process.exit(1); }
const owner = accountFromEnv('CONCORDIUM_OWNER');
if (!owner && !dry) { console.error('CONCORDIUM_OWNER_WALLET (wallet export file) is required'); process.exit(1); }
const ownerAddress = owner?.address.toString() ?? process.env.CONCORDIUM_OWNER_ADDRESS ?? '3whdieGHx43KKRwQYbC5pAUdmWZ61B7yreNRU9i36MtdCvajR8';

const here = dirname(fileURLToPath(import.meta.url));
const cardsDir = join(here, '..', '..', 'cards', ...(dry ? ['dry-run'] : []));
const registryFile = join(cardsDir, 'registry.json');
mkdirSync(cardsDir, { recursive: true });
const registry: Record<string, { tokenId: number; tokenAddress: string; agentUri: string; metadataHash: string; registerTx?: string; setUriTx?: string }> = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) : {};
const client = dry ? null : nodeClient(network, process.env.CONCORDIUM_NODE);
const log = (m: string) => console.error(m);

const adopt = new Map<string, { tokenId: number; tx: string }>();
for (let i = 0; i < args.length; i++) if (args[i] === '--adopt') { const [k, rest] = (args[i + 1] ?? '').split('='); const [id, tx] = (rest ?? '').split(','); if (k && id && tx) adopt.set(k, { tokenId: Number(id), tx }); }
const cards = agentCards({ baseUrl, ownerAccount: ownerAddress });
for (const key of only) {
  const input = cards[key];
  log(`\n■ ${key}: ${input.name}`);
  const existing = registry[key];
  if (existing && !args.includes('--force')) { log(`  already registered as token ${existing.tokenId} (${existing.tokenAddress}); use --force to redo`); continue; }

  const pre = await buildAgentCard(network, input);
  log(`  pre-mint card hash ${pre.metadata_hash_hex}`);
  if (dry) { writeFileSync(join(cardsDir, `${key}.json`), pre.agent_card_json); log(`  dry-run: wrote ${key}.json`); continue; }

  // --adopt key=tokenId,txHash: finish an agent whose register transaction already went through (no second mint).
  const adopted = adopt.get(key);
  let tokenId: number | null;
  let r1: { hash: string; explorer: string };
  if (adopted) {
    tokenId = adopted.tokenId; r1 = { hash: adopted.tx, explorer: `https://${network === 'mainnet' ? '' : 'testnet.'}ccdscan.io/transactions/${adopted.tx}` };
    log(`  adopting token ${tokenId} from ${r1.explorer}`);
  } else {
    const reg = await buildRegister(network, ownerAddress, input.agentUri, pre.metadata_hash_hex);
    const sent = await updateContract(client!, network, owner!, reg.contract_address, reg.receive_name, reg.parameter_hex, reg.suggested_energy ?? 30_000, log);
    r1 = sent;
    log(`  registered: ${sent.explorer}`);
    // The minted token id is in the Registered event; read it from the summary logs.
    tokenId = tokenIdFromSummary(sent.summary);
    // The send result may carry only the outcome header; the node's block item status has the full event log.
    if (tokenId == null) tokenId = tokenIdFromSummary(await client!.getBlockItemStatus(TransactionHash.fromHexString(sent.hash)));
    if (tokenId == null) throw new Error(`could not read token_id from ${sent.explorer}; rerun with --adopt ${key}=<tokenId>,${sent.hash}`);
  }
  log(`  token_id ${tokenId}`);

  const final = await buildAgentCard(network, { ...input, tokenId });
  writeFileSync(join(cardsDir, `${key}.json`), final.agent_card_json);
  if (sha256Hex(readFileSync(join(cardsDir, `${key}.json`))) !== final.metadata_hash_hex) throw new Error('written card does not hash to the service hash');
  const set = await buildSetAgentUri(network, ownerAddress, tokenId, input.agentUri, final.metadata_hash_hex);
  const r2 = await updateContract(client!, network, owner!, set.contract_address, set.receive_name, set.parameter_hex, set.suggested_energy ?? 30_000, log);
  const addr = await tokenAddress(network, tokenId);
  registry[key] = { tokenId, tokenAddress: addr.token_address, agentUri: input.agentUri, metadataHash: final.metadata_hash_hex, registerTx: r1.hash, setUriTx: r2.hash };
  writeFileSync(registryFile, JSON.stringify(registry, null, 2));
  log(`  badge ${addr.token_address} · card pinned ${r2.explorer}`);
}
console.log(JSON.stringify(registry, null, 2));

/** CIS-8004 Registered event: tag 0xF0, then token id as u64 LE (see registry MCP `recent_registrations` raw_hex). */
function tokenIdFromSummary(summary: unknown): number | null {
  // The SDK nests contract events differently across versions (summary.events[].events, contractUpdated[].events, …):
  // walk everything and take the first hex string that is a Registered event.
  const hex: string[] = [];
  const walk = (o: unknown): void => {
    if (typeof o === 'string') { if (/^f0[0-9a-f]{18,}$/i.test(o)) hex.push(o); return; }
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
  };
  // SDK event objects serialise to hex through toJSON; round-trip so the walker sees strings.
  walk(JSON.parse(JSON.stringify(summary ?? null, (_, v) => (typeof v === 'bigint' ? v.toString() : v))));
  for (const ev of hex) {
    const len = parseInt(ev.slice(2, 4), 16);
    if (!len || len > 8 || ev.length < 4 + len * 2) continue;
    return parseInt(ev.slice(4, 4 + len * 2).match(/../g)!.reverse().join(''), 16);
  }
  return null;
}
