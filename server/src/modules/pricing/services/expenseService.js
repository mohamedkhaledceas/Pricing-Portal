const { numOrDefault } = require('./numericField');
const { PricingError } = require('../errors');

// Same response contract as teamService: create/update/remove all return
// the full, current expense list.
function createExpenseService({ expenseRepository, expenseModel, audit, generateId }) {
  function list() {
    return expenseRepository.findAll().map(expenseModel.toExpense);
  }

  function create({ data, actorId, actorEmail, ip }) {
    const id = data.id || generateId('expense');
    const created = expenseRepository.insert({
      id,
      name: data.name || '',
      category: data.cat || '',
      amount: numOrDefault(data.amount, 0, 'amount'),
      freq: data.freq || 'month',
      currency: data.cur || 'EGP',
    });
    const expense = expenseModel.toExpense(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'expense.create', entityType: 'expense', entityId: expense.id, details: { after: expense }, ip });
    return list();
  }

  function update({ id, patch, actorId, actorEmail, ip }) {
    const existingRow = expenseRepository.findById(id);
    if (!existingRow) throw new PricingError('Expense not found.', 404);
    const before = expenseModel.toExpense(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = expenseRepository.update(id, {
      name: merged.name || '',
      category: merged.cat || '',
      amount: numOrDefault(merged.amount, 0, 'amount'),
      freq: merged.freq || 'month',
      currency: merged.cur || 'EGP',
    });
    const after = expenseModel.toExpense(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'expense.update', entityType: 'expense', entityId: id, details: { before, after }, ip });
    return list();
  }

  // No 404 on a missing id — same as the legacy route.
  function remove({ id, actorId, actorEmail, ip }) {
    const existingRow = expenseRepository.findById(id);
    const before = existingRow ? expenseModel.toExpense(existingRow) : null;
    expenseRepository.remove(id);
    audit.record({ userId: actorId, username: actorEmail, action: 'expense.delete', entityType: 'expense', entityId: id, details: { before }, ip });
    return list();
  }

  return { list, create, update, remove };
}

module.exports = createExpenseService;
