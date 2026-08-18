/* management/ has no controllers/services/repositories/models of its own —
   its only real feature right now is commercial-leads/. This file is thin
   composition, not a second layer of indirection: it just re-exports what
   commercial-leads/container.js already produced. If a second real
   management-domain feature is ever added, it gets its own subfolder the
   same way commercial-leads/ did, and *then* promoting shared logic to this
   file's top level is justified by something actually needing to be
   shared — not before. */
const commercialLeads = require('./commercial-leads/container');

module.exports = {
  commercialLeads,
};
