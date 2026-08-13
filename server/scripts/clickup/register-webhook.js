// One-time (per environment) setup: registers a ClickUp webhook, scoped to
// the "2026 - Ceas Comm" folder (covers all 3 lists inside it in one
// subscription), pointed at the given target URL. Writes the resulting
// webhook secret straight into server/.env — never printed to the console,
// since it's a credential used to verify incoming webhook signatures.
//
// Usage: node scripts/clickup/register-webhook.js <targetUrl>
//   e.g. node scripts/clickup/register-webhook.js https://smee.io/XXXXXXXX

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const TEAM_ID = '36181979'; // "The Ceas Workplace" — confirmed via GET /team during discovery
const FOLDER_ID = '90090885475'; // "2026 - Ceas Comm" folder — covers 2026 Projects, Active Clients — AM, Client Offboarding list
const EVENTS = ['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskDeleted', 'taskMoved'];

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error('Usage: node scripts/clickup/register-webhook.js <targetUrl>');
  process.exit(1);
}

const apiKey = process.env.CLICKUP_API_KEY;
if (!apiKey) {
  console.error('CLICKUP_API_KEY not found in server/.env');
  process.exit(1);
}

function saveSecretToEnv(secret) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^CLICKUP_WEBHOOK_SECRET=/m.test(content)) {
    content = content.replace(/^CLICKUP_WEBHOOK_SECRET=.*$/m, `CLICKUP_WEBHOOK_SECRET=${secret}`);
  } else {
    content += `${content.endsWith('\n') ? '' : '\n'}CLICKUP_WEBHOOK_SECRET=${secret}\n`;
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
      folder_id: FOLDER_ID,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Webhook registration failed (${res.status}):`, JSON.stringify(body));
    process.exit(1);
  }

  saveSecretToEnv(body.webhook.secret);

  console.log('Webhook registered.');
  console.log('  webhook id:', body.webhook.id);
  console.log('  endpoint:', body.webhook.endpoint);
  console.log('  events:', body.webhook.events.join(', '));
  console.log('  scoped to folder_id:', FOLDER_ID);
  console.log('CLICKUP_WEBHOOK_SECRET written to server/.env (not printed here).');
}

main().catch((e) => {
  console.error('Script error:', e.message);
  process.exit(1);
});
