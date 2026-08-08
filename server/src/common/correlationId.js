const crypto = require('crypto');

module.exports = function correlationId(req, res, next) {
  const id = crypto.randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
};
