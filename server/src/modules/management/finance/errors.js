const { AppError } = require('../../../common/errors');

/* management/finance's operational error — same shape as employees'
   EmployeesError, so errorHandler.js renders it via its AppError branch. */
class FinanceError extends AppError {
  constructor(message, statusCode = 400) {
    super(message, statusCode, true);
  }
}

module.exports = { FinanceError };
