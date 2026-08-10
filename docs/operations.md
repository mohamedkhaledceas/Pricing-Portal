# Operations

Deploy, migrate, rollback, and secret-rotation procedures. This is the runbook — `docs/architecture.md` §18 covers the deployment *architecture*; this covers what to actually do.

---

## 1. Environments

**Staging and production**, decided explicitly in Phase 1 (not just "production" — this project wanted a place to verify the Postgres migration and new HR features against real-shaped data before they touch live employee records). Same codebase, differing `DATABASE_URL`, secrets, and `NODE_ENV` per environment. Config is loaded and validated once at startup (`config/index.js`, `docs/security.md` §10) — an environment is misconfigured if the app fails to boot, not if it boots and silently misbehaves.

---

## 2. Deploy sequence

1. CI passes (lint, unit tests, integration tests, `npm audit`) on the branch being deployed — `docs/testing.md` §4.
2. Run migrations against the target environment's database: `npm run migrate`.
3. Start (or restart) the app: `npm start`.
4. Confirm `GET /health` and `GET /ready` both return healthy before considering the deploy complete.

Migrations are a **separate, explicit step before app start** — never run automatically on boot. This avoids a race if the app is ever restarted with more than one instance starting concurrently (each instance racing to run migrations against the same database).

---

## 3. Rollback

- **Code rollback**: redeploy the previous known-good commit/build. Since frontend and backend are one deployable (`docs/architecture.md` §18), this always rolls back both together — there's no scenario where only the API or only a frontend needs rolling back independently.
- **Migration rollback**: Knex migrations are written with both `up` and `down`. Rolling back a migration (`npx knex migrate:down`) is only safe if no data written under the new schema would be lost or become invalid — for purely additive migrations (new table, new nullable column) this is low-risk; for anything else, the migration's `down` function and the specific data implications should be reasoned about explicitly before running it in production, not assumed safe by default.
- **The general preference**: forward-fix over rollback where possible. A rollback that reintroduces an already-fixed bug (e.g. reverting past a security fix) can be worse than fixing forward. Rollback is the right call for "this deploy broke something and we need current behavior back immediately," not a default response to any issue.

---

## 4. Secret rotation

Secrets live only in the hosting platform's environment variable configuration (not in any file in the repo, `.env.example` notwithstanding — that file has placeholders only). To rotate:

- `JWT_ACCESS_SECRET` / refresh-token hashing: rotating invalidates all current access tokens (users re-authenticate within 15 minutes, non-disruptive) and — if the refresh-token hashing scheme itself changes — invalidates all refresh tokens (users need to fully re-login). Plan refresh-token-affecting rotations as a communicated event, not a silent one.
- `CLICKUP_API_KEY`: rotate in ClickUp's admin panel, update the environment variable, restart the app. No code change needed since it's only ever read via `config/`.
- `DATABASE_URL` credentials: coordinate with a maintenance window if the database itself requires a credential change (not just an app-side update) — standard for a managed Postgres instance.
- `GOOGLE_CLIENT_ID`: only needs rotation if the Google Cloud project itself changes; not a routine rotation candidate.

**Why this is fast to do safely**: because `config/index.js` is the only file that reads `process.env` (`docs/security.md` §10), rotating any secret is "change the environment variable, restart" — never a multi-file code change to track down every place a secret might be read.

---

## 5. Roster sync job — operational notes

Runs in-process via `node-cron` on a schedule (every 15-30 minutes). Logs to `roster_sync_log` (`docs/database.md`) every run — check this table first when diagnosing "why didn't a new hire's account work" or "why does an offboarded employee still have access" issues; it records `added_count`, `deactivated_count`, and any `error` per run.

