/* The one place a cross-repository atomic operation is needed within this
   module (changing a password and revoking that user's refresh tokens
   together — see authService.changePassword and accountAdminService's
   deactivate). userRepository and refreshTokenRepository both use the same
   shared `db` singleton, so wrapping their calls in a transaction from here
   still correctly covers both. Not a general unit-of-work framework — just
   the minimal wrapper the one real need calls for. */
const db = require('../../../db');

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { transaction };
