import { apiFetch } from './apiClient.js';
import { D, setData } from './data.js';
import { S } from './model.js';

/* One payload per entity (the Odoo figures are per company), fetched on
   first view and cached for the page's lifetime. */
const cache = new Map();

export async function loadEntity(key) {
  let data = cache.get(key);
  if (!data) {
    ({ controlRoom: data } = await apiFetch('/api/ceo-dashboard/control-room?entity=' + encodeURIComponent(key)));
    cache.set(key, data);
  }
  // KPIs added on the Targets page live only in the loaded copy until
  // they're persisted (phase 3) — carry them across an entity switch.
  const added = D ? D.kpis.filter((k) => S.addedKpis.includes(k.id)) : [];
  setData(data);
  added.forEach((k) => { if (!D.kpis.some((x) => x.id === k.id)) D.kpis.push(k); });
  S.ent = key;
}
