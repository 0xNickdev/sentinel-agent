// Deploy and initialise the sentinel_audit contract on Concordium testnet.
//   node dist/scripts/deploy-audit.js
// Needs CONCORDIUM_OWNER_WALLET (deployer/admin) and, optionally,
// CONCORDIUM_SUBMITTER_ADDRESS (the judge account allowed to call `record`;
// defaults to the owner). Prints the contract address and CCDScan links and
// writes them to cards/audit-contract.json.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@sentinel/agents';
import { CONTRACT_NAME, WASM_FILE, serializeInit } from '../audit.js';
import { accountFromEnv, deployModule, explorerContract, initContract, nodeClient } from '../chain.js';
import type { Network } from '../registry.js';

loadEnv();
const network = (process.env.CONCORDIUM_NETWORK ?? 'testnet') as Network;
const owner = accountFromEnv('CONCORDIUM_OWNER');
if (!owner) { console.error('CONCORDIUM_OWNER_WALLET is required'); process.exit(1); }
const submitter = process.env.CONCORDIUM_SUBMITTER_ADDRESS ?? accountFromEnv('CONCORDIUM_SUBMITTER')?.address.toString() ?? owner.address.toString();
const client = nodeClient(network, process.env.CONCORDIUM_NODE);
const log = (m: string) => console.error(m);

log(`deploying ${WASM_FILE} from ${owner.address.toString()} on ${network}`);
const dep = await deployModule(client, network, owner, WASM_FILE, log);
log(`module ${dep.moduleRef}${dep.explorer ? ` · ${dep.explorer}` : ' (already deployed)'}`);
const init = await initContract(client, network, owner, dep.moduleRef, CONTRACT_NAME, serializeInit([submitter]), 30_000, log);
const out = { network, moduleRef: dep.moduleRef, deployTx: dep.hash, initTx: init.hash, contract: init.address, submitters: [submitter], explorer: explorerContract(network, init.address.index, init.address.subindex) };
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, '..', '..', 'cards', 'audit-contract.json'), JSON.stringify(out, null, 2));
log(`contract <${init.address.index},${init.address.subindex}> · ${out.explorer}`);
console.log(JSON.stringify(out, null, 2));
