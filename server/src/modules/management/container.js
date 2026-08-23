/* management/ has no controllers/services/repositories/models of its own —
   this file is thin composition, not a second layer of indirection: it
   just re-exports what each feature's own container.js already produced.
   ceo-dashboard/ is the second real management-domain feature, added the
   same way commercial-leads/ was; promoting any shared logic to this
   file's top level is still deferred until something actually needs to
   share it — not before. */
const commercialLeads = require('./commercial-leads/container');
const ceoDashboard = require('./ceo-dashboard/container');

module.exports = {
  commercialLeads,
  ceoDashboard,
};
