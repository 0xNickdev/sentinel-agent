// Thin wrapper over the Concordium web-sdk for what Sentinel needs on-chain:
// a gRPC client, account signers from wallet export files, and sending an
// UpdateContract / DeployModule / InitContract transaction and waiting for it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { credentials } from '@grpc/grpc-js';
import {
  AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, ContractName, Energy, ModuleReference, Parameter, ReceiveName,
  TransactionExpiry, TransactionHash, buildAccountSigner, buildBasicAccountSigner, parseWallet, signTransaction, getTransactionRejectReason, affectedContracts,
  type AccountSigner, type AccountTransaction, type BlockItemSummaryInBlock,
} from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import type { Network } from './registry.js';

export const GRPC: Record<Network, { host: string; port: number }> = {
  testnet: { host: 'grpc.testnet.concordium.com', port: 20000 },
  mainnet: { host: 'grpc.mainnet.concordium.software', port: 20000 },
  devnet: { host: 'grpc.devnet.concordium.com', port: 20000 },
};

export function nodeClient(network: Network = 'testnet', override?: string): ConcordiumGRPCNodeClient {
  const [host, port] = override ? [override.split(':')[0]!, Number(override.split(':')[1] ?? 20000)] : [GRPC[network].host, GRPC[network].port];
  return new ConcordiumGRPCNodeClient(host, port, credentials.createSsl(), { timeout: 20_000 });
}

export interface Account { address: AccountAddress.Type; signer: AccountSigner; label: string }

/** Load an account from a wallet export file (Browser Wallet / ID app) or from an address + hex key. */
export function loadAccount(opts: { walletFile?: string; address?: string; privateKeyHex?: string; label?: string }): Account {
  if (opts.walletFile) {
    const wallet = parseWallet(readFileSync(opts.walletFile, 'utf8'));
    return { address: AccountAddress.fromBase58(wallet.value.address), signer: buildAccountSigner(wallet), label: opts.label ?? opts.walletFile };
  }
  if (opts.address && opts.privateKeyHex) return { address: AccountAddress.fromBase58(opts.address), signer: buildBasicAccountSigner(opts.privateKeyHex), label: opts.label ?? opts.address };
  throw new Error('loadAccount: need walletFile or address + privateKeyHex');
}

/** Account from env: `<PREFIX>_WALLET` (export file path) or `<PREFIX>_ADDRESS` + `<PREFIX>_KEY`. */
export function accountFromEnv(prefix: string): Account | null {
  const file = process.env[`${prefix}_WALLET`];
  const address = process.env[`${prefix}_ADDRESS`], key = process.env[`${prefix}_KEY`];
  if (file) return loadAccount({ walletFile: file, label: prefix });
  if (address && key) return loadAccount({ address, privateKeyHex: key, label: prefix });
  return null;
}

export interface TxResult { hash: string; blockHash: string; explorer: string; summary: NonNullable<BlockItemSummaryInBlock['summary']> }

export const explorerTx = (network: Network, hash: string) => `https://${network === 'mainnet' ? '' : 'testnet.'}ccdscan.io/transactions/${hash}`;
export const explorerContract = (network: Network, index: number, subindex = 0) => `https://${network === 'mainnet' ? '' : 'testnet.'}ccdscan.io/contracts/${index}/${subindex}`;

async function send(client: ConcordiumGRPCNodeClient, network: Network, account: Account, type: AccountTransactionType, payload: AccountTransaction['payload'], log?: (m: string) => void): Promise<TxResult> {
  const { nonce } = await client.getNextAccountNonce(account.address);
  const tx: AccountTransaction = { type, header: { sender: account.address, nonce, expiry: TransactionExpiry.futureMinutes(5) }, payload };
  const signature = await signTransaction(tx, account.signer);
  const hash = await client.sendAccountTransaction(tx, signature);
  const hex = TransactionHash.toHexString(hash);
  log?.(`sent ${AccountTransactionType[type]} ${hex}, waiting for finalization`);
  const result = await client.waitForTransactionFinalization(hash, 120_000);
  if (!result.summary) throw new Error(`transaction ${hex}: node returned a summary this SDK cannot decode`);
  const reject = getTransactionRejectReason(result.summary);
  if (reject) throw new Error(`transaction ${hex} rejected: ${JSON.stringify(reject, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  return { hash: hex, blockHash: result.blockHash.toString(), explorer: explorerTx(network, hex), summary: result.summary };
}

/** Call a contract entrypoint with an already-serialised parameter. */
export function updateContract(client: ConcordiumGRPCNodeClient, network: Network, account: Account, contract: { index: number; subindex: number }, receiveName: string, parameterHex: string, energy = 30_000, log?: (m: string) => void) {
  return send(client, network, account, AccountTransactionType.Update, {
    amount: CcdAmount.zero(),
    address: ContractAddress.create(contract.index, contract.subindex),
    receiveName: ReceiveName.fromString(receiveName),
    message: Parameter.fromHexString(parameterHex),
    maxContractExecutionEnergy: Energy.create(energy),
  }, log);
}

/** A module's reference is the sha256 of the versioned module bytes. */
export const moduleRefOf = (wasmFile: string) => createHash('sha256').update(readFileSync(wasmFile)).digest('hex');

export async function deployModule(client: ConcordiumGRPCNodeClient, network: Network, account: Account, wasmFile: string, log?: (m: string) => void): Promise<{ hash: string | null; explorer: string | null; moduleRef: string; alreadyDeployed: boolean }> {
  const moduleRef = moduleRefOf(wasmFile);
  try {
    await client.getModuleSource(ModuleReference.fromHexString(moduleRef));
    log?.(`module ${moduleRef} already on chain, skipping deploy`);
    return { hash: null, explorer: null, moduleRef, alreadyDeployed: true };
  } catch { /* not deployed yet */ }
  const r = await send(client, network, account, AccountTransactionType.DeployModule, { source: new Uint8Array(readFileSync(wasmFile)) }, log);
  return { hash: r.hash, explorer: r.explorer, moduleRef, alreadyDeployed: false };
}

export async function initContract(client: ConcordiumGRPCNodeClient, network: Network, account: Account, moduleRef: string, contractName: string, param: Parameter.Type, energy = 30_000, log?: (m: string) => void): Promise<TxResult & { address: { index: number; subindex: number } }> {
  const r = await send(client, network, account, AccountTransactionType.InitContract, {
    amount: CcdAmount.zero(), moduleRef: ModuleReference.fromHexString(moduleRef), initName: ContractName.fromString(contractName), param, maxContractExecutionEnergy: Energy.create(energy),
  }, log);
  const [addr] = affectedContracts(r.summary);
  if (!addr) throw new Error(`init ${r.hash}: no contract address in summary`);
  return { ...r, address: { index: Number(addr.index), subindex: Number(addr.subindex) } };
}
