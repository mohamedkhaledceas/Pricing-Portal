const { AppError } = require('../../common/errors');

/* Same pattern as modules/auth/errors.js — extends the shared AppError
   (rather than plain Error) so errorHandler.js's `instanceof AppError`
   check picks these up: a thrown EmployeesError gets logged (with a
   correlation ID) by the central handler and still renders as the
   existing flat `{ error: string }` response shape used everywhere else
   in this app. */
class EmployeesError extends AppError {
  constructor(message, status = 400) {
    super(message, status, true);
  }
}

module.exports = { EmployeesError };
