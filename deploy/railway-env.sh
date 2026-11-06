#!/usr/bin/env bash
# Copy the server's variables from .env into the linked Railway service, without printing any value.
# Run from the repo root after `railway link`:  bash deploy/railway-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import subprocess
env = {}
for line in open('.env'):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    env[k.strip()] = v.split(' #')[0].strip().strip('"').strip("'")
# Only what the API needs. The owner and payer keys stay on this machine: the server receives payments at the owner
# address (CONCORDIUM_PAY_TO) and never signs as the owner.
want = ['ANTHROPIC_API_KEY', 'SOLANA_RPC_URL', 'SOLANA_RPC_URL_SHYFT', 'SHYFT_GRPC_URL', 'SHYFT_GRPC_TOKEN', 'SENTINEL_PQ_SEED', 'CONCORDIUM_NETWORK', 'CONCORDIUM_NODE',
        'CONCORDIUM_SUBMITTER_ADDRESS', 'CONCORDIUM_SUBMITTER_KEY', 'CONCORDIUM_SPONSOR_ADDRESS', 'CONCORDIUM_SPONSOR_KEY',
        'SENTINEL_JUDGE_EFFORT', 'SENTINEL_SPECIALIST_MODEL', 'SENTINEL_JUDGE_MODEL', 'SENTINEL_SAMPLER_EVERY_MIN', 'SENTINEL_SAMPLER_PER_DAY']
sets = {k: env[k] for k in want if env.get(k)}
sets.update({
    'CONCORDIUM_PAY_TO': env.get('CONCORDIUM_OWNER_ADDRESS', ''),
    'SENTINEL_BASE_URL': 'https://api.sentinelagent.pro',
    'SENTINEL_CORS_ORIGINS': 'https://sentinelagent.pro,https://www.sentinelagent.pro,http://localhost:3100',
    'SENTINEL_DATA_DIR': '/data',
    'NODE_ENV': 'production',
})
sets = {k: v for k, v in sets.items() if v}
args = ['railway', 'variables', '--skip-deploys']
for k, v in sets.items(): args += ['--set', f'{k}={v}']
r = subprocess.run(args, capture_output=True, text=True)
print('railway variables:', 'ok' if r.returncode == 0 else f'failed (exit {r.returncode})')
print('set:', ', '.join(sorted(sets)))
skipped = [k for k in want if not env.get(k)]
if skipped: print('not in .env, skipped:', ', '.join(skipped))
PY
