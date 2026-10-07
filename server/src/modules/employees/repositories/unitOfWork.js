/* Same pattern as finance/repositories/unitOfWork.js — one transaction for
   a write that spans tables (a team review: who submitted, what they said,
   and the reviewee's recomputed Pillar A). */
const db = require('../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
