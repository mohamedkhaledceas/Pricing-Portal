/* The dashboard's data, fetched once from /api/ceo-dashboard/control-room.
   An exported `let` is a live binding, so every module reads the loaded
   object through `D` without it being passed around. Budget and function-
   plan edits are saved on the server first, then written here (phase 3);
   targets and added KPIs still change this in-memory copy only. */
export let D = null;

export function setData(data) {
  D = data;
}
