const { decodeJwt } = require('jose');

function decodeIdToken(idToken) {
  if (!idToken) return {};
  const c = decodeJwt(idToken);
  return {
    upn: c.upn || c.preferred_username || c.email || null,
    oid: c.oid || c.sub || null,
    tenantId: c.tid || null,
    displayName: c.name || null,
  };
}

module.exports = { decodeIdToken };
