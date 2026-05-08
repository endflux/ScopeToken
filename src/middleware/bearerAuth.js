const crypto = require('node:crypto');

function notFound(res) {
  return res.status(404).type('text/plain').send('Not Found');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function bearerFromAuth(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function buildBearerAuth(adminToken) {
  if (!adminToken || adminToken.length < 16) {
    throw new Error('ADMIN_TOKEN must be set and at least 16 chars');
  }

  return function bearerAuth(req, res, next) {
    const provided = bearerFromAuth(req.get('authorization'));
    if (!provided || !safeEqual(provided, adminToken)) {
      return notFound(res);
    }
    return next();
  };
}

module.exports = { buildBearerAuth };
