#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { buildStore } = require('../store');

const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};

const url = process.env.UPSTASH_REDIS_REST_URL || pick('UPSTASH_REDIS_REST_URL');
const token = process.env.UPSTASH_REDIS_REST_TOKEN || pick('UPSTASH_REDIS_REST_TOKEN');

if (!url || !token) {
  console.error('Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  process.exit(1);
}

(async () => {
  const store = buildStore({ url, token });
  const n = await store.wipeAll();
  console.log(`Wiped ${n} token record${n === 1 ? '' : 's'}.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
