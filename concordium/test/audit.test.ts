import { existsSync } from 'node:fs';
import { Parameter } from '@concordium/web-sdk';
import { describe, expect, it } from 'vitest';
import type { Verdict } from '@sentinel/agents';
import { SCHEMA_FILE, WASM_FILE, bytesToHex, hexToBytes, recordFromVerdict, serializeInit, serializeRecord, serializeSetSubmitter } from '../src/audit.js';

const digest = 'c99492021d956671bd43bc236b77b9a8f9c68b08c14a7c5c72f50f5e7c94003a';
const verdict = { chain: 'solana', mint: 'Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU', at: 1_700_000_000, verdict: 'RUGGED', riskScore: 88, attestation: { digest, concordiumTx: null, agentRegistry: null } } as unknown as Verdict;

describe('audit contract parameters', () => {
  it('the compiled module and schema exist', () => {
    expect(existsSync(SCHEMA_FILE)).toBe(true);
    if (!existsSync(WASM_FILE)) console.warn('wasm module not built; run cargo concordium build in audit-contract/');
  });
  it('serialises a record exactly as the contract expects: digest first, then length-prefixed strings', () => {
    const p = recordFromVerdict(verdict, [975, 976]);
    expect(bytesToHex(p.digest)).toBe(digest);
    const hex = Buffer.from(Parameter.toBuffer(serializeRecord(p))).toString('hex');
    expect(hex.startsWith(digest)).toBe(true);
    // u32 LE length 6 + "solana"
    expect(hex.slice(64, 64 + 8 + 12)).toBe('06000000' + Buffer.from('solana').toString('hex'));
    expect(hex.endsWith('00f1536500000000')).toBe(true); // observed_at 1_700_000_000 = 0x6553f100 as u64 LE
  });
  it('serialises init and setSubmitter with account addresses', () => {
    const acc = '3whdieGHx43KKRwQYbC5pAUdmWZ61B7yreNRU9i36MtdCvajR8';
    expect(Parameter.toBuffer(serializeInit([acc])).length).toBe(4 + 32);
    expect(Parameter.toBuffer(serializeSetSubmitter(acc, true)).length).toBe(32 + 1);
  });
  it('hex helpers round-trip', () => {
    expect(bytesToHex(hexToBytes(digest))).toBe(digest);
  });
});
