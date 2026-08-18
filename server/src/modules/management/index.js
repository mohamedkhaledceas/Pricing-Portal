/* Public interface of this module — the only thing app.js (or any other
   module) should ever require from `modules/management`. */
const { router, webhookRouter } = require('./routes/index');
const { commercialLeads } = require('./container');

module.exports = {
  router,
  webhookRouter,
  startReconciliationSchedule: commercialLeads.startReconciliationSchedule,
  scheduleQuarterFreeze: commercialLeads.scheduleQuarterFreeze,
};
