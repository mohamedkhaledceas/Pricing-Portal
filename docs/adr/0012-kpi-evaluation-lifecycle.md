# ADR-0012: KPI Evaluation Lifecycle — Manual Pillar B, Self-Evaluation Excluded, Module-Scoped Notifications

## Status
Accepted

## Problem
The KPI module's scoring engine (`kpiScoringService`, the `kpi_definitions`/`kpi_scores`/`kpi_pillar_a_reviews` tables) was added in `63bf7dd` and faithfully transcribes `KPI_Framework.xlsx`, but it was built without an ADR or a `docs/migration-plan.md` milestone — a gap in this project's usual architecture-review-first process. Making the module "fully functional" (a KPI overview with status, per-metric comments, cross-quarter history/export, self-evaluation, required-actions, in-app feedback notifications, and a team summary) required deciding several things the spreadsheet itself doesn't answer, and closing that process gap.

## Decision

**Pillar B stays manual-entry.** `KPI_Framework.xlsx`'s own "Data Hygiene Blockers" section lists exactly what the live ClickUp workspace needs before `auto`/`semi` metrics could be pulled automatically: enforced due dates on every task (~70% currently missing), a "Feedback Reason" custom field, standardized status flows, and a Time in Status ClickApp. A live workspace survey (`clickupClient.getWorkspaceSurvey()`) during this work confirmed none of these are in place, and several of the spreadsheet's named lists ("Social Media Retainer", "Hiring Request Form") don't exist under those names in the workspace at all. Building a sync job against data that isn't shaped the way the framework assumes would produce numbers nobody could trust. Pillar B (and the `semi`/`odoo`-sourced P&C metrics) stay P&C/manager-entered through the existing `manual-entry` endpoint, now with an optional `comment` per entry.

