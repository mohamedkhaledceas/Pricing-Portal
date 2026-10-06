/* Same pattern as finance/repositories/unitOfWork.js — the sync writes
   every client change and its deal links atomically. */
const db = require('../../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
