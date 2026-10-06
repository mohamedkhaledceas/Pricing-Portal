const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { USER_MANAGER_ROLES } = require('../../../../common/permissions');

/* Mounted at /api in app.js.
   - POST /api/clients/clickup-sync — authenticate (401) then
     USER_MANAGER_ROLES (ceo, admin, operations; 403 otherwise): everyone
     who can open the client book or the client-mapping page. It only
     re-reads ClickUp's dropdown into the client list — no input is taken
     from the request. */
function createClientsRouter({ clientSyncController, authenticate }) {
  const router = express.Router();
  router.post('/clients/clickup-sync', authenticate, requireRole(USER_MANAGER_ROLES), clientSyncController.sync);
  return router;
}

module.exports = createClientsRouter;
