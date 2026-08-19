/* Express 4 doesn't catch a rejected promise from an async route handler on
   its own — an unexpected error thrown inside one (as opposed to a known
   error type a controller already turns into a response itself) would
   otherwise just hang the request instead of reaching errorHandler.js.
   Wraps a controller so that case reaches next(error) like a synchronous
   throw already would. */
function catchAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = catchAsync;
