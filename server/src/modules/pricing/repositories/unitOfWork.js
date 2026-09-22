/* Same pattern as modules/management/commercial-leads/repositories/unitOfWork.js
   — the handful of pricing writes that genuinely span tables (creating a
   project also sets app_state.current_project; deleting one may clear it;
   deleting a team member also has to null out any project_lines pointing
   at them) go through this instead of each repository managing its own
   transaction. All this module's repositories share the same `db`
   singleton, so wrapping calls from here still correctly covers all of them. */
const db = require('../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
