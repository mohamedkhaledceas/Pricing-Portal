const { AppError } = require('../../common/errors');

/* Same pattern as modules/employees/errors.js — extends the shared AppError
   so errorHandler.js's `instanceof AppError` check picks these up and
   renders the existing flat `{ error: string }` response shape. */
class PricingError extends AppError {
  constructor(message, status = 400) {
    super(message, status, true);
  }
}

module.exports = { PricingError };
