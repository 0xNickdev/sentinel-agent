// Bind Sentinel's Solana ed25519 key to the ID-verified owner account through the CIS-8 External Key Registry.
//   node dist/scripts/cis8-bind.js
// Afterwards anyone on Solana can resolve the key: owner_of_key(solana, ed25519, pubkey) → the owner's Concordium
// account → agents_by_owner → the nine Sentinel agents and their Verified by Concordium badges.
// Needs CONCORDIUM_OWNER_WALLET and SENTINEL_SOLANA_KEY (32-byte ed25519 seed, hex) in .env.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@sentinel/agents';
import { accountFromEnv, nodeClient, updateContract } from '../chain.js';
import { ContractAddress, ContractName, EntrypointName, Parameter, serializeUpdateContractParameters } from '@concordium/web-sdk';
import { callRegistryTool, type Network } from '../registry.js';

loadEnv();
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const owner = accountFromEnv('CONCORDIUM_OWNER');
const seedHex = process.env.SENTINEL_SOLANA_KEY;
if (!owner || !seedHex || !/^[0-9a-f]{64}$/i.test(seedHex)) { console.error('need CONCORDIUM_OWNER_WALLET and SENTINEL_SOLANA_KEY (64 hex)'); process.exit(1); }
const log = (m: string) => console.error(m);

// Solana mainnet CAIP-2 id: the key acts on Solana mainnet, the binding lives on Concordium.
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const priv = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
const pubHex = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const external_key = { namespace: SOLANA, key_type: 'ed25519', public_key_hex: pubHex };
const ownerAddress = owner.address.toString();

const existing = await callRegistryTool<unknown>('owner_of_key', { network, external_key });
if (existing) { log(`already bound: ${JSON.stringify(existing)}`); process.exit(0); }

const canon = await callRegistryTool<{ bytes_hex: string }>('build_cis8_canonical_bytes', {
  network, concordium_account: ownerAddress, external_namespace: SOLANA, external_key_namespace: SOLANA, external_key_type: 'ed25519', external_public_key_hex: pubHex, proof_scheme: 'solana-ed25519',
});
// solana-ed25519: sign the canonical bytes directly (CIS-8 spec), 64-byte R||S.
const signature_hex = sign(null, Buffer.from(canon.bytes_hex, 'hex'), priv).toString('hex');
// The hosted builder targets an entrypoint named `register`; the testnet instance exposes `CIS-8.registerExternalKey`.
// Serialise the parameter from the module's embedded schema instead.
const grpc = nodeClient(network, process.env.CONCORDIUM_NODE);
const contract = { index: 12801, subindex: 0 };
const info = await grpc.getInstanceInfo(ContractAddress.create(contract.index, contract.subindex));
const raw = await grpc.getEmbeddedSchema(info.sourceModule);
if (!raw) throw new Error('CIS-8 module has no embedded schema');
const schema = raw.buffer as ArrayBuffer;
const schemaVersion = (raw as { version?: number }).version;
const entry = info.methods.map(m => m.value).find(m => m === 'CIS-8.registerExternalKey' || m === 'CIS-8.register');
if (!entry) throw new Error(`no register entrypoint on CIS-8 ${contract.index}: ${info.methods.map(m => m.value).join(', ')}`);
const param = serializeUpdateContractParameters(ContractName.fromString('CIS-8'), EntrypointName.fromString(entry.slice('CIS-8.'.length)), {
  external_key: { namespace: SOLANA, key_type: 'ed25519', public_key: [...Buffer.from(pubHex, 'hex')] },
  proof: { scheme: 'solana-ed25519', signature: [...Buffer.from(signature_hex, 'hex')] },
  metadata: [{ key: 'role', value: 'sentinel-agent-signer' }, { key: 'agents', value: 'cis8004 12802.0 tokens 981-989' }, { key: 'site', value: 'https://sentinelagent.pro' }],
}, schema, schemaVersion);
const reg = { contract_address: contract, receive_name: entry };
const r = await updateContract(grpc, network, owner, contract, entry, Parameter.toHexString(param), 200_000, log);
log(`bound ${r.explorer}`);
const after = await callRegistryTool<unknown>('owner_of_key', { network, external_key });
log(`owner_of_key → ${JSON.stringify(after)}`);

const cardsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cards');
writeFileSync(join(cardsDir, 'cis8.json'), JSON.stringify({ network, contract: reg.contract_address, owner: ownerAddress, externalKey: external_key, registerTx: r.hash, explorer: r.explorer }, null, 2) + '\n');
