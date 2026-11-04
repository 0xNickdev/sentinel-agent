// Point the gateway agent's CIS-8004 external_reference at Sentinel's CIS-8-bound Solana key, so a Solana-side
// verifier can go key → agent directly (agentByExternalReference), not only key → owner.
//   node dist/scripts/link-agent-key.js [tokenId=981]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractAddress, ContractName, EntrypointName, Parameter, serializeUpdateContractParameters } from '@concordium/web-sdk';
import { loadEnv } from '@sentinel/agents';
import { accountFromEnv, nodeClient, updateContract } from '../chain.js';
import { CONTRACTS, type Network } from '../registry.js';

loadEnv();
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const owner = accountFromEnv('CONCORDIUM_OWNER');
if (!owner) { console.error('CONCORDIUM_OWNER_WALLET is required'); process.exit(1); }
const tokenId = Number(process.argv[2] ?? 981);
const cardsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cards');
const bound = JSON.parse(readFileSync(join(cardsDir, 'cis8.json'), 'utf8')) as { externalKey: { namespace: string; key_type: string; public_key_hex: string }; agentLinks?: Record<string, string> };
const grpc = nodeClient(network, process.env.CONCORDIUM_NODE);
const reg = CONTRACTS[network].cis8004, cis8 = CONTRACTS[network].cis8;
const info = await grpc.getInstanceInfo(ContractAddress.create(reg.index, reg.subindex));
const raw = await grpc.getEmbeddedSchema(info.sourceModule);
if (!raw) throw new Error('CIS-8004 module has no embedded schema');
// CIS-8004 token ids are u64, encoded little-endian in the CIS-2 TokenId bytes.
const tokenHex = Buffer.from(new BigUint64Array([BigInt(tokenId)]).buffer).toString('hex');
const param = serializeUpdateContractParameters(ContractName.fromString('CIS-8004'), EntrypointName.fromString('setExternalReference'), {
  token_id: tokenHex,
  external_reference: { Some: [{ contract_address: { index: cis8.index, subindex: cis8.subindex }, kind: { Cis8: [{ namespace: bound.externalKey.namespace, key_type: bound.externalKey.key_type, public_key: [...Buffer.from(bound.externalKey.public_key_hex, 'hex')] }] } }] },
}, raw.buffer as ArrayBuffer, (raw as { version?: number }).version);
const r = await updateContract(grpc, network, owner, reg, 'CIS-8004.setExternalReference', Parameter.toHexString(param), 60_000, m => console.error(m));
bound.agentLinks = { ...(bound.agentLinks ?? {}), [String(tokenId)]: r.hash };
writeFileSync(join(cardsDir, 'cis8.json'), JSON.stringify(bound, null, 2) + '\n');
console.error(`linked token ${tokenId}: ${r.explorer}`);
