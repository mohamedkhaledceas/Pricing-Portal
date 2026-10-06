/* POST /api/clients/clickup-sync — the client book and client-mapping
   page call it on load. Returns quickly when throttled; otherwise waits
   for the (≈0.5s) sync so the page knows whether to refetch. */
function createClientSyncController({ clickupClientSyncService }) {
  async function sync(req, res, next) {
    try {
      const result = await clickupClientSyncService.sync({ trigger: 'page' });
      res.json({ sync: { status: result.status, changed: result.changed, state: result.state } });
    } catch (err) {
      next(err);
    }
  }

  return { sync };
}

module.exports = createClientSyncController;
