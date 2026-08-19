/* Same pattern as modules/auth/errors.js — a thin, purpose-built error type
   carrying an HTTP status, so controllers can translate it directly to the
   existing flat `{ error: string }` response shape used everywhere else in
   this app. */
class EmployeesError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { EmployeesError };
