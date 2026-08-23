/* Mounts each management-domain feature's router — thin composition, same
   reasoning as container.js. */
const express = require('express');
const { commercialLeads, ceoDashboard } = require('../container');

const router = express.Router();
router.use(commercialLeads.router);
router.use(ceoDashboard.router);

module.exports = { router, webhookRouter: commercialLeads.webhookRouter };
