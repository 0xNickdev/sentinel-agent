// Client for the sentinel_audit contract: append a verdict record, read one
// back. The record is the EU AI Act Art. 12 log line: digest of the canonical
// verdict JSON, subject, band, score, the registered agents, and times.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountAddress, ContractAddress, ContractName, EntrypointName, Parameter, ReceiveName, ReturnValue, deserializeReceiveReturnValue, serializeInitContractParameters, serializeUpdateContractParameters } from '@concordium/web-sdk';
import type { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import type { Verdict } from '@sentinel/agents';
import { explorerContract, updateContract, type Account } from './chain.js';
import type { Network } from './registry.js';

export const CONTRACT_NAME = 'sentinel_audit';
const here = dirname(fileURLToPath(import.meta.url));
/** Module schema embedded at build time by cargo-concordium (also inside the wasm). */
export const SCHEMA_FILE = join(here, '..', 'audit-contract', 'schema.bin');
export const WASM_FILE = join(here, '..', 'audit-contract', 'sentinel_audit.wasm.v1');
let schemaCache: ArrayBuffer | null = null;
/** Copy a Node Buffer / Uint8Array into a standalone ArrayBuffer (what the web-sdk schema helpers take). */
export const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
export const schema = (): ArrayBuffer => (schemaCache ??= toArrayBuffer(readFileSync(SCHEMA_FILE)));

export interface RecordParam {
  digest: number[];
  chain: string;
  subject: string;
  verdict: string;
  risk_score: number;
  /** u64 values travel as JSON numbers through the schema serializer */
  agent_ids: number[];
  observed_at: number;
}

/** Outcome grade of a sealed verdict at one horizon, as the contract stores it. */
export interface GradeParam {
  seq: number;
  horizon: number;
  labels: string[];
  rugged: boolean;
  /** basis points; 65535 = unknown */
  liquidity_bps: number;
  price_bps: number;
  observed_at: number;
}

export interface AuditGrade {
  horizon: number;
  labels: string[];
  rugged: boolean;
  liquidity_bps: number;
  price_bps: number;
  observed_at: string;
  recorded_at: string;
  submitter: string;
}

export const UNKNOWN_BPS = 65_535;
export const toBps = (bps: number | null): number => (bps == null ? UNKNOWN_BPS : Math.min(UNKNOWN_BPS - 1, Math.max(0, Math.round(bps))));

export interface AuditRecord {
  digest: number[];
  chain: string;
  subject: string;
  verdict: string;
  risk_score: number;
  agent_ids: string[];
  observed_at: string;
  recorded_at: string;
  submitter: string;
}

export const hexToBytes = (hex: string): number[] => Array.from(Buffer.from(hex, 'hex'));
export const bytesToHex = (bytes: number[]): string => Buffer.from(bytes).toString('hex');

/** The on-chain record derived from a swarm verdict. Agent ids come from the registry (null until registered). */
export function recordFromVerdict(v: Verdict, agentIds: number[] = []): RecordParam {
  return {
    digest: hexToBytes(v.attestation.digest),
    chain: v.chain,
    subject: v.mint,
    verdict: v.verdict,
    risk_score: v.riskScore,
    agent_ids: agentIds,
    observed_at: v.at,
  };
}

export const serializeRecord = (p: RecordParam): Parameter.Type =>
  serializeUpdateContractParameters(ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('record'), p, schema());

export const serializeInit = (submitters: string[]): Parameter.Type =>
  serializeInitContractParameters(ContractName.fromString(CONTRACT_NAME), { submitters }, schema());

export const serializeSetSubmitter = (account: string, allowed: boolean): Parameter.Type =>
  serializeUpdateContractParameters(ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('setSubmitter'), { account, allowed }, schema());

export interface AuditClientOptions { client: ConcordiumGRPCNodeClient; network: Network; contract: { index: number; subindex: number }; log?: (m: string) => void }

export class AuditClient {
  constructor(private readonly o: AuditClientOptions) {}

  get explorer() { return explorerContract(this.o.network, this.o.contract.index, this.o.contract.subindex); }

  /** Append one verdict. Returns the sequence number and the CCDScan link to the transaction. */
  async record(submitter: Account, verdict: Verdict, agentIds: number[] = []): Promise<{ seq: number; txHash: string; explorer: string }> {
    const param = serializeRecord(recordFromVerdict(verdict, agentIds));
    const r = await updateContract(this.o.client, this.o.network, submitter, this.o.contract, `${CONTRACT_NAME}.record`, Buffer.from(Parameter.toBuffer(param)).toString('hex'), 30_000, this.o.log);
    const seq = await this.count() - 1;
    return { seq, txHash: r.hash, explorer: r.explorer };
  }

  private async invoke(entrypoint: string, param?: Parameter.Type): Promise<ReturnValue.Type> {
    const r = await this.o.client.invokeContract({
      contract: ContractAddress.create(this.o.contract.index, this.o.contract.subindex),
      method: ReceiveName.fromString(`${CONTRACT_NAME}.${entrypoint}`),
      ...(param ? { parameter: param } : {}),
    });
    if (r.tag !== 'success' || !r.returnValue) throw new Error(`${entrypoint}: ${r.tag === 'failure' ? JSON.stringify(r.reason) : 'no return value'}`);
    return r.returnValue;
  }

  /** Grade a recorded verdict against its outcome at one horizon. One grade per horizon; the verdict itself is never touched. */
  async grade(submitter: Account, p: GradeParam): Promise<{ txHash: string; explorer: string }> {
    const param = serializeUpdateContractParameters(ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('grade'), p, schema());
    const r = await updateContract(this.o.client, this.o.network, submitter, this.o.contract, `${CONTRACT_NAME}.grade`, Buffer.from(Parameter.toBuffer(param)).toString('hex'), 30_000, this.o.log);
    return { txHash: r.hash, explorer: r.explorer };
  }

  async grades(seq: number): Promise<AuditGrade[]> {
    const param = serializeUpdateContractParameters(ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('grades'), seq, schema());
    const rv = await this.invoke('grades', param);
    return deserializeReceiveReturnValue(toArrayBuffer(ReturnValue.toBuffer(rv)), schema(), ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('grades')) as AuditGrade[];
  }

  async count(): Promise<number> {
    const rv = await this.invoke('count');
    return Number(deserializeReceiveReturnValue(toArrayBuffer(ReturnValue.toBuffer(rv)), schema(), ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('count')));
  }

  async view(seq: number): Promise<AuditRecord & { digestHex: string }> {
    const param = serializeUpdateContractParameters(ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('view'), seq, schema());
    const rv = await this.invoke('view', param);
    const rec = deserializeReceiveReturnValue(toArrayBuffer(ReturnValue.toBuffer(rv)), schema(), ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('view')) as AuditRecord;
    return { ...rec, digestHex: bytesToHex(rec.digest) };
  }

  async info(): Promise<{ admin: string; submitters: string[]; count: string }> {
    const rv = await this.invoke('info');
    return deserializeReceiveReturnValue(toArrayBuffer(ReturnValue.toBuffer(rv)), schema(), ContractName.fromString(CONTRACT_NAME), EntrypointName.fromString('info'));
  }
}

export const isAccountAddress = (s: string) => { try { AccountAddress.fromBase58(s); return true; } catch { return false; } };
