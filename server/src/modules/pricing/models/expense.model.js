function toExpense(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    cat: row.category || '',
    amount: Number(row.amount || 0),
    freq: row.freq || 'month',
    cur: row.currency || 'EGP',
  };
}

module.exports = { toExpense };
