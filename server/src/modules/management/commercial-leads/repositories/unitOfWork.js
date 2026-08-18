/* Same pattern as modules/auth/repositories/unitOfWork.js — the one place
   a caller (here: the one-time backfill job) needs to wrap many repository
   calls in a single SQL transaction for bulk-insert performance/atomicity.
   All this module's repositories share the same `db` singleton, so
   wrapping their calls from here still correctly covers all of them. */
const db = require('../../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
