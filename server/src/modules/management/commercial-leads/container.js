/* Composition root for this module — wires repositories -> services ->
   controllers -> routers. Nothing outside this file (or management's own
   container.js, which just re-exports what this one produces) should
   import this module's services/repositories/models directly. */
const dealsService = require('./services/dealsService');
const clickupSyncService = require('./services/clickupSyncService');
const freezeService = require('./services/freezeService');

const createDealsController = require('./controllers/dealsController');
const { createWebhookController } = require('./controllers/webhookController');

const createCommercialLeadsRouter = require('./routes/index');
const createWebhookRouter = require('./routes/webhookRoutes');

const { startReconciliationSchedule } = require('./jobs/reconcile');

const { authenticate } = require('../../auth');

const dealsController = createDealsController({ dealsService });
const webhookController = createWebhookController({ clickupSyncService });

const router = createCommercialLeadsRouter({ dealsController, authenticate });
const webhookRouter = createWebhookRouter({ webhookController });

module.exports = {
  router,
  webhookRouter,
  startReconciliationSchedule,
  scheduleQuarterFreeze: freezeService.scheduleQuarterFreeze,
};
