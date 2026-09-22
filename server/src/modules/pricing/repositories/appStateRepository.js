/* app_state — singleton row (id = 1). Only `current_project` is ever
   written through the Pricing API today (nothing here sets `mode` or the
   security pin), so setCurrentProject always re-supplies the row's existing
   values for those columns rather than risking clobbering them with defaults. */
const db = require('../../../db');

function get() {
  return db.prepare('SELECT * FROM app_state WHERE id = 1').get();
}

function setCurrentProject(projectId) {
  const existing = get();
  db.prepare(`
    INSERT INTO app_state (id, current_project, mode, security_pin_hash)
    VALUES (1, @currentProject, @mode, @securityPinHash)
    ON CONFLICT(id) DO UPDATE SET
      current_project = excluded.current_project,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    currentProject: projectId,
    mode: existing?.mode || 'admin',
    securityPinHash: existing?.security_pin_hash ?? null,
  });
  return get();
}

module.exports = { get, setCurrentProject };
