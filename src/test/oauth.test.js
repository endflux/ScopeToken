const test = require('node:test');
const assert = require('node:assert/strict');
const { MockAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');

const { buildConsentUrl, exchangeCode, refreshToken } = require('../oauth');
const { testConfig } = require('./_helpers');

function mockMicrosoft() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const original = getGlobalDispatcher();
  setGlobalDispatcher(agent);
  const pool = agent.get('https://login.microsoftonline.com');
  return {
    pool,
    restore() {
      setGlobalDispatcher(original);
    },
  };
}

test('buildConsentUrl encodes scopes and required params', () => {
  const url = new URL(buildConsentUrl(testConfig()));
  assert.equal(url.host, 'login.microsoftonline.com');
  assert.equal(url.pathname, '/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/login/authorized');
  assert.equal(url.searchParams.get('scope'), 'User.Read offline_access');
  assert.equal(url.searchParams.get('response_mode'), 'query');
});

test('exchangeCode parses the JSON response', async () => {
  const { pool, restore } = mockMicrosoft();
  pool
    .intercept({ path: '/common/oauth2/v2.0/token', method: 'POST' })
    .reply(200, {
      access_token: 'AT',
      refresh_token: 'RT',
      id_token: 'IT',
      expires_in: 3600,
      scope: 'User.Read',
    });
  try {
    const res = await exchangeCode(testConfig(), 'the-code');
    assert.equal(res.access_token, 'AT');
    assert.equal(res.refresh_token, 'RT');
  } finally {
    restore();
  }
});

test('refreshToken surfaces error_description on non-2xx', async () => {
  const { pool, restore } = mockMicrosoft();
  pool
    .intercept({ path: '/common/oauth2/v2.0/token', method: 'POST' })
    .reply(400, { error: 'invalid_grant', error_description: 'expired refresh token' });
  try {
    await assert.rejects(
      () => refreshToken(testConfig(), 'old-refresh'),
      /invalid_grant.*expired refresh token/,
    );
  } finally {
    restore();
  }
});
