/* Public interface of this module — the only thing index.js (or any other
   module) should ever require from `modules/auth`. Internals
   (services/repositories/models) stay private to the module, per the
   project's module-boundary rule. */
module.exports = require('./container');
