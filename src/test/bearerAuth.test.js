const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { buildBearerAuth } = require('../middleware/bearerAuth');

const TOKEN = 'a-very-long-test-token-0123456789';

function buildTestApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/admin', buildBearerAuth(TOKEN), (_req, res) => res.send('ok'));
  return app;
}

test('buildBearerAuth throws on short token', () => {
  assert.throws(() => buildBearerAuth('short'), /at least 16 chars/);
});

test('no auth returns 404', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/admin');
  assert.equal(res.status, 404);
});

test('valid Authorization Bearer header passes', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/admin').set('Authorization', `Bearer ${TOKEN}`);
  assert.equal(res.status, 200);
});

test('case-insensitive bearer keyword still works', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/admin').set('Authorization', `bearer ${TOKEN}`);
  assert.equal(res.status, 200);
});

test('wrong bearer returns 404', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/admin').set('Authorization', 'Bearer nope');
  assert.equal(res.status, 404);
});

test('cookie does NOT authenticate (header-only contract)', async () => {
  const app = buildTestApp();
  const res = await request(app).get('/admin').set('Cookie', `admin_session=${TOKEN}`);
  assert.equal(res.status, 404);
});

test('?token= query does NOT authenticate (header-only contract)', async () => {
  const app = buildTestApp();
  const res = await request(app).get(`/admin?token=${TOKEN}`);
  assert.equal(res.status, 404);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('valid bearer passes on POST too', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use('/admin', buildBearerAuth(TOKEN), (_req, res) => res.status(200).send('ok'));
  const res = await request(app).post('/admin').set('Authorization', `Bearer ${TOKEN}`);
  assert.equal(res.status, 200);
});