**Trigger for revisiting ClickUp/Odoo automation:** all of the following, verified against the live workspace (not just documented as a goal):
1. Due dates enforced on all tracked tasks (the framework's own D4 "On-time completion rate" metric is unusable without this).
2. Time in Status ClickApp enabled and a "Feedback Reason" custom field created on the relevant lists.
3. Task/status naming standardized to match what each role's sheet in `KPI_Framework.xlsx` describes.
4. A named owner for the quarterly data pull (the spreadsheet's own Blocker 5) — automation without one still has nobody accountable when a pull silently fails.

**Self-evaluation is new and excluded from the scored total.** `KPI_Framework.xlsx` has no self-evaluation component anywhere — Pillar A is anonymous peer+manager review only. `kpi_self_evaluations` mirrors Pillar A's 6 dimensions so the frontend can show them side by side, but `computeBreakdown`'s `final.total` never reads from it. This keeps the framework's actual scored methodology exactly as transcribed while still giving the employee a place to record their own view.

**Notifications are in-app only, scoped to this module.** No email/SMTP integration exists anywhere in this codebase. `employee_kpi_notifications` is a new table owned by the employees module, not a repo-wide notification framework — nothing else in the app needs one yet, and building a general mechanism for a single caller isn't earned (same reasoning as the deferred domain-event system, ADR-0008). It's populated by exactly two triggers: a P&C Pillar A review entry, and a Pillar B metric entry that carries a comment (a bare numeric re-entry isn't notification-worthy; the comment is the actual signal).

**KPI status uses the spreadsheet's own 5 score bands as-is** (90–100 Exceptional · 80–89 Strong · 70–79 On Track · 60–69 Needs Improvement · <60 At Risk, "performance conversation required") — `computeStatusBand(score)` in `kpiScoringService.js`. This is the one status shown everywhere (individual overview, team summary, history) rather than a separately invented, coarser taxonomy — reusing the framework's own thresholds instead of picking new ones.

## Alternatives considered
- **Build the ClickUp sync now, against best-effort field/list guesses** — rejected. The spreadsheet explicitly calls these prerequisites "CRITICAL" and "must fix before any automation is reliable"; shipping a sync that silently produces wrong numbers is worse than requiring a manual entry that's visibly a manual entry.
- **Fold self-evaluation into Pillar A's scored total** — rejected. Would silently change the framework's actual methodology (peer+manager only) without anyone at CEAS having decided that; keeping it comparison-only requires no change to the one calculation path (`computeBreakdown`).
- **General cross-module notification system in `common/`** — rejected per this module's own now-precedent: build the concrete thing one caller needs, generalize only when a second caller shows up (see `docs/engineering-principles.md`).

## Trade-offs
- Pillar B data entry stays a quarterly manual chore for P&C/managers until the ClickUp prerequisites are met — accepted, since the alternative is scores nobody can trust.
- `employee_kpi_notifications` will need to become a shared mechanism (or get consolidated with a future general one) if another module ever needs in-app notifications — until then, a second table specific to this module is simpler than a speculative shared one.
- `heads` and `design` remain valid `kpi_profile` values with no Pillar B framework defined anywhere in the source spreadsheet — out of scope here; nothing to transcribe until P&C defines one.

## Consequences — explicit revisit trigger
Reconsider the manual-entry decision once all four ClickUp prerequisites above are verified true in the live workspace. Reconsider the notification scoping if a second module (e.g. time-off, roster) needs in-app notifications — at that point, generalize `employee_kpi_notifications` into a shared table rather than adding a third one-off.

## Addendum (2026-09-07): live workspace probe results
A follow-up request asked whether Pillar B could be computed from ClickUp directly, the way `commercial-leads`' `bucketService`/`clickupSyncService` does. Live probing (real tasks, real assignees, via `clickupClient`) found a more specific picture than the structural survey above:

- **`GET /task/{id}/time_in_status` works retroactively, right now, with no webhook needed** — this corrects the assumption that ClickUp automation would need forward-only webhook capture the way `commercial-leads`' `bucket_events` does. It returns *cumulative time per distinct status* for a task's whole history. That subset (e.g. AM's "Client submission turnaround" — average time in a status) is genuinely automatable without new workspace setup.
- It does **not** return a chronological list of every individual transition, so it cannot directly answer "how many times did this task re-enter status X" (the framework's Q1/Q3 "revision round count" metrics). That still needs either a webhook-captured event log (the `commercial-leads` pattern, forward-only from whenever it's turned on) or a different ClickUp endpoint (task activity/comment history — not yet checked).
- The real status names in use (`in queue`, `internal approval`, `client approval`, `working on feedback`, `in progress`, `complete`) **do not match** the framework's assumed flow (`Client Feedback`, `QC Feedback`, `QC Approval`, etc.) for at least one real Content Creator's tasks — the metric formulas can't attach to real data until this is reconciled, independent of any code.
- A "Feedback type" custom field already exists with a `Quality issue` option — closer to the framework's assumed "Feedback Reason" field than the structural survey suggested — but its fill-rate wasn't sampled, and it's not a required field.
- Due-date coverage for one real employee was 66% (better than the spreadsheet's stated ~30%, still not reliable enough for the D4 on-time metric).

Net: automation is more tractable than the original survey suggested for time-in-status-average metrics specifically, but revision-count metrics and the workspace's status-naming mismatch remain real blockers independent of this codebase. Manual entry stays the decision for this pass; a scoped follow-up (starting with the automatable subset) is a reasonable next initiative, not a redo of this one.

## Addendum 2 (2026-09-07): automation infrastructure built

Following the addendum above, a full follow-on build implemented: a per-employee ClickUp target override (`kpi_employee_targets`, for Production's D1/D4); a forward-only, webhook-captured status-transition counter (`kpi_clickup_status_events`, via a new team-wide `CLICKUP_KPI_WEBHOOK_SECRET` webhook — separate from commercial-leads' folder-scoped one, since KPI-relevant lists span multiple spaces); a data-driven mapping table (`kpi_auto_metric_mappings`) and a local list/status cache (`kpi_clickup_lists`) so no list ID, status name, or tag is ever hardcoded in code; reusable computation primitives (`kpiClickupMetricsService`) and a `computeAutoScores(quarter)` job that writes `source: 'auto'` rows into the existing `kpi_scores` table; and an admin UI to configure mappings without a deploy.

Also built: the hosted "everyone reviews everyone" Pillar A peer review (`kpi_peer_review_responses`, access-controlled anonymity — reviewer identity is stored to prevent duplicate submissions and support editing, but never exposed through any read path; a "didn't work with them" option excludes that response from the aggregate entirely) and a per-quarter configurable review window (`kpi_review_windows`).

All of the above was verified end-to-end against real ClickUp data during implementation (real due-date/status-history queries against real tasks, real webhook payload processing including multi-assignee tasks and redelivery dedup) and via the actual browser UI, not just unit-level checks. Two real bugs were found and fixed in the process: `kpiDefinitionRepository.seedMany` used `INSERT OR IGNORE`, so a framework correction (like the D1/D4 formula change this same work made) would have silently never applied to an already-seeded quarter — changed to `ON CONFLICT DO UPDATE`; and an early version of the peer-review/self-eval audit calls passed the wrong id space (`employee.id` instead of the auth `user.id`) into `audit.record`, which would have silently misattributed audit entries to whichever unrelated account happened to share that numeric id.

Per this session's finding: **no real employee currently has both a `kpi_profile` assigned and a `clickup_user_id` linked** — the automation infrastructure is real and tested (using a temporarily-linked real ClickUp account for verification), but produces no live output until real people are onboarded into the roster with both fields set, and `kpi_auto_metric_mappings` is populated with each role's actual list/status shapes (a `Performance Content` list was found to already match the framework's assumed status flow closely; several sibling lists in the same space use an entirely different vocabulary — confirming this must be done per-list, not assumed uniform).
