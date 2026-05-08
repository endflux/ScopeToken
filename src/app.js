const express = require('express');
const helmet = require('helmet');

const { buildLogger, buildHttpLogger } = require('./logger');
const { buildBearerAuth } = require('./middleware/bearerAuth');
const { buildErrorHandler } = require('./middleware/errorHandler');
const { buildConsentRoutes } = require('./routes/consent');
const { buildAdminRoutes } = require('./routes/admin');

function buildApp({ config, store, logger = buildLogger(config.LOG_LEVEL) }) {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet());
  app.use(buildHttpLogger(logger));
  app.use(express.urlencoded({ extended: false }));

  app.use('/', buildConsentRoutes({ config, store, logger }));
  app.use(
    '/admin',
    buildBearerAuth(config.ADMIN_TOKEN),
    buildAdminRoutes({ config, store }),
  );

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not Found');
  });

  app.use(buildErrorHandler({ logger, decoyUrl: config.DECOY_URL }));

  return app;
}

module.exports = { buildApp };
