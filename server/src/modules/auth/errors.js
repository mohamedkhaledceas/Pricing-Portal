/* Thin, purpose-built for this module: carries an HTTP status alongside a
   user-facing message so controllers can translate it directly to the
   existing flat `{ error: string }` response shape the current frontend
   contract expects — not the target { data }/{ error: { code } } envelope,
   which isn't implemented anywhere in this app yet (see docs/api-guidelines.md
   vs. the actual errorHandler.js comment acknowledging that gap). Adopting
   the full envelope for only this one module's errors would just be a third
   inconsistent convention on top of the two that already exist. */
class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { AuthError };
