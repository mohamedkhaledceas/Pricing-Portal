/* The dashboard's data, fetched once from /api/ceo-dashboard/control-room.
   An exported `let` is a live binding, so every module reads the loaded
   object through `D` without it being passed around. Edits made on the page
   (targets, budgets, added KPIs) mutate this in-memory copy only — nothing
   is saved server-side yet. */
export let D = null;

export function setData(data) {
  D = data;
}
