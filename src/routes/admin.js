const express = require('express');
const oauth = require('../oauth');

function buildAdminRoutes({ config, store }) {
  const router = express.Router();

  router.get('/export', async (_req, res, next) => {
    try {
      const rows = await store.listTokens();
      return res.type('application/json').send(JSON.stringify(rows, null, 2));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/export/:id', async (req, res, next) => {
    try {
      const doc = await store.getToken(req.params.id);
      if (!doc) {
        return res
          .status(404)
          .type('application/json')
          .send('{"error":"not_found"}');
      }
      return res.type('application/json').send(
        JSON.stringify(
          {
            accessToken: doc.accessToken,
            refreshToken: doc.refreshToken,
            scope: doc.scope,
            expiresAt: doc.expiresAt,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return next(err);
    }
  });

  router.post('/refresh/:id', async (req, res, next) => {
    try {
      const doc = await store.getToken(req.params.id);
      if (!doc) {
        return res
          .status(404)
          .type('application/json')
          .send('{"error":"not_found"}');
      }

      const tokens = await oauth.refreshToken(config, doc.refreshToken);
      const expiresAt =
        Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600);

      await store.updateRefreshed(req.params.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || doc.refreshToken,
        expiresAt,
      });

      return res
        .type('application/json')
        .send(JSON.stringify({ ok: true, id: req.params.id, expiresAt }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/delete/:id', async (req, res, next) => {
    try {
      await store.deleteToken(req.params.id);
      return res
        .type('application/json')
        .send(JSON.stringify({ ok: true, id: req.params.id }));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { buildAdminRoutes };
