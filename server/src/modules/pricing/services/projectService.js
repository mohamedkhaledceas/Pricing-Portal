const { numOrDefault } = require('./numericField');
const { PricingError } = require('../errors');

// quote_json holds metadata only — `quote.lines` is never persisted from
// here. The frontend always resends the *whole* quote object (spread from
// its own client-side state) on every metadata field edit, specifically so
// a shallow merge here doesn't wipe the other fields — see
// modules/pricing/views/js/quote.js's quote-field commit handler. Same
// defaults as the legacy serializeProject().
function quoteMetaJson(quote) {
  const q = quote || {};
  return JSON.stringify({
    num: q.num || '',
    date: q.date || '',
    valid: numOrDefault(q.valid, 30, 'quote.valid'),
    detail: q.detail || 'lump',
    disc: numOrDefault(q.disc, 0, 'quote.disc'),
    vat: numOrDefault(q.vat, 0, 'quote.vat'),
    scope: q.scope || '',
    terms: q.terms || '',
  });
}

function createProjectService({
  projectRepository, projectLineRepository, directCostRepository, scenarioRepository,
  quoteLineRepository, appStateRepository, auditLogRepository, unitOfWork,
  projectModel, historyEntryModel, audit, generateId,
}) {
  function compose(row) {
    return projectModel.toProject(row, {
      lines: projectLineRepository.findByProjectId(row.id),
      directCosts: directCostRepository.findByProjectId(row.id),
      scenarios: scenarioRepository.findByProjectId(row.id),
      quoteLines: quoteLineRepository.findByProjectId(row.id),
    });
  }

  function list() {
    return projectRepository.findAll().map(compose);
  }

  // Also the "duplicate project" path (the frontend's #dupProject, in
  // modules/pricing/views/js/projects.js) — it POSTs a full copy of an
  // existing project (fresh ids on every child),
  // so create() has to accept and persist initial lines/direct/scenarios/
  // quote.lines, not just an empty shell.
  function create({ data, actorId, actorEmail, ip }) {
    const id = data.id || generateId('project');
    const quoteJson = quoteMetaJson(data.quote);

    const created = unitOfWork.transaction(() => {
      const projectRow = projectRepository.insert({
        id,
        name: data.name || 'New project',
        client: data.client || '',
        months: numOrDefault(data.months, 1, 'months'),
        status: data.status || 'Quoting',
        startMonth: data.start || '',
        currency: data.cur || 'EGP',
        contingency: numOrDefault(data.cont, 10, 'cont'),
        target: numOrDefault(data.target, 35, 'target'),
        price: numOrDefault(data.price, null, 'price'),
        quoteJson,
      });

      (Array.isArray(data.lines) ? data.lines : []).forEach((line) => {
        projectLineRepository.insert({
          id: line.id || generateId('line'),
          projectId: id,
          personId: line.personId || null,
          hours: numOrDefault(line.hours, 0, 'hours'),
        });
      });

      (Array.isArray(data.direct) ? data.direct : []).forEach((item) => {
        directCostRepository.insert({
          id: item.id || generateId('dc'),
          projectId: id,
          name: item.name || '',
          amount: numOrDefault(item.amount, 0, 'amount'),
          currency: item.cur || 'EGP',
        });
      });

      (Array.isArray(data.scenarios) ? data.scenarios : []).forEach((scenario) => {
        scenarioRepository.insert({
          id: scenario.id || generateId('scen'),
          projectId: id,
          name: scenario.name || 'New scenario',
          hoursFactor: numOrDefault(scenario.hoursFactor, 100, 'hoursFactor'),
          extra: numOrDefault(scenario.extra, 0, 'extra'),
          price: numOrDefault(scenario.price, null, 'price'),
        });
      });

      const quoteLinesData = data.quote && Array.isArray(data.quote.lines) ? data.quote.lines : [];
      quoteLinesData.forEach((item) => {
        quoteLineRepository.insert({
          id: item.id || generateId('ql'),
          projectId: id,
          name: item.name || '',
          amount: numOrDefault(item.amount, 0, 'amount'),
        });
      });

      appStateRepository.setCurrentProject(id);
      return projectRow;
    });

    const project = compose(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'project.create', entityType: 'project', entityId: project.id, details: { after: project }, ip });
    return project;
  }

  // Only the project's own scalar fields + quote metadata are merged here —
  // lines/direct/scenarios/quote-lines are only ever mutated through their
  // own dedicated endpoints (confirmed against the frontend: this
  // route never receives those arrays in practice). Same shallow-merge
  // semantics as the legacy route otherwise: a `quote` key in the patch
  // fully replaces the metadata (matching how the frontend always resends
  // its complete quote object), quote.lines is still never read from here.
  function update({ id, patch, actorId, actorEmail, ip }) {
    const existingRow = projectRepository.findById(id);
    if (!existingRow) throw new PricingError('Project not found.', 404);
    const before = compose(existingRow);
    const merged = { ...before, ...patch };

    const updatedRow = projectRepository.update(id, {
      name: merged.name || '',
      client: merged.client || '',
      months: numOrDefault(merged.months, 1, 'months'),
      status: merged.status || 'Quoting',
      startMonth: merged.start || '',
      currency: merged.cur || 'EGP',
      contingency: numOrDefault(merged.cont, 0, 'cont'),
      target: numOrDefault(merged.target, 35, 'target'),
      price: numOrDefault(merged.price, null, 'price'),
      quoteJson: quoteMetaJson(merged.quote),
    });

    const after = compose(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'project.update', entityType: 'project', entityId: id, details: { before, after }, ip });
    return after;
  }

  // No 404 on a missing id — same as the legacy route. Children cascade via
  // the projects table's ON DELETE CASCADE FKs.
  function remove({ id, actorId, actorEmail, ip }) {
    const existingRow = projectRepository.findById(id);
    const before = existingRow ? compose(existingRow) : null;

    unitOfWork.transaction(() => {
      projectRepository.remove(id);
      const appState = appStateRepository.get();
      if (appState && appState.current_project === id) {
        const remaining = projectRepository.findAll();
        appStateRepository.setCurrentProject(remaining[0] ? remaining[0].id : null);
      }
    });

    audit.record({ userId: actorId, username: actorEmail, action: 'project.delete', entityType: 'project', entityId: id, details: { before }, ip });
    return list();
  }

  function getHistory(id) {
    return auditLogRepository.findProjectHistory(id).map(historyEntryModel.toHistoryEntry);
  }

  function requireProject(projectId) {
    const row = projectRepository.findById(projectId);
    if (!row) throw new PricingError('Project not found.', 404);
  }

  // ---- project lines ----

  function createLine({ projectId, data, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const created = projectLineRepository.insert({
      id: data.id || generateId('line'),
      projectId,
      personId: data.personId || null,
      hours: numOrDefault(data.hours, 0, 'hours'),
    });
    const line = projectModel.toProjectLine(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'project_line.create', entityType: 'project_line', entityId: line.id, details: { projectId, after: line }, ip });
    return line;
  }

  function updateLine({ projectId, id, patch, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = projectLineRepository.findById(id);
    if (!existingRow || existingRow.project_id !== projectId) throw new PricingError('Project line not found.', 404);
    const before = projectModel.toProjectLine(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = projectLineRepository.update(id, {
      personId: merged.personId,
      hours: numOrDefault(merged.hours, 0, 'hours'),
    });
    const after = projectModel.toProjectLine(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'project_line.update', entityType: 'project_line', entityId: id, details: { projectId, before, after }, ip });
    return after;
  }

  // Scoped strictly to this project — an id that exists but belongs to a
  // different project is left untouched and treated as already-absent here,
  // same as the legacy route's project.lines.find/.filter (which could only
  // ever see this project's own array).
  function removeLine({ projectId, id, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = projectLineRepository.findById(id);
    const belongsHere = !!existingRow && existingRow.project_id === projectId;
    const before = belongsHere ? projectModel.toProjectLine(existingRow) : null;
    if (belongsHere) projectLineRepository.remove(id);
    audit.record({ userId: actorId, username: actorEmail, action: 'project_line.delete', entityType: 'project_line', entityId: id, details: { projectId, before }, ip });
    return projectLineRepository.findByProjectId(projectId).map(projectModel.toProjectLine);
  }

  // ---- direct costs ----

  function createDirectCost({ projectId, data, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const created = directCostRepository.insert({
      id: data.id || generateId('dc'),
      projectId,
      name: data.name || '',
      amount: numOrDefault(data.amount, 0, 'amount'),
      currency: data.cur || 'EGP',
    });
    const direct = projectModel.toDirectCost(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'direct_cost.create', entityType: 'direct_cost', entityId: direct.id, details: { projectId, after: direct }, ip });
    return direct;
  }

  function updateDirectCost({ projectId, id, patch, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = directCostRepository.findById(id);
    if (!existingRow || existingRow.project_id !== projectId) throw new PricingError('Direct cost not found.', 404);
    const before = projectModel.toDirectCost(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = directCostRepository.update(id, {
      name: merged.name || '',
      amount: numOrDefault(merged.amount, 0, 'amount'),
      currency: merged.cur || 'EGP',
    });
    const after = projectModel.toDirectCost(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'direct_cost.update', entityType: 'direct_cost', entityId: id, details: { projectId, before, after }, ip });
    return after;
  }

  function removeDirectCost({ projectId, id, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = directCostRepository.findById(id);
    const belongsHere = !!existingRow && existingRow.project_id === projectId;
    const before = belongsHere ? projectModel.toDirectCost(existingRow) : null;
    if (belongsHere) directCostRepository.remove(id);
    audit.record({ userId: actorId, username: actorEmail, action: 'direct_cost.delete', entityType: 'direct_cost', entityId: id, details: { projectId, before }, ip });
    return directCostRepository.findByProjectId(projectId).map(projectModel.toDirectCost);
  }

  // ---- scenarios ----

  function createScenario({ projectId, data, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const created = scenarioRepository.insert({
      id: data.id || generateId('scen'),
      projectId,
      name: data.name || 'New scenario',
      hoursFactor: numOrDefault(data.hoursFactor, 100, 'hoursFactor'),
      extra: numOrDefault(data.extra, 0, 'extra'),
      price: numOrDefault(data.price, null, 'price'),
    });
    const scenario = projectModel.toScenario(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'scenario.create', entityType: 'scenario', entityId: scenario.id, details: { projectId, after: scenario }, ip });
    return scenario;
  }

  function updateScenario({ projectId, id, patch, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = scenarioRepository.findById(id);
    if (!existingRow || existingRow.project_id !== projectId) throw new PricingError('Scenario not found.', 404);
    const before = projectModel.toScenario(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = scenarioRepository.update(id, {
      name: merged.name || '',
      hoursFactor: numOrDefault(merged.hoursFactor, 100, 'hoursFactor'),
      extra: numOrDefault(merged.extra, 0, 'extra'),
      price: numOrDefault(merged.price, null, 'price'),
    });
    const after = projectModel.toScenario(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'scenario.update', entityType: 'scenario', entityId: id, details: { projectId, before, after }, ip });
    return after;
  }

  function removeScenario({ projectId, id, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = scenarioRepository.findById(id);
    const belongsHere = !!existingRow && existingRow.project_id === projectId;
    const before = belongsHere ? projectModel.toScenario(existingRow) : null;
    if (belongsHere) scenarioRepository.remove(id);
    audit.record({ userId: actorId, username: actorEmail, action: 'scenario.delete', entityType: 'scenario', entityId: id, details: { projectId, before }, ip });
    return scenarioRepository.findByProjectId(projectId).map(projectModel.toScenario);
  }

  // ---- quote lines ----
  // quote_lines is the sole source of truth for quote.lines (see
  // quoteMetaJson above and projectRepository's header comment) — these are
  // the only functions that ever write to this table.

  // Create-or-merge by id: the frontend can re-send a line that already
  // exists (it resends the whole quote object, lines included, on every
  // metadata edit — see the PUT /api/projects/:id comment above), so this
  // has to tolerate a same-id repeat instead of crashing on the primary key.
  function createQuoteLine({ projectId, data, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const upserted = quoteLineRepository.upsert({
      id: data.id || generateId('ql'),
      projectId,
      name: data.name || '',
      amount: numOrDefault(data.amount, 0, 'amount'),
    });
    const line = projectModel.toQuoteLine(upserted);
    audit.record({ userId: actorId, username: actorEmail, action: 'quote_line.create', entityType: 'quote_line', entityId: line.id, details: { projectId, after: line }, ip });
    return line;
  }

  function updateQuoteLine({ projectId, id, patch, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = quoteLineRepository.findById(id);
    if (!existingRow || existingRow.project_id !== projectId) throw new PricingError('Quote line not found.', 404);
    const before = projectModel.toQuoteLine(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = quoteLineRepository.update(id, {
      name: merged.name || '',
      amount: numOrDefault(merged.amount, 0, 'amount'),
    });
    const after = projectModel.toQuoteLine(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'quote_line.update', entityType: 'quote_line', entityId: id, details: { projectId, before, after }, ip });
    return after;
  }

  function removeQuoteLine({ projectId, id, actorId, actorEmail, ip }) {
    requireProject(projectId);
    const existingRow = quoteLineRepository.findById(id);
    const belongsHere = !!existingRow && existingRow.project_id === projectId;
    const before = belongsHere ? projectModel.toQuoteLine(existingRow) : null;
    if (belongsHere) quoteLineRepository.remove(id);
    audit.record({ userId: actorId, username: actorEmail, action: 'quote_line.delete', entityType: 'quote_line', entityId: id, details: { projectId, before }, ip });
    return quoteLineRepository.findByProjectId(projectId).map(projectModel.toQuoteLine);
  }

  return {
    list, create, update, remove, getHistory,
    createLine, updateLine, removeLine,
    createDirectCost, updateDirectCost, removeDirectCost,
    createScenario, updateScenario, removeScenario,
    createQuoteLine, updateQuoteLine, removeQuoteLine,
  };
}

module.exports = createProjectService;