**Known single-instance caveat** (documented in `docs/architecture.md` §18, restated here since it's operationally relevant): if this app ever runs as more than one instance, an in-process cron job fires once per instance — duplicate sync runs. Not a problem at today's single-instance deployment. If horizontal scaling is ever introduced, this job needs to move to an external scheduler or gain a leader-election guard before scaling — flagged here so it isn't discovered the hard way during a future scaling change.

---

## 6. Health checks in practice

- `GET /health` — used by the hosting platform to decide whether to restart a hung process. Should respond in milliseconds; if it doesn't, something is badly wrong (event loop blocked).
- `GET /ready` — checks the DB pool with a trivial query. A `/ready` failure with a healthy `/health` typically means a database connectivity issue, not an application bug — check `DATABASE_URL` and the database's own status first.

---

## 7. Graceful shutdown — operational effect

On a deploy/restart (`SIGTERM`), the app drains in-flight requests (bounded by a timeout) before exiting — a deploy should not visibly error out requests that were already in progress. If shutdown is taking noticeably longer than the drain timeout, that's a sign something (a long-running query, a stuck cron run) is blocking it — worth investigating rather than just increasing the timeout.

---

## 8. What's not automated yet

- Database backups/point-in-time-recovery configuration for the **future modular-monolith/Postgres architecture** — depends on the specific managed Postgres provider chosen at implementation time; not an architecture decision, but must be configured before production data is real, not as an afterthought. (This is a separate question from the interim SQLite backup pipeline already running against the current pre-migration app — see §9.)
- Alerting on `/ready` failures or elevated error rates — no external monitoring/APM is wired in yet (`docs/architecture.md` §15, structured logs only for now). If this becomes a gap in practice, that's the trigger to revisit the "logs only, no APM" decision from Phase 1.

---

## 9. Current legacy-app database backups (interim, pre-migration)

**Scope note:** this section documents the backup pipeline actually running today, against the legacy pre-migration app deployed on Render (SQLite, `server/src/index.js`-era code, `render.yaml` Blueprint). It is not the backup story for the future modular-monolith/Postgres architecture referenced in §8 — that's a separate, still-open decision. This pipeline is interim hardening of the existing app ahead of/during the migration, not migration-plan progress.

**Pipeline:**
1. `server/src/backup.js` takes an online, WAL-safe snapshot of `app.db` via `better-sqlite3`'s backup API — a raw file copy is unsafe under WAL mode (risk of a torn/inconsistent read mid-write). Afterward it forces the snapshot to `journal_mode = DELETE`, so the archived file is a single self-contained artifact rather than one requiring `-shm`/`-wal` sidecar files to stay consistent.
2. `server/scripts/backup/run-backup.sh` is the orchestrator, triggered by a local `launchd` job on the operator's Mac — deliberately not a paid Render Cron Job, and not GitHub Actions (data should never transit through GitHub):
   - SSHes to Render (dedicated keypair at `~/.ssh/render_pricing_portal`) and runs `backup.js`, writing the snapshot to `/tmp` on the Render instance — never the persistent disk, so backups don't consume the paid 1GB disk quota.
   - `scp`s the snapshot down to `~/ceas-backups/pricing-portal/` on the operator's Mac (kept outside this repo entirely, not just gitignored — real salary/HR data shouldn't sit in a git-tracked directory).
   - Deletes the remote `/tmp` copy.
   - Verifies integrity locally (`PRAGMA integrity_check` must return `ok`) before the run counts as a success.
   - Prunes local backups older than 14 days.
   - Logs every run (success/failure, file size, integrity result) to `~/ceas-backups/pricing-portal/backup.log`; a failure additionally fires a macOS desktop notification, since no external monitoring/APM exists (§8) to otherwise surface a silently-failing cron job.
3. Installed launchd job: `~/Library/LaunchAgents/com.ceas.pricingportal.dbbackup.plist` (template committed at `server/scripts/backup/com.ceas.pricingportal.dbbackup.plist`). The operator's Mac is a laptop that sleeps overnight, so this isn't a fixed-time `StartCalendarInterval` (which would get skipped most nights) — instead `StartInterval` polls every 2 hours and `RunAtLoad` checks on every login, while `run-backup.sh` itself skips the actual SSH/backup work unless it's been more than 20 hours since the last successful run. Net effect: one backup a day, taken whenever the Mac happens to be awake, without forcing a scheduled system wake (`pmset`) — which was deliberately avoided given the downsides for a laptop that's regularly closed (heat in a bag, battery drain, unreliable scheduled-wake support while closed on Apple Silicon).

**Reinstall / uninstall** (e.g. after reimaging the operator's Mac):
```
# install
cp server/scripts/backup/com.ceas.pricingportal.dbbackup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ceas.pricingportal.dbbackup.plist

# uninstall
launchctl unload ~/Library/LaunchAgents/com.ceas.pricingportal.dbbackup.plist
rm ~/Library/LaunchAgents/com.ceas.pricingportal.dbbackup.plist
```

**Cost:** none beyond the existing starter-plan Render service — SSH access is already included, no new Render service/disk/add-on is created, and the daily transfer is the size of `app.db` (currently ~124KB).
