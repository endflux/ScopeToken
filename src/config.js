const { z } = require('zod');

const schema = z.object({
  CLIENT_ID: z.string().min(1),
  CLIENT_SECRET: z.string().min(1),
  REDIRECT_URI: z.string().url(),
  SCOPES: z.string().min(1),
  TENANT: z.string().min(1).default('common'),
  DECOY_URL: z.string().url(),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 characters'),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TRUST_PROXY: z.string().default('1'),
});

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`,
    );
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const trustProxy = (() => {
    const v = parsed.data.TRUST_PROXY;
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    return Number.isInteger(n) ? n : v;
  })();
  return Object.freeze({ ...parsed.data, TRUST_PROXY: trustProxy });
}

module.exports = { loadConfig };
