/* Same pattern as finance/repositories/unitOfWork.js — the sync replaces
   the task copy and its assignees atomically. */
const db = require('../../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
