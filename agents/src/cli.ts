#!/usr/bin/env node
// sentinel-swarm: run the swarm on a live Solana mint, a saved snapshot or an
// offline fixture. Progress streams to stderr as agent lanes; the verdict JSON
// goes to stdout so it can be piped.
//
//   sentinel-swarm <mint> [--rpc URL] [--save-snapshot file]
//   sentinel-swarm --fixture clean|rug
//   sentinel-swarm --snapshot file.json
//   options: --no-debate  --quiet  --out file  --agents holders,contract
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze, SolanaAdapter, type TokenSnapshot } from '@sentinel/engine';
import { loadEnv, modelConfig } from './env.js';
import { FIXTURES, type FixtureName } from './fixtures.js';
import { AnthropicLLM } from './llm.js';
import type { AgentFinding, AgentId, SwarmEvent, Verdict } from './schema.js';
import { runSwarm } from './swarm.js';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(name);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && !['--no-debate', '--quiet'].includes(args[i - 1]!)));

if (has('--help') || (!positional[0] && !flag('--fixture') && !flag('--snapshot'))) {
  console.error('usage: sentinel-swarm <mint> | --fixture clean|rug | --snapshot file.json  [--rpc URL] [--save-snapshot file] [--no-debate] [--quiet] [--out file] [--agents a,b]');
  process.exit(positional[0] ? 0 : 1);
}

const envFile = loadEnv();
const quiet = has('--quiet');
const tty = process.stderr.isTTY ?? false;
const c = (code: string, s: string) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = (s: string) => c('2', s), red = (s: string) => c('31', s), bold = (s: string) => c('1', s), white = (s: string) => c('97', s);
const log = (s = '') => { if (!quiet) process.stderr.write(s + '\n'); };

// ── Snapshot ───────────────────────────────────────────────────────────────
let snapshot: TokenSnapshot;
let engineMs = 0;
if (flag('--fixture')) {
  const name = flag('--fixture') as FixtureName;
  if (!(name in FIXTURES)) { console.error(`unknown fixture ${name}; use clean or rug`); process.exit(1); }
  snapshot = FIXTURES[name]();
  log(dim(`fixture ${name}: ${snapshot.mint}`));
} else if (flag('--snapshot')) {
  snapshot = JSON.parse(readFileSync(flag('--snapshot')!, 'utf8')) as TokenSnapshot;
  log(dim(`snapshot ${flag('--snapshot')}: ${snapshot.mint}`));
} else {
  const rpcUrl = flag('--rpc') ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const adapter = new SolanaAdapter({ rpcUrl, log: m => log(dim(`engine · ${m}`)) });
  const t = Date.now();
  log(dim(`engine · reading ${positional[0]} from ${new URL(rpcUrl).host}`));
  snapshot = await adapter.snapshot(positional[0]!);
  engineMs = Date.now() - t;
  log(dim(`engine · ${snapshot.holders.length} holders, ${snapshot.trades.length} trades, creator ${snapshot.creator ?? '?'} in ${engineMs} ms`));
  if (flag('--save-snapshot')) { writeFileSync(flag('--save-snapshot')!, JSON.stringify(snapshot, null, 1)); log(dim(`engine · snapshot saved to ${flag('--save-snapshot')}`)); }
}

const ev = analyze(snapshot);
log(dim(`engine · ${ev.flags.length} flags, baseline ${ev.baselineScore}/100: ${ev.flags.map(f => f.code).join(', ') || 'none'}`));

// ── Swarm ──────────────────────────────────────────────────────────────────
const cfg = modelConfig();
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error(red(`ANTHROPIC_API_KEY is not set${envFile ? ` (looked in ${envFile})` : ' and no .env found'}. Add it to .env at the repo root.`));
  process.exit(2);
}
log(`${bold('SENTINEL SWARM')} ${dim(`· specialists ${cfg.specialist} (${cfg.specialistEffort}) · judge ${cfg.judge} (${cfg.judgeEffort})`)}`);
log();

const LANE = 20;
const lane = (name: string) => name.padEnd(LANE).slice(0, LANE);
const buffers = new Map<string, string>();
function thinking(agent: string, text: string) {
  if (quiet) return;
  const buf = (buffers.get(agent) ?? '') + text;
  const lines = buf.split('\n');
  buffers.set(agent, lines.pop() ?? '');
  for (const l of lines) if (l.trim()) process.stderr.write(`${dim(lane(agent))} ${dim(l.trim())}\n`);
}
function flush(agent: string) {
  const rest = buffers.get(agent)?.trim();
  if (rest && !quiet) process.stderr.write(`${dim(lane(agent))} ${dim(rest)}\n`);
  buffers.delete(agent);
}
function findingLine(f: AgentFinding, tag = '✓') {
  const score = f.riskScore >= 65 ? red(String(f.riskScore).padStart(3)) : white(String(f.riskScore).padStart(3));
  const rev = f.revised ? dim(` (was ${f.revised.riskScore})`) : '';
  return `${white(lane(f.agentName))} ${tag} risk ${score}${rev}  conf ${f.confidence.toFixed(2)}  ${dim(f.label)}  ${dim(`${(f.ms / 1000).toFixed(1)}s`)}\n${' '.repeat(LANE + 1)}${f.summary}`;
}

