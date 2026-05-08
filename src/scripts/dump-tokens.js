#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};

const token = pick('ADMIN_TOKEN');
const redirect = pick('REDIRECT_URI');
const base = process.env.BASE || (redirect ? new URL(redirect).origin : '');

if (!token || !base) {
  console.error('Need ADMIN_TOKEN + REDIRECT_URI in .env (or override BASE env var)');
  process.exit(1);
}

const id = process.argv[2];
const url = id
  ? `${base}/admin/export/${encodeURIComponent(id)}`
  : `${base}/admin/export`;

fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  .then(async (r) => {
    const text = await r.text();
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    if (!r.ok) process.exit(1);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
