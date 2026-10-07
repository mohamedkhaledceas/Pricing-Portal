const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { USER_MANAGER_ROLES } = require('../../../../common/permissions');

/* Mounted at /api in app.js: /api/finance/client-mapping[...].

   Gated server-side to USER_MANAGER_ROLES (ceo, admin, operations) — user
   decision 2026-10-05, matching the Commercial Lead page where clients
   live. clientMappingService re-checks the role itself. The `finance`
   role gets nothing here yet (ADR-0013 §9: not before the Finance page). */
function createFinanceRouter({ clientMappingController, authenticate }) {
  const router = express.Router();
  const requireMapper = requireRole(USER_MANAGER_ROLES);

  router.get('/finance/client-mapping', authenticate, requireMapper, clientMappingController.overview);
  router.post('/finance/client-mapping/links', authenticate, requireMapper, clientMappingController.link);
  router.post('/finance/client-mapping/links/exact-names', authenticate, requireMapper, clientMappingController.linkExactPairs);
  router.post('/finance/client-mapping/rejections', authenticate, requireMapper, clientMappingController.reject);
  router.post('/finance/client-mapping/clients', authenticate, requireMapper, clientMappingController.createClient);

  return router;
}

module.exports = createFinanceRouter;
