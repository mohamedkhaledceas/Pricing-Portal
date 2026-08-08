const logger = require('./logger');
const { AppError } = require('./errors');

/* Response shape stays `{ error: <string> }` to match the existing frontend
   contract (margin-planner_1.html's apiRequest reads `data.error` as a
   plain string) — not the nested {error:{message,code,details}} envelope
   used elsewhere, since that would break every existing caller. */
module.exports = function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;

  logger.error(err.message || 'Unhandled error', {
    correlationId: req.correlationId,
    statusCode: status,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    userId: req.user ? req.user.id : null,
  });

  if (err instanceof AppError) {
    return res.status(status).json({ error: err.message });
  }

  /* express.json() throws a SyntaxError with `.status === 400` on malformed
     request bodies — a client error, not a server fault, but its message
     shouldn't be echoed back verbatim. */
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'The request could not be understood.' });
  }

  return res.status(500).json({ error: 'Internal server error.' });
};
