function buildErrorHandler({ logger, decoyUrl }) {
  return function errorHandler(err, req, res, _next) {
    logger.error({ err, path: req.path }, 'request failed');
    if (req.path.startsWith('/admin')) {
      return res
        .status(500)
        .type('application/json')
        .send(JSON.stringify({ error: 'internal_error' }));
    }
    return res.redirect(302, decoyUrl);
  };
}

module.exports = { buildErrorHandler };
