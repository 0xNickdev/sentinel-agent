// Minimal .env loader: looks for a .env file in the current directory and up
// to four parents (the repo root when run from a workspace), never overrides
// variables already set, never logs values.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function loadEnv(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
      return file;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const DEFAULTS = {
  specialistModel: 'claude-haiku-5-5',
  judgeModel: 'claude-opus-5-5',
  specialistEffort: 'low',
  judgeEffort: 'medium',
} as const;

export function modelConfig() {
  const effort = (v: string | undefined, d: string) => (['low', 'medium', 'high', 'xhigh', 'max'].includes(v ?? '') ? v! : d) as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  return {
    specialist: process.env.SENTINEL_SPECIALIST_MODEL || DEFAULTS.specialistModel,
    judge: process.env.SENTINEL_JUDGE_MODEL || DEFAULTS.judgeModel,
    specialistEffort: effort(process.env.SENTINEL_SPECIALIST_EFFORT, DEFAULTS.specialistEffort),
    judgeEffort: effort(process.env.SENTINEL_JUDGE_EFFORT, DEFAULTS.judgeEffort),
  };
}
