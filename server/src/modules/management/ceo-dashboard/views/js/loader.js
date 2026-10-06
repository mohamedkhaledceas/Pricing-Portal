import { apiFetch } from './apiClient.js';
import { D, setData } from './data.js';
import { S } from './model.js';

/* One payload per entity (the Odoo figures are per company), fetched on
   first view and cached for the page's lifetime. */
const cache = new Map();

/* Operations / P&C: the Budget tab's data only, from its own endpoint. */
export async function loadBudget() {
  const { controlRoom } = await apiFetch('/api/ceo-dashboard/budget');
  setData(controlRoom);
}

export async function loadEntity(key) {
  let data = cache.get(key);
  if (!data) {
    ({ controlRoom: data } = await apiFetch('/api/ceo-dashboard/control-room?entity=' + encodeURIComponent(key)));
    cache.set(key, data);
  }
  // Targets and added KPIs come with each view's payload (saved per view).
  setData(data);
  S.ent = key;
}
