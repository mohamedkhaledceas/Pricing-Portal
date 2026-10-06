/* Dry run of the ClickUp client sync: prints what the next sync would do
   to this database's clients (create / attach / rename / deactivate /
   mark as lead), and the imported rows that only loosely resemble a
   ClickUp name, for a person to review. Writes nothing.

   Usage: node scripts/clients/clickup-client-sync-report.js [--names]
   (--names lists every name; default prints counts and the review list). */
require('dotenv').config();
const { clickupClientSyncService } = require('../../src/modules/management/clients/container');

const showNames = process.argv.includes('--names');

(async () => {
  const { options, clients, plan } = await clickupClientSyncService.preview();
  console.log(`ClickUp "Client Name" options: ${options}   portal clients now: ${clients}\n`);
  const section = (title, items, fmt) => {
    console.log(`${title}: ${items.length}`);
    if (showNames) items.forEach((i) => console.log('   ' + fmt(i)));
  };
  section('New clients to create', plan.create, (c) => `${c.name}${c.isInternal ? '  (internal)' : ''}`);
  section('Imported rows that become their ClickUp client (exact name)', plan.attach, (a) => `#${a.id} ${a.name}`);
  section('Clients renamed / re-flagged / reactivated', plan.update, (u) => `#${u.id} ${u.from} -> ${u.name}`);
  section('Clients no longer in ClickUp -> inactive', plan.deactivate, (d) => `#${d.id} ${d.name}`);
  section('Imported rows with no ClickUp name -> lead (hidden, kept)', plan.leads, (l) => `#${l.id} ${l.name}`);
  console.log(`\nFOR REVIEW — imported rows that look like a ClickUp name but don't match exactly (${plan.looseCandidates.length}):`);
  plan.looseCandidates.forEach((c) => console.log(`   #${c.id} "${c.name}"  ~  ClickUp "${c.clickupName}"`));
  process.exit(0);
})().catch((error) => {
  console.error('Report failed:', error.message);
  process.exit(1);
});
