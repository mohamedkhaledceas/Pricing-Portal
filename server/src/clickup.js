const { AppError } = require('./common/errors');

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

async function clickupGet(path) {
  const apiKey = process.env.CLICKUP_API_KEY;
  if (!apiKey) {
    throw new AppError('ClickUp integration is not configured — set CLICKUP_API_KEY.', 500);
  }
  const res = await fetch(`${CLICKUP_BASE}${path}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(`ClickUp API error (${res.status}) on ${path}: ${body}`, 502);
  }
  return res.json();
}

/* Structural survey only — space/folder/list names and IDs, not tasks or
   custom fields. Cheap enough to run in a handful of requests regardless of
   workspace size, and enough to point at a specific list for a follow-up,
   deeper fetch once we know what we actually need. */
async function getWorkspaceSurvey() {
  const { teams } = await clickupGet('/team');

  return Promise.all((teams || []).map(async (team) => {
    const { spaces } = await clickupGet(`/team/${team.id}/space?archived=false`);

    const spaceSurveys = await Promise.all((spaces || []).map(async (space) => {
      const [{ folders }, { lists: folderlessLists }] = await Promise.all([
        clickupGet(`/space/${space.id}/folder?archived=false`),
        clickupGet(`/space/${space.id}/list?archived=false`),
      ]);

      return {
        id: space.id,
        name: space.name,
        folders: (folders || []).map((folder) => ({
          id: folder.id,
          name: folder.name,
          lists: (folder.lists || []).map((list) => ({ id: list.id, name: list.name })),
        })),
        folderlessLists: (folderlessLists || []).map((list) => ({ id: list.id, name: list.name })),
      };
    }));

    return { id: team.id, name: team.name, spaces: spaceSurveys };
  }));
}

module.exports = { clickupGet, getWorkspaceSurvey };
