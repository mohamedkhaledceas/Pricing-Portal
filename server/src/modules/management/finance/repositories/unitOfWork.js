/* Same pattern as commercial-leads/repositories/unitOfWork.js — lets the
   sync service write one model's rows and its sync-state row atomically. */
const db = require('../../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
