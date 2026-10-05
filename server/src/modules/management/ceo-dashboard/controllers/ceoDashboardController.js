/* The service is synchronous (better-sqlite3 reads), but the handler still
   forwards errors explicitly rather than relying on Express 4 catching a
   synchronous throw — deliberate, per the project's preference for
   explicit error paths in new controllers. */
function createCeoDashboardController({ controlRoomService, clientBookService }) {
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

  function clients(req, res, next) {
    try {
      res.json({ clients: clientBookService.listClients(req.query) });
    } catch (err) {
      next(err);
    }
  }

  // Async: the detail fetches the client's ClickUp tasks live.
  async function clientDetail(req, res, next) {
    try {
      res.json({ client: await clientBookService.getClientDetail(req.params.key) });
    } catch (err) {
      next(err);
    }
  }

  return { controlRoom, budget, clients, clientDetail };
}

module.exports = createCeoDashboardController;
