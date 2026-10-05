/* The service is synchronous (better-sqlite3 reads), but the handler still
   forwards errors explicitly rather than relying on Express 4 catching a
   synchronous throw — deliberate, per the project's preference for
   explicit error paths in new controllers. */
function createCeoDashboardController({ controlRoomService }) {
  function controlRoom(req, res, next) {
    try {
      const entity = req.query.entity || 'ceas';
      res.json({ controlRoom: controlRoomService.getControlRoom(String(entity)) });
    } catch (err) {
      next(err);
    }
  }

  function budget(req, res, next) {
    try {
      res.json({ controlRoom: controlRoomService.getBudget() });
    } catch (err) {
      next(err);
    }
  }

  return { controlRoom, budget };
}

module.exports = createCeoDashboardController;
