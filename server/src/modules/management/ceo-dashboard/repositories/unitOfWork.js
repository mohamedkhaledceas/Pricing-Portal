/* Same pattern as finance/repositories/unitOfWork.js — one transaction
   for a write that spans tables (a custom KPI and its first target). */
const db = require('../../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
