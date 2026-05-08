const { loadConfig } = require('../src/config');
const { buildApp } = require('../src/app');
const { buildStore } = require('../src/store');

let cachedApp;
function getApp() {
  if (cachedApp) return cachedApp;
  const config = loadConfig();
  const store = buildStore({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
  });
  cachedApp = buildApp({ config, store });
  return cachedApp;
}

module.exports = (req, res) => getApp()(req, res);
