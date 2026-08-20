const { AppError } = require('../../common/errors');

/* Extends the shared AppError (rather than plain Error) specifically so
   errorHandler.js's `instanceof AppError` check picks these up: that's what
   makes a thrown AuthError get logged (with a correlation ID) and still
   render as the existing flat `{ error: string }` response shape the
   current frontend contract expects — not the target { data }/{ error: {
   code } } envelope, which isn't implemented anywhere in this app yet (see
   docs/api-guidelines.md vs. the actual errorHandler.js comment
   acknowledging that gap). Adopting the full envelope for only this one
   module's errors would just be a third inconsistent convention on top of
   the two that already exist. */
class AuthError extends AppError {
  constructor(message, status = 400) {
    super(message, status, true);
  }
}

module.exports = { AuthError };
