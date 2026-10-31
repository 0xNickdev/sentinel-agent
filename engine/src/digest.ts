// Canonical hash of what Sentinel looked at and what it concluded. This is
// the value appended to the Concordium audit contract, so it must be stable:
// keys sorted, numbers as emitted, no timestamps other than the snapshot's.
import { createHash } from 'node:crypto';
import type { Evidence } from './types.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function verdictDigest(input: { chain: string; mint: string; at: number; evidence: Evidence; verdict?: unknown }): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}
