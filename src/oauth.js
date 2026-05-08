const TOKEN_ENDPOINT = (tenant) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

const AUTHORIZE_ENDPOINT = (tenant) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;

function buildConsentUrl(config, { state } = {}) {
  const params = new URLSearchParams({
    client_id: config.CLIENT_ID,
    response_type: 'code',
    redirect_uri: config.REDIRECT_URI,
    response_mode: 'query',
    scope: config.SCOPES,
  });
  if (state) params.set('state', state);
  return `${AUTHORIZE_ENDPOINT(config.TENANT)}?${params.toString()}`;
}

async function postToken(config, body) {
  const res = await fetch(TOKEN_ENDPOINT(config.TENANT), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON (status ${res.status})`);
  }
  if (!res.ok) {
    const err = new Error(
      `Token endpoint error: ${json.error || res.status} ${json.error_description || ''}`,
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function exchangeCode(config, code) {
  return postToken(config, {
    client_id: config.CLIENT_ID,
    client_secret: config.CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.REDIRECT_URI,
    scope: config.SCOPES,
  });
}

async function refreshToken(config, refresh_token) {
  return postToken(config, {
    client_id: config.CLIENT_ID,
    client_secret: config.CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token,
    scope: config.SCOPES,
  });
}

module.exports = { buildConsentUrl, exchangeCode, refreshToken };
