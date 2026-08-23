/* Composition root for this module — wires the (currently mock)
   repository -> service -> controller -> router. Nothing outside this file
   (or management's own container.js, which just re-exports what this one
   produces) should import this module's service/repository directly. */
const ceoDashboardService = require('./services/ceoDashboardService');
const createCeoDashboardController = require('./controllers/ceoDashboardController');
const createCeoDashboardRouter = require('./routes/index');

const { authenticate } = require('../../auth');

const ceoDashboardController = createCeoDashboardController({ ceoDashboardService });
const router = createCeoDashboardRouter({ ceoDashboardController, authenticate });

module.exports = { router };
