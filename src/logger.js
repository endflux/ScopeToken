const pino = require('pino');
const pinoHttp = require('pino-http');

const REDACT_PATHS = [
  'req.query.code',
  'req.query.access_token',
  'req.query.refresh_token',
  'req.query.id_token',
  'req.body.code',
  'req.body.access_token',
  'req.body.refresh_token',
  'req.body.id_token',
  'res.body.access_token',
  'res.body.refresh_token',
  'res.body.id_token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.code',
];

function buildLogger(level = 'info') {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: undefined,
  });
}

function buildHttpLogger(logger) {
  return pinoHttp({
    logger,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, ip: req.ip };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}

module.exports = { buildLogger, buildHttpLogger };
