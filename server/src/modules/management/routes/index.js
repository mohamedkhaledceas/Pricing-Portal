/* Mounts commercial-leads' router (and, if a second management-domain
   feature is ever added, that one's too) — thin composition, same
   reasoning as container.js. */
const express = require('express');
const { commercialLeads } = require('../container');

const router = express.Router();
router.use(commercialLeads.router);

module.exports = { router, webhookRouter: commercialLeads.webhookRouter };
