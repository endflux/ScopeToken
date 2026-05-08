const { Redis } = require('@upstash/redis');

const INDEX_KEY = 'tokens:index';
const tokenKey = (tenantId, oid) => `token:${tenantId}:${oid}`;
const idFromKey = (key) => key.replace(/^token:/, '');
const splitId = (id) => {
  const idx = id.indexOf(':');
  return { tenantId: id.slice(0, idx), oid: id.slice(idx + 1) };
};

function buildStore({ url, token } = {}) {
  const redis = new Redis({
    url: url || process.env.UPSTASH_REDIS_REST_URL,
    token: token || process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  return {
    async upsertToken({
      upn,
      oid,
      tenantId,
      displayName,
      accessToken,
      refreshToken,
      idToken,
      scope,
      expiresAt,
      sourceIp,
      userAgent,
    }) {
      const key = tokenKey(tenantId, oid);
      const id = `${tenantId}:${oid}`;
      const existing = await redis.get(key);
      const now = Math.floor(Date.now() / 1000);
      const record = {
        upn: upn ?? null,
        oid,
        tenantId,
        displayName: displayName ?? null,
        accessToken,
        refreshToken,
        idToken: idToken ?? null,
        scope: scope ?? null,
        expiresAt,
        capturedAt: existing?.capturedAt ?? now,
        lastRefreshed: existing?.lastRefreshed ?? null,
        sourceIp: sourceIp ?? null,
        userAgent: userAgent ?? null,
      };
      await redis.set(key, record);
      await redis.zadd(INDEX_KEY, { score: record.capturedAt, member: id });
      return id;
    },

    async listTokens() {
      const ids = await redis.zrange(INDEX_KEY, 0, -1, { rev: true });
      if (!ids || ids.length === 0) return [];
      const keys = ids.map((id) => {
        const { tenantId, oid } = splitId(id);
        return tokenKey(tenantId, oid);
      });
      const records = await redis.mget(...keys);
      return records
        .map((r, i) => (r ? { id: ids[i], ...r } : null))
        .filter(Boolean);
    },

    async getToken(id) {
      const { tenantId, oid } = splitId(id);
      const r = await redis.get(tokenKey(tenantId, oid));
      return r ? { id, ...r } : null;
    },

    async updateRefreshed(id, { accessToken, refreshToken, expiresAt }) {
      const { tenantId, oid } = splitId(id);
      const key = tokenKey(tenantId, oid);
      const existing = await redis.get(key);
      if (!existing) return false;
      const now = Math.floor(Date.now() / 1000);
      await redis.set(key, {
        ...existing,
        accessToken,
        refreshToken,
        expiresAt,
        lastRefreshed: now,
      });
      return true;
    },

    async deleteToken(id) {
      const { tenantId, oid } = splitId(id);
      await redis.del(tokenKey(tenantId, oid));
      await redis.zrem(INDEX_KEY, id);
    },

    async wipeAll() {
      const ids = await redis.zrange(INDEX_KEY, 0, -1);
      if (!ids || ids.length === 0) return 0;
      const keys = ids.map((id) => {
        const { tenantId, oid } = splitId(id);
        return tokenKey(tenantId, oid);
      });
      await redis.del(...keys);
      await redis.del(INDEX_KEY);
      return ids.length;
    },
  };
}

module.exports = { buildStore, INDEX_KEY, tokenKey, idFromKey };
