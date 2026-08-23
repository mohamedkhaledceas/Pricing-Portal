/* Both handlers are plain sync functions, same as commercial-leads'
   dealsController — ceoDashboardService reads from an in-memory mock
   object, nothing async, so a thrown ValidationError propagates through
   Express's own synchronous error handling with no catchAsync needed. */
function createCeoDashboardController({ ceoDashboardService }) {
  function snapshot(req, res) {
    const entity = req.query.entity || 'ceas';
    res.json({ snapshot: ceoDashboardService.getSnapshot(entity) });
  }

  function brief(req, res) {
    const entity = req.query.entity || 'ceas';
    res.json({ brief: ceoDashboardService.getBrief(entity) });
  }

  return { snapshot, brief };
}

module.exports = createCeoDashboardController;