const agentsArg = flag('--agents')?.split(',').map(s => s.trim()).filter(Boolean) as AgentId[] | undefined;
let verdict: Verdict | undefined;
const gen = runSwarm(snapshot, { llm: new AnthropicLLM(), ...(has('--no-debate') ? { debate: false } : {}), ...(agentsArg ? { agents: agentsArg } : {}) });
while (true) {
  const next = await gen.next();
  if (next.done) { verdict = next.value; break; }
  const e: SwarmEvent = next.value;
  switch (e.type) {
    case 'swarm_start': log(dim(`${e.agents.length} agents · ${e.flags} flags · baseline ${e.baselineScore}`)); break;
    case 'veto': log(`${red(lane('VETO'))} ${red(e.veto.code)} ${dim(`(${e.veto.agent})`)} ${e.veto.message}`); break;
    case 'agent_start': log(`${dim(lane(e.agent))} ${dim('…')}`); break;
    case 'agent_thinking': thinking(e.agent, e.text); break;
    case 'agent_finding': flush(e.finding.agent); log(findingLine(e.finding)); break;
    case 'agent_error': flush(e.agent); log(`${red(lane(e.agent))} ✗ ${e.error}`); break;
    case 'debate_start': log(); log(`${bold(lane('DEBATE'))} ${e.agents.join(' vs ')} ${dim(`· spread ${e.spread}`)}`); break;
    case 'debate_finding': flush(e.finding.agent); log(findingLine(e.finding, '↻')); break;
    case 'council_start': log(); log(`${bold(lane('COUNCIL'))} ${dim(`${e.agents.length} agents rank each other's findings, anonymised`)}`); break;
    case 'council_rank': log(`${dim(lane(e.by))} ${dim('ranks')} ${e.ranked.map(r => `${r.rank}.${r.agent}`).join(' ')}`); break;
    case 'council': log(Object.keys(e.scores).length ? `${white(lane('council'))} ${Object.entries(e.scores).map(([a, v]) => `${a} ${(v ?? 0) >= 0.75 ? white(String(v)) : String(v)}`).join(' · ')}` : `${dim(lane('council'))} ${dim(`skipped · only ${e.rankings} ranking${e.rankings === 1 ? '' : 's'} usable`)}`); break;
    case 'consensus': log(); log(`${bold(lane('CONSENSUS'))} weighted ${e.consensus.weightedScore} · spread ${e.consensus.spread} · suggests ${e.consensus.suggestedBand} · completeness ${e.consensus.completeness.score}${e.consensus.completeness.missing.length ? dim(` (missing: ${e.consensus.completeness.missing.join('; ')})`) : ''}`); break;
    case 'advocate_start': log(); log(`${bold(lane('ADVOCATE'))} ${dim(`arguing against ${e.arguesAgainst} · ${e.model}`)}`); break;
    case 'advocate_thinking': thinking('advocate', e.text); break;
    case 'advocate': flush('advocate'); log(`${white(lane('advocate'))} for ${bold(e.advocate.arguesFor)}: ${e.advocate.thesis}`); e.advocate.points.forEach(p => log(`${' '.repeat(LANE + 1)}· ${p}`)); log(`${' '.repeat(LANE + 1)}${dim(`weakest link: ${e.advocate.weakestLink}`)}`); break;
    case 'judge_start': log(); log(`${dim(lane('judge'))} ${dim(`… ${e.model}`)}`); break;
    case 'judge_thinking': thinking('judge', e.text); break;
    case 'verdict': flush('judge'); break;
  }
}

if (verdict) {
  const v = verdict;
  const band = v.verdict === 'SAFE' ? white(bold(v.verdict)) : v.verdict === 'CAUTION' ? bold(v.verdict) : red(bold(v.verdict));
  log();
  log(`${band}  risk ${v.riskScore}/100 · confidence ${v.confidence} · ${v.findings.length} agents · ${v.vetoes.length} veto${v.vetoes.length === 1 ? '' : 'es'} · ${v.consensus.debateRounds} debate · ${(v.timing.totalMs / 1000).toFixed(1)}s${engineMs ? ` (+${(engineMs / 1000).toFixed(1)}s engine)` : ''}`);
  log(bold(v.headline));
  log(`${dim('decisive:')} ${v.decisive}`);
  log();
  log(v.reasoning);
  log();
  v.topReasons.forEach((r, i) => log(`  ${i + 1}. ${r}`));
  if (v.cleanSignals.length) log(dim(`clean: ${v.cleanSignals.join(' · ')}`));
  if (v.whatWouldChange.length) log(dim(`would change: ${v.whatWouldChange.join(' · ')}`));
  log(`${red('→')} ${v.action}`);
  if (v.scorecard.length) log(dim(`scorecard: ${v.scorecard.map(s => `${s.agent}=${s.weight}`).join(' · ')}`));
  if (v.council) log(dim(`council: ${Object.entries(v.council.scores).map(([a, s]) => `${a} ${s}`).join(' · ')}`));
  if (v.dissent) log(dim(`dissent: ${v.dissent}`));
  if (v.rebuttal) log(dim(`rebuttal: ${v.rebuttal}`));
  if (v.judge.overridden.length) log(dim(`rule overrides: ${v.judge.overridden.join(' | ')}`));
  log(dim(`digest sha256:${v.attestation.digest}`));
  const out = flag('--out');
  if (out) { writeFileSync(out, JSON.stringify(v, null, 2)); log(dim(`verdict written to ${out}`)); }
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}
