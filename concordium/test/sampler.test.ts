import { describe, expect, it } from 'vitest';
import { LaunchSampler, VerdictService } from '../src/index.js';

describe('launch sampler', () => {
  it('draws only launches 5-30 minutes old, judges each once, and respects the daily cap', async () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    const now = 1_800_000_000;
    const launch = (mint: string, age: number) => ({ mint, creator: 'c', name: mint, symbol: mint.slice(0, 3), signature: 's', slot: 1, at: now - age });
    const ring = [launch('A'.repeat(32), 60), launch('B'.repeat(32), 600), launch('C'.repeat(32), 900), launch('D'.repeat(32), 3600)];
    (service as unknown as { launches: () => unknown[] }).launches = () => ring;
    const judged: string[] = [];
    (service as unknown as { verdict: (m: string) => Promise<unknown> }).verdict = async (m: string) => { judged.push(m); return { verdict: 'DANGER', riskScore: 80 }; };
    const s = new LaunchSampler({ service, everyMin: 30, perDay: 2, now: () => now, random: () => 0 });
    expect(s.candidates().map(l => l.mint[0])).toEqual(['B', 'C']);   // A too young, D too old
    expect(await s.tick()).toBe('B'.repeat(32));
    expect(s.candidates().map(l => l.mint[0])).toEqual(['C']);        // B is not drawn twice
    expect(await s.tick()).toBe('C'.repeat(32));
    ring.push(launch('E'.repeat(32), 400));
    expect(await s.tick()).toBeNull();                                 // daily cap of 2 reached
    expect(judged).toHaveLength(2);
  });

  it('keeps launches that already left the 50-slot ring, so a busy feed still yields 5-30 minute old candidates', () => {
    const service = new VerdictService({ rpcUrl: 'http://127.0.0.1:1' });
    let now = 1_800_000_000;
    let ring: Array<{ mint: string; creator: string; name: string; symbol: string; signature: string; slot: number; at: number }> = [];
    (service as unknown as { launches: () => unknown[] }).launches = () => ring;
    const s = new LaunchSampler({ service, everyMin: 30, now: () => now });
    for (let i = 0; i < 600; i++) {            // one launch a second for ten minutes; the ring keeps 50
      ring = [{ mint: `M${String(i).padStart(31, '0')}`, creator: 'c', name: 'x', symbol: 'X', signature: 's', slot: i, at: now }, ...ring].slice(0, 50);
      if (i % 10 === 0) s.observe(now);
      now++;
    }
    expect(s.candidates(now).length).toBeGreaterThan(20);
    now += 3600;
    expect(s.candidates(now)).toHaveLength(0);  // everything aged out
  });
});
