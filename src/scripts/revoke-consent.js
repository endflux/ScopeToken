#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};

const CLIENT_ID = pick('CLIENT_ID');
const TENANT = pick('TENANT');
if (!CLIENT_ID) {
  console.error('CLIENT_ID missing from .env');
  process.exit(1);
}

const az = (...args) => execFileSync('az', args, { encoding: 'utf8' }).trim();
const azJson = (...args) => JSON.parse(az(...args));

function ensureRightTenant() {
  if (!TENANT) return;
  try {
    const current = az('account', 'show', '--query', 'tenantId', '-o', 'tsv');
    if (current !== TENANT) {
      console.error(
        `az session is in tenant ${current} but app lives in ${TENANT}.`,
      );
      console.error(
        `Run: az login --tenant ${TENANT} --allow-no-subscriptions`,
      );
      process.exit(1);
    }
  } catch {
    console.error('Run `az login` first.');
    process.exit(1);
  }
}

function main() {
  ensureRightTenant();

  const spId = az('ad', 'sp', 'show', '--id', CLIENT_ID, '--query', 'id', '-o', 'tsv');

  const filter = `clientId eq '${spId}'`;
  const grants = azJson(
    'rest',
    '--method',
    'GET',
    '--uri',
    `https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$filter=${encodeURIComponent(filter)}`,
    '--query',
    'value',
  );

  if (!grants.length) {
    console.log('No consent grants found for this app.');
    return;
  }

  for (const g of grants) {
    az(
      'rest',
      '--method',
      'DELETE',
      '--uri',
      `https://graph.microsoft.com/v1.0/oauth2PermissionGrants/${g.id}`,
    );
    const who =
      g.consentType === 'AllPrincipals'
        ? 'admin (tenant-wide)'
        : `principal ${g.principalId}`;
    console.log(`Deleted grant ${g.id} (${who}, scope:${g.scope.trim()})`);
  }

  console.log(`Revoked ${grants.length} consent grant${grants.length === 1 ? '' : 's'}.`);
}

main();
