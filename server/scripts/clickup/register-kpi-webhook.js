// One-time (per environment) setup: registers the KPI module's own
// ClickUp webhook, team-wide (no folder_id/space_id/list_id) since the 6
// KPI-tracked roles' real lists span multiple spaces (confirmed during
// planning — Content-adjacent work under "Ceas Comm | Kitchen", AM under
// "Commercial Lead", P&C under "Process Library"). Filtering by list_id
// happens in code (kpiClickupSyncService), against kpi_auto_metric_
// mappings' configured lists, not at the ClickUp subscription level — see
// docs/adr/0012 addendum for why. Writes the resulting secret into
// server/.env as CLICKUP_KPI_WEBHOOK_SECRET (distinct from
// CLICKUP_WEBHOOK_SECRET, which stays commercial-leads' own webhook's
// secret) — never printed to the console.
//
// Usage: node scripts/clickup/register-kpi-webhook.js <targetUrl>
//   e.g. node scripts/clickup/register-kpi-webhook.js https://smee.io/XXXXXXXX

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const TEAM_ID = '36181979'; // "The Ceas Workplace"
const EVENTS = ['taskStatusUpdated'];

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error('Usage: node scripts/clickup/register-kpi-webhook.js <targetUrl>');
  process.exit(1);
}

const apiKey = process.env.CLICKUP_API_KEY;
if (!apiKey) {
  console.error('CLICKUP_API_KEY not found in server/.env');
  process.exit(1);
}

function saveSecretToEnv(secret) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^CLICKUP_KPI_WEBHOOK_SECRET=/m.test(content)) {
    content = content.replace(/^CLICKUP_KPI_WEBHOOK_SECRET=.*$/m, `CLICKUP_KPI_WEBHOOK_SECRET=${secret}`);
  } else {
    content += `${content.endsWith('\n') ? '' : '\n'}CLICKUP_KPI_WEBHOOK_SECRET=${secret}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

async function main() {
  const res = await fetch(`https://api.clickup.com/api/v2/team/${TEAM_ID}/webhook`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: targetUrl,
      events: EVENTS,
      // Deliberately no folder_id/space_id/list_id — team-wide.
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Webhook registration failed (${res.status}):`, JSON.stringify(body));
    process.exit(1);
  }

  saveSecretToEnv(body.webhook.secret);

  console.log('KPI webhook registered.');
  console.log('  webhook id:', body.webhook.id);
  console.log('  endpoint:', body.webhook.endpoint);
  console.log('  events:', body.webhook.events.join(', '));
  console.log('  scope: team-wide (no folder/space/list restriction)');
  console.log('CLICKUP_KPI_WEBHOOK_SECRET written to server/.env (not printed here).');
}

main().catch((e) => {
  console.error('Script error:', e.message);
  process.exit(1);
});
