import { $ } from './dom.js';
import { state } from './state.js';
import { LIST_KEY_BY_ID, renderPipelineTable, renderActiveClientsTable } from './deals.js';

/* onEvent is called after every processed update (used by main.js to debounce
   a stats/stage-durations refetch) — kept as a callback param rather than an
   import of main.js, to avoid a circular module dependency. */
export function connectSocket({ onEvent } = {}) {
  const socket = io({ path: '/socket.io' });
  socket.on('connect', () => { $('#connDot').classList.add('live'); $('#connLabel').textContent = 'Live'; });
  socket.on('disconnect', () => { $('#connDot').classList.remove('live'); $('#connLabel').textContent = 'Reconnecting…'; });

  socket.on('clickup:event', (payload) => {
    const dealId = payload.task_id;
    for (const key of Object.keys(state.dealsCache)) {
      state.dealsCache[key] = state.dealsCache[key].filter((d) => d.id !== dealId);
    }
    if (payload.current) {
      const key = LIST_KEY_BY_ID[payload.current.list_id];
      if (key) {
        state.dealsCache[key].unshift({
          id: payload.current.deal_id,
          name: payload.current.name,
          status: payload.current.status,
          fields: payload.current.fields,
          subtasks: payload.current.subtasks,
          clickupCreatedAt: payload.current.clickup_created_at,
          clickupUpdatedAt: payload.current.clickup_updated_at,
        });
      }
    }
    renderPipelineTable();
    renderActiveClientsTable();
    if (onEvent) onEvent();
  });
}
