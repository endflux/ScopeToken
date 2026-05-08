#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const TARGET = process.env.VERCEL_TARGET || 'production';

const raw = fs.readFileSync(ENV_PATH, 'utf8');
const entries = [];
for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (key) entries.push([key, value]);
}

if (!entries.length) {
  console.error(`No env entries found in ${ENV_PATH}`);
  process.exit(1);
}

console.log(`Syncing ${entries.length} env vars to Vercel "${TARGET}"...`);

for (const [key, value] of entries) {
  process.stdout.write(`  ${key} ... `);

  spawnSync('npx', ['vercel', 'env', 'rm', key, TARGET, '--yes'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  const add = spawnSync('npx', ['vercel', 'env', 'add', key, TARGET], {
    input: value,
    stdio: ['pipe', 'ignore', 'pipe'],
    encoding: 'utf8',
  });

  if (add.status !== 0) {
    console.log('FAIL');
    console.error(add.stderr || `vercel env add exited ${add.status}`);
    process.exit(add.status || 1);
  }
  console.log('ok');
}

console.log('Env sync complete.');
