const path = require('path');

/* Registered after every route and static mount, right before
   errorHandler.js — without this, an unmatched request falls through to
   Express's own default 404, which is a bare "Cannot GET /x" HTML page
   even for an /api/* miss, where every caller (apiClient.js et al.)
   expects the app's own `{ error }` JSON envelope, not HTML. */
module.exports = function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  return res.status(404).sendFile(path.join(__dirname, '..', '..', 'public', '404.html'));
};
