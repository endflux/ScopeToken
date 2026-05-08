const { buildLogger } = require('../logger');

const TEST_ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

function memoryStore() {
  const docs = new Map();
  return {
    docs,
    async upsertToken(input) {
      const id = `${input.tenantId}:${input.oid}`;
      const existing = docs.get(id) || {};
      const now = Math.floor(Date.now() / 1000);
      const merged = {
        ...existing,
        ...input,
        capturedAt: existing.capturedAt || now,
      };
      docs.set(id, merged);
      return id;
    },
    async listTokens() {
      return Array.from(docs.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    },
    async getToken(id) {
      const v = docs.get(id);
      return v ? { id, ...v } : null;
    },
    async updateRefreshed(id, patch) {
      const v = docs.get(id);
      if (!v) return false;
      docs.set(id, { ...v, ...patch, lastRefreshed: Math.floor(Date.now() / 1000) });
      return true;
    },
    async deleteToken(id) {
      docs.delete(id);
    },
    async wipeAll() {
      const n = docs.size;
      docs.clear();
      return n;
    },
  };
}

function testConfig(overrides = {}) {
  return Object.freeze({
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    REDIRECT_URI: 'http://127.0.0.1:3000/login/authorized',
    SCOPES: 'User.Read offline_access',
    TENANT: 'common',
    DECOY_URL: 'https://learn.microsoft.com/',
    ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
    LOG_LEVEL: 'silent',
    TRUST_PROXY: 1,
    ...overrides,
  });
}

function silentLogger() {
  return buildLogger('silent');
}

module.exports = { memoryStore, testConfig, silentLogger, TEST_ADMIN_TOKEN };
