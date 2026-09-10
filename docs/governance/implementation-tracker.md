# CEAS Portal — Implementation Tracker

**This is a living document.** It is the permanent, cumulative record of what has been built against the two source requirement documents, what has not, what was tested, and what changed over time. Every future audit session must **update this file in place** — append new Progress History / Change History / Decision Log / Regression rows, correct table statuses, and preserve everything below. Never regenerate this file from scratch and never silently delete a historical entry.

**Source documents (primary source of truth for requirements):**
- `CEAS_Portal_Governance_Workflow.pdf` — operational/process governance: launch timeline, ownership, RACI, access matrix, SOPs, training plan, go/no-go checklist, adoption scorecard, governance calendar. Referenced below as **"Governance doc"**, §N.
- `Employee_Portal_Sections_Requirements.pages` — the 22-section functional/data spec for the employee-facing portal. Referenced below as **"Portal doc"**, §N. (✅ marks in the original doc indicate bullets the doc's author believed were already done as of 2–4 Sep 2026 — each is independently re-verified below, not taken on faith.)

**Codebase audited:** `PricingPortal` repo, branch `feature/add-learn-with-marie-job-title` (1 commit ahead of `main`, HEAD `31688a2`), real app at `server/src/` (Express + better-sqlite3 — **not** the Postgres/Knex target described in some `docs/` files; see `docs/migration-plan.md`'s own 2026-09-08 reconciliation).

**Audit methodology:** Full read of both requirement documents; structural read of every module (`server/src/modules/{auth,employees,management}`), every migration (`server/src/db/migrations/001`–`021`), routes, services, repositories, and role/permission logic; live verification against the running local dev server (`http://localhost:3001`, real working SQLite DB `server/data/app.db`) via authenticated `curl` (admin session, GET-only, no mutations made to shared data); `git log` inspection for feature timelines; `npm audit` and test-infrastructure checks. No UI was exercised in a real browser in this pass (see Testing Status — this is a stated limitation, not a hidden one).

---

## 0. Audit History

| Audit date | Auditor/session | Scope | Tracker version |
|---|---|---|---|
| 2026-09-10 | Single coordinating Claude Code session, using five parallel research agents (each independently reading both source documents and a distinct slice of the codebase: profile/org/documents/policies; leave/time-off/team-availability; KPI/performance/required-actions; missing-modules sweep (training/notifications/announcements/requests/dashboard); governance/access/audit/testing/git-history) | Full bullet-by-bullet audit of both requirement documents against the live codebase | v1 (initial) |
| 2026-09-10 (same session) | Two of the five agents (the missing-modules-sweep agent and the leave/time-off agent) each independently spawned their own further sub-agents to cross-check the other agents' areas, and both wrote directly to this file rather than only to their assigned scratch files — an unplanned but useful convergence: their findings agreed on every material fact checked in common (the working-hours/schedule regression, `manager`=CEO role-mapping, the Team-KPI-Summary RBAC bug, absence of Documents/Policies/Training/Announcements/general-Notifications, the dead `finance` role, zero test infrastructure, and an identical `npm audit` result) | Coordinating session then independently re-verified the highest-stakes claims directly (re-ran `npm audit`, re-read `computeTeamSummary`, re-grepped `process.env` usage) before treating this file as final | v1.1 (cross-verified) |

**Reconciliation note (v1.1):** No factual correction to the tracker's tables was needed from the cross-check. One number was corrected on direct re-verification: the `process.env`-outside-`config/index.js` count (§7 below) was originally reported as 10 files/four ClickUp-related files; a direct repo grep found 11 files (five ClickUp-related), now corrected. The two agents also differed on a presentation choice, not a fact: one scored overall progress as an *unweighted* average across all 22 sections (≈60%); the other independently computed a *bullet-count-weighted* average (≈53%) as a cross-check — both are defensible, see §2 addendum below.

---

## 1. Executive Summary

The CEAS Portal is a working, actively-developed Express/better-sqlite3 application (not a prototype) with real users, a real local dev DB, and a real deployed instance. Its strongest area is **KPI/Performance** (Portal doc §8–11): a genuinely sophisticated, end-to-end, live-verified scoring engine with quarterly cycles, self-evaluation, anonymized peer review, ClickUp-automated metrics, CSV export, and full audit logging — arguably more advanced than the requirement doc's own description. **Leave/Time-Off** (§4–7) is similarly mature as a *request workflow* (two-stage manager → People & Culture approval, ClickUp sync, conflict-pair overlap warnings, real presence tracking for "who's online"), but is missing the specific **Leave Balance** concept the doc asks for in §3 — there is no entitlement/accrual/remaining-days ledger anywhere in the system, only a count of requests by type and outcome. **Employee Profile** (§1) and the self-service profile-edit approval workflow are strong; **Reporting & Organization** (§2) has the data (a real manager FK) but no org-chart visualization. Three entire requirement-doc sections are **not started at all**: **Employee Documents** (§16), **Policies** (§17, including the governance doc's *mandatory* policy-acknowledgment SOP), and **Training & Onboarding** (§13) — confirmed by zero relevant commits in git history. **Announcements** (§15) and general-purpose **Notifications** (§14) are also absent outside the KPI domain. **Personal & Contact Information** (§18) is missing phone, emergency contact, and profile-completion-percentage entirely.

One architectural fact worth flagging to stakeholders directly: the KPI engine's real data source is **ClickUp, not manual portal entry**, for most Pillar B metrics — `kpi_definitions`/`kpi_scores` carry a `source`/`source_type` of `'auto'`, computed by a dedicated sync subsystem (`kpiClickupSyncService.js`, `kpiClickupMetricsService.js`, migrations `016`–`018`). The requirement doc frames "KPI Details" as if a manager or Department Head enters these numbers directly (manual entry, `enterManualScore`, exists only as a fallback/override path). This has a real data-accuracy-ownership implication: Governance §7 names "Department Head" as the KPI Data Updater, but for auto-sourced metrics the actual "updater" is whichever ClickUp task-status change triggers the sync — worth reconciling explicitly rather than assuming the doc's ownership model applies uniformly.

On the **Governance doc** side, most of the document is organizational process (meetings, SOPs, training sessions) that has no code surface by design and is correctly out of an implementation audit's scope — but several governance requirements *do* imply system support and are gaps: there is no in-portal audit-log viewer (the data is captured but not reviewable through the UI), no access-list export for the mandatory quarterly audit, no approval-gated account-provisioning workflow (registration is fully self-service, not the doc's HR-request → Ops-approval → Admin-provision chain), and the doc's 7-role model (Employee/Manager/HR/Operations/Commercial/CEO/Admin) does not map cleanly onto the code's 6 auth roles — most notably, the code's `manager` role **is** the CEO's account, "Commercial" and true line-management are not distinct roles at all (see §9 below), and a `finance` role exists in the code with zero permission gates anywhere (dead role).

The entire modular-monolith architecture (`modules/auth`, `modules/employees`, `modules/management`) is **roughly 3 weeks old** as of this audit — the foundation commit is dated 2026-08-18, and the KPI/ClickUp-automation module specifically is under 3 weeks old (`14a1baf`). This is a fast-moving, recently-restructured codebase, which contextualizes both its genuine strengths (KPI/leave engines are recent, well-thought-through work, not legacy cruft) and its gaps (Documents/Policies/Training/Announcements simply haven't been reached yet on a young build timeline, not abandoned).

The codebase has **zero automated tests** of any kind (confirmed: `npm test` fails with "Missing script", no Jest/Mocha/Supertest installed, no CI workflow exists) — every "Implemented" status in this tracker is backed by direct code reading plus manual, read-only live verification against the real dev server, never an automated test run. `npm audit` currently reports **3 moderate-severity vulnerabilities** (transitive `qs` package via `express`/`body-parser`) — this is new information as of this audit, not previously tracked.

## 2. Overall Progress

### Methodology

Progress is scored **per requirement-doc bullet**, not per section, to avoid one large multi-bullet section (e.g. KPI, at ~22 bullets) silently outweighing a small but business-critical one (e.g. Leave Balance, at 7 bullets) or vice versa. Each bullet in Portal doc §1–§22 gets a score: **Implemented = 1.0**, **Partially Implemented = 0.5**, **Not Started = 0.0**, **Unable to Verify = 0.5** (treated as a working assumption, not a claim — flagged wherever it materially affects a section's score), **Not Applicable = excluded** from the denominator. Governance-doc requirements are **not pooled into this percentage** — the Governance doc is overwhelmingly organizational process (SOPs, meetings, training cadence) outside the scope of a code implementation percentage; its code-relevant items are scored separately and discussed narratively in §9.

This produces two numbers: an **unweighted bullet-level average across all 22 Portal-doc sections**, and a **module-weighted view** (grouping sections into the areas a developer would actually work in) so a reader can see where effort is concentrated vs. thin.

### Portal-doc bullet-level score: **≈ 60%**

| # | Section | Bullets scored | Score | Notes |
|---|---|---|---|---|
| 1 | Employee Profile | 9 | 89% | One regression (working hours/schedule, dropped 2026-09-06) |
| 2 | Reporting & Organization | 4 | 50% | Manager FK real; no org chart |
| 3 | Leave Balance | 7 | 43% | No entitlement/accrual ledger exists |
| 4 | Time Off Requests | 7 | 93% | Mature two-stage workflow |
| 5 | My Leave Calendar | 3 | 83% | List-based, not a calendar widget |
| 6 | Team Availability | 7 | 50% | "Who's online" is real; aggregate counts aren't |
| 7 | Upcoming Team Leave | 2 | 50% | Raw list only, no calendar UI confirmed |
| 8 | KPI Overview | 4 | 100% | |
| 9 | KPI Details | 5 | 100% | |
| 10 | Performance History | 4 | 88% | No trend chart |
| 11 | Employee Evaluation | 4 | 75% | "Manager evaluation" is architecturally anonymous peer review |
| 12 | Required Actions | 6 | 25% | KPI-siloed; 3 of 6 items have zero backing (docs/policies don't exist) |
| 13 | Training & Onboarding | 3 | 0%* | Zero relevant commits in git history |
| 14 | Notifications | 5 | 40%* | KPI-domain only |
| 15 | Announcements & Company Updates | 4 | 0% | Confirmed absent |
| 16 | Employee Documents | 5 | 0% | Confirmed absent |
| 17 | Policies | 4 | 13% | Leave *rules* exist; no policy *documents*/acknowledgment |
| 18 | Personal & Contact Information | 7 | 36% | No phone/emergency contact/completion % |
| 19 | My Team | 6 | 92%* | Strong — names/roles/dept/reports/expand-card |
| 20 | Team Performance | 3 | 67%* | **RBAC bug: real line managers can't see their own team's KPI summary — see §7/§11** |
| 21 | Requests Center | 7 | 15%* | No unified cross-domain request inbox |
| 22 | Dashboard & System Experience | 16 | 55%* | Zero `@media` queries anywhere — not mobile-responsive |

*Rows marked with an asterisk (§13, §14, §19, §20, §21, §22) were scored primarily from a dedicated background verification pass (grep + route inspection + targeted file reads) run in parallel with this audit; treat their exact percentages as directionally solid but slightly less exhaustively cross-checked line-by-line than §1–§12, which were read in full.

**Unweighted average across all 22 sections: ≈ 60%.**

*(v1.1 cross-check: an independent second pass computed a **bullet-count-weighted** average instead — i.e. each individual bullet across all 22 sections counts once, rather than each section counting equally regardless of how many bullets it has — using the same section-level percentages above. That method gives each section's own bullet count as weight (e.g. §22's 16 bullets vs. §7's 2), yielding **≈ 53%**, about 7 points lower. The gap is fully explained by weighting: the weakest sections (§13–§17, 24 bullets combined, ~5–13% each) get proportionally more influence under bullet-count weighting than under equal-per-section weighting, while strong small sections like §11 (4 bullets, 75%) get proportionally less. Neither number is "more correct" — they answer slightly different questions ("how does the typical *section* look" vs. "how does the typical *individual requirement* look") — both are reported here so a reader isn't anchored on a single number without knowing its sensitivity to the weighting choice.)*

### Module-weighted view (grouping into what a developer actually touches)

| Module / Area | Rough completion | Basis |
|---|---|---|
| **Auth & Access** (login, roles, session security, self-service registration) | ~75% | Solid, secure core (memory-only access token, httpOnly scoped refresh cookie, no permissive CORS, rate-limited login); gaps are process-alignment (no approval-gated provisioning) and an in-app audit-log viewer |
| **Employee Profile & Roster** (Portal §1, §2, §18) | ~60% | Strong work-data model + audited self-service approval flow; weak on personal/contact data, no org chart |
| **Leave / Time Off** (Portal §3–§7) | ~65% | Mature request/approval engine; the specific "balance" concept the doc names is entirely missing |
| **KPI / Performance** (Portal §8–§12) | ~80% | The most complete area of the whole portal; Required Actions is the one narrow gap |
| **Documents, Policies, Training, Announcements, general Notifications** (Portal §13–§17) | **~5%** | Effectively unbuilt — this is the single largest concentration of missing work |
| **My Team / Team Performance / Requests Center / Dashboard UX** (Portal §19–§22) | ~50% | Core data exists and is reused well; no unified requests inbox, no mobile responsiveness |
| **Governance/RBAC system support** (Governance §9, §12, §15, §21) | ~40% | Audit trail is real but not reviewable in-app; no access-list export; role model doesn't match the doc's 7 roles |
| **Testing & CI** | **0%** | Zero automated tests, no CI pipeline, of any kind |
| **Out-of-scope-but-real functionality**: Margin Planner (`/planner`), Commercial Leads dashboard (`/commercial-lead`), CEO Dashboard (`/ceo`) | N/A to this audit | Real, substantial, live features not described in either requirement document — see §7 |

---

## 3. Implementation Tracker

Full bullet-by-bullet tables, grouped by Portal-doc section. Evidence is cited as `file:line` where a specific line is meaningful, or a file/route path otherwise. "Live-verified" means an authenticated read-only `curl` call was made against the real running dev server during this audit.

**Last Verified: 2026-09-10** for every row below (this is the tracker's initial audit — no row has been individually re-verified at a later date yet). When a future update revisits a specific row, update that row's evidence/status and note the new date in prose next to the change (e.g. in §16 Change History); this table does not carry a per-row date column by default to keep it readable, but nothing stops a future update from adding one if the tracker starts being revisited piecemeal rather than in full passes.

**Stakeholders per section** (condensed from Governance doc §7's Ownership Matrix — Business Owner / Approver, plus the primary end-user(s) named in the Portal doc itself; not repeated per-row below to keep the tables scannable):

| Portal § | Section | Primary user(s) | Business Owner (Governance §7) | Approver (Governance §7) |
|---|---|---|---|---|
| 1 | Employee Profile | Employee | HR | HR |
| 2 | Reporting & Organization | Employee, HR | HR | Operations Manager |
| 3 | Leave Balance | Employee, HR | HR | HR |
| 4 | Time Off Requests | Employee, Manager | Employee | Manager |
| 5 | My Leave Calendar | Employee | Employee | — |
| 6 | Team Availability | Manager, Employee | Manager | — |
| 7 | Upcoming Team Leave | Manager | Manager | — |
| 8–9 | KPI Overview / Details | Employee, Dept Head | Department Head | Department Head |
| 10 | Performance History | Employee, HR | HR | HR |
| 11 | Employee Evaluation | Employee, Manager | Manager | HR |
| 12 | Required Actions | Employee, HR/Manager | HR / Manager (task creator) | HR |
| 13 | Training & Onboarding | Employee, HR | HR | Operations Manager |
| 14 | Notifications | All roles | Portal Admin | Operations Manager |
| 15 | Announcements & Company Updates | All roles | Operations Manager | CEO |
| 16 | Employee Documents | Employee, HR | HR | HR |
| 17 | Policies | Employee, HR, CEO | HR | CEO |
| 18 | Personal & Contact Info | Employee | Employee | HR (verification) |
| 19 | My Team | Manager | Manager | HR |
| 20 | Team Performance | Manager, Dept Head | Manager | Department Head |
| 21 | Requests Center | Employee, Operations | Operations | Relevant department |
| 22 | Dashboard & System Experience | All roles | Portal Admin | Operations Manager |

(Remember: "Manager" in the Governance doc's Ownership Matrix is ambiguous between "the CEO's account" and "a real line manager" per the role-mapping finding in §17 — read this table with that caveat in mind, not as a literal code-role assignment.)

### Portal §1 — Employee Profile

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Full name | Implemented | End-to-end | `employee.model.js:15-16` (joins `users.first_name/last_name`) | Manually Verified (live `/api/employees/me`) | — |
| Profile photo | Implemented | End-to-end | `middleware/photoUpload.js:1-104` (multer, magic-byte signature check, 2MB cap, UUID filenames); `rosterService.js:294-310` | Manually Verified (code + live route reachability) | Malware scanning is an explicit no-op stub (`photoUpload.js:100-102`, `TODO(security)`) |
| Job title | Implemented | End-to-end | `constants.js` (`JOB_TITLES`, 27 fixed values incl. "Learn with Marie" added `31688a2`); `rosterService.js:79-96` | Manually Verified | — |
| Department | Implemented | End-to-end | Real `departments` table + FK (ADR-0011), migrations `010`/`011`; `departmentService.js` | Manually Verified (live `/employees/departments`) | — |
| Employment type (Full-time/Part-time/Freelancer) | Implemented | End-to-end | `employees.employment_type` CHECK constraint, migration `007` | Manually Verified | — |
| Joining date | Implemented | End-to-end | `employees.joining_date`, migration `007` | Manually Verified | — |
| Work location | Implemented | End-to-end | `WORK_LOCATIONS` fixed list, `constants.js`; relabeled Cairo/Alex, hybrid dropped (`e09ff93`, 2026-09-06) | Manually Verified | — |
| **Working hours / schedule** | **Not Started (regressed)** | Removed | Added in migrations `007`/`008`, then **dropped** by migration `021_drop_working_hours_and_work_schedule.js` ("removed as a product decision; there's no replacement") | Not Tested (feature removed) | Doc marks this ✅ (authored ~2 Sep); code dropped it ~6 Sep. **See Regression Tracking §12.** |
| Employee status (Active/On Leave/Remote) | Implemented | End-to-end | `active`/`remote` stored; `on_leave` computed live from approved leave overlapping today — never stored, can't drift (`rosterService.js:124-144`) | Manually Verified | — |

### Portal §2 — Reporting & Organization

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Direct manager name | Implemented | End-to-end | `employees.manager_employee_id` self-FK (migration `002`); `rosterService.js:159-170` resolves `managerName`/`managerEmail` | Manually Verified (live `/api/employees/directory`) | — |
| Direct manager job title | Partially Implemented | Backend only | Manager's full record (incl. `jobTitle`) is resolved server-side in `listDirectory` but only `managerName`/`managerEmail` are surfaced — `managerJobTitle` is one line away | `rosterService.js:159-170` | Not Tested | Trivial to add, not yet done |
| Reporting line (full chain) | Partially Implemented | Backend only | Only one level up (manager name) and one level down (`getDirectReports`) are exposed; no recursive "full chain to CEO" endpoint | `rosterService.js:189-191` | Unable to Verify further | No multi-level endpoint exists |
| Organizational structure (org chart) | Not Started | — | Zero matches for "org chart" anywhere; roster is a flat, filterable table, not a hierarchy visualization | grep confirms absence | Not Tested | Would need a real tree/chart UI |

### Portal §3 — Leave Balance

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Annual leave entitlement | Not Started | — | No entitlement/allowance value stored anywhere in any of 21 migrations | migration `002` schema has no balance table | Not Tested | Core missing concept |
| Annual leave used | Partially Implemented | Backend only | `getLeaveBreakdown` tallies *requests* by type/status, not *days* | `timeOffService.js:198-216` | Manually Verified | Counts requests, not day-sums |
| Annual leave pending | Partially Implemented | Backend only | Same breakdown, `inProgress` bucket | `timeOffService.js:212` | Manually Verified | Same limitation |
| Annual leave remaining | Not Started | — | Nothing to subtract from — no entitlement exists | grep: no "remaining"/"balance" hits | Not Tested | Depends on entitlement existing |
| Sick leave balance | Partially Implemented | Backend only | `sick` is a real leave type; no cap/allowance tracked | `timeOffRules.js:59-76` | Manually Verified | No balance/cap |
| Emergency leave balance | Partially Implemented | Backend only | `emergency` is a real leave type, same-day eligible; no cap tracked | `timeOffRules.js:83` | Manually Verified | No balance/cap |
| Unpaid leave records | Implemented | Backend + partial UI | Real payroll-relevant fields: `salary_deduction`, `unpaid_days_count`, set by P&C at confirmation | migration `002:66-73`; live `/leave-requests/mine` (`salaryDeduction`, `unpaidDaysCount` present) | Manually Verified | Not surfaced as an aggregate report, only per-request |

> **Note:** A peer/background Claude session (`leave balance counters`, observed running concurrently during this audit, started ~22h prior) appears to already be working in this exact area. Reconcile with that session's output before treating §3 as untouched in a future update of this tracker.

### Portal §4 — Time Off Requests

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Quick Request Time Off button | Implemented | End-to-end | "New Request" sub-tab, `index.html:68`; `POST /employees/leave-requests` | Manually Verified | — |
| Leave request type | Implemented (richer than spec) | End-to-end | 9 types (`planned, short_notice, sick, emergency, mental_health, public_holiday, wfh, excuse, unpaid`) vs. doc's implied 4 | `timeOffService.js:3` | Manually Verified | `'planned'` = functional "annual leave" but not labeled that anywhere |
| Leave request dates | Implemented | End-to-end | `start_date`/`end_date` + `half_day`/`half_day_period` (finer than spec) | migration `002:60-63` | Manually Verified (live API) | — |
| Number of requested days | Unable to Verify | Backend only (inferred) | `timeOffRules.countWorkingDaysInclusive` exists but not confirmed persisted/returned on the request row | `timeOffRules.js:46-57` | Unable to Test | Needs a follow-up read of `submit()`'s response shape |
| Status (Pending/Approved/Rejected) | Implemented (richer workflow) | End-to-end | Real enum: `pending → manager_approved → approved`, or `rejected/auto_rejected/cancelled` — two-stage, not the doc's flat 3-state | migration `002:66` | Manually Verified (live) | Doc doesn't describe the 2-stage manager→P&C flow — see Gaps §8 |
| Approval/rejection date | Implemented | End-to-end | `manager_decision_at`, `pc_confirmed_at` | migration `002:69,71`; live API | Manually Verified | — |
| Approval/rejection comment | Implemented | End-to-end | `manager_decision_note`/`pc_decision_note`, required when rejecting | `timeOffService.js:222-224` | Manually Verified | — |

### Portal §5 — My Leave Calendar

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Recent leave requests | Implemented | End-to-end | `GET /employees/leave-requests/mine`, "My History" sub-tab | Manually Verified (live, 5 real rows returned) | — |
| Upcoming personal leave | Partially Implemented | Backend only | No dedicated "upcoming" endpoint; likely a client-side filter, not confirmed | `views/js/timeOff.js` (not read line-by-line) | Unable to Test | Confirm frontend actually filters to future dates |
| Personal leave history | Implemented | End-to-end | Same `/mine` endpoint | as above | Manually Verified | — |

*(Note: doc §5 is literally titled "Calendar" but nothing found in this pass renders an actual calendar-grid widget — it's chronological lists. Flag as a UI-fidelity gap, not re-verify without browser access.)*

### Portal §6 — Team Availability

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Who's off today | Implemented | End-to-end | `GET /employees/leave-requests/off-today?date=` | `timeOffService.js:161-171`; live-verified (200 OK, correct validation on missing `date`) | Manually Verified | — |
| Team availability today (aggregate) | Unable to Verify | — | No distinct summary endpoint found | route list has no `/team-availability` | Not Tested | Likely absent as a discrete backend concept |
| Number of team members working | Not Started | — | No aggregate count computed server-side | grep: no matching aggregation | Not Tested | — |
| Number on leave | Not Started | — | Same | — | Not Tested | Derivable from off-today list length but not a named metric |
| Number working remotely | Partially Implemented | Backend only | `availability` field exists but isn't a "remote" aggregate; no count widget | migration `009:15` | Unable to Test | — |
| Number offline | Unable to Verify | Backend only (inferred) | "Offline" = logical inverse of online, no dedicated endpoint confirmed | `employeeRepository.js:18-19` | Not Tested | — |
| **Who's online** | **Implemented** | **End-to-end, real presence** | `users.last_seen_at` touched on activity (throttled 60s); directory computes `user_online` as `last_seen_at >= now - 5min` | migration `005`; `userRepository.js:60-61`; `employeeRepository.js:18-19`; `overview.js:76-79` | Manually Verified (schema + query read directly) | Polling-based (5-min window), not Socket.IO real-time — the existing `common/realtime/` module only broadcasts ClickUp sync events, not presence |

### Portal §7 — Upcoming Team Leave

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Upcoming team leave | Partially Implemented | Backend only | `GET /employees/leave-requests/team` returns all (past+future) for reports — no server-side "upcoming" filter | `timeOffService.js` `listTeam` | Manually Verified (live, empty result expected for test account with no reports) | Filtering to "upcoming" appears to be a frontend concern, unconfirmed |
| Team leave calendar (UI) | Unable to Verify | UI only (unconfirmed) | No calendar-specific endpoint; would be a frontend rendering over the `/team` list | not exercised in a browser | Unable to Test | — |

### Portal §8 — KPI Overview

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Overall KPI score | Implemented | End-to-end | `final.total` = Pillar A (60%) + Pillar B (40%) weighted, computed live | `kpiScoringService.js:183-225`; live-verified `/kpi/1/breakdown` | Manually Verified | — |
| Current KPI evaluation period | Implemented | End-to-end | `getCurrentKpiQuarter()`, Cairo-timezone derived, with deadline/days-remaining | `kpiScoringService.js:254-272`; live `/kpi/current-quarter` → `{"quarter":"2026-Q3","deadline":{"daysRemaining":21}}` | Manually Verified | — |
| KPI achievement % | Implemented | End-to-end | Per-metric `computeMetricScore` rolls into `final.total` | `kpiScoringService.js:52-104` | Manually Verified | — |
| KPI status (On Track/Needs Attention/Off Track) | Implemented but Needs Changes | End-to-end | Real 5-tier band (Exceptional/Strong/On Track/Needs Improvement/At Risk) — a functional superset, but literal labels don't match the doc's 3-tier ask | `kpiScoringService.js:31-42`; `kpiShared.js:19-21` | Manually Verified | Naming/spec mismatch, not a functional gap |

### Portal §9 — KPI Details

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| KPI target | Implemented | End-to-end | `kpi_employee_targets` table, per-employee overrides + framework defaults | migration `015`; `kpiScoringService.js:333-369` | Manually Verified | — |
| Actual KPI result | Implemented | End-to-end | `kpi_scores.actual_value` — manual, self-eval, or ClickUp-auto sourced | migration `002`, `012` | Manually Verified | — |
| KPI weight | Implemented | Backend + UI | Baked into `kpiFrameworkSeed.data.js` per metric | `kpiScoringService.js:226-253` | Manually Verified | — |
| KPI comments/feedback | Implemented | End-to-end | `kpi_scores.comment`, settable on manual entry | migration `012`; `kpiController.js:70-84` | Manually Verified | — |
| "View Performance Details" button | Implemented | UI (structurally different) | KPI tab expands inline rather than navigating to a separate details page — functionally equivalent | `views/js/kpi.js:320-340` | Manually Verified | Doc envisions a distinct page; app expands in place |

### Portal §10 — Performance History

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Previous KPI results | Implemented | End-to-end | `computeHistory()` re-runs breakdown per quarter | `kpiScoringService.js:404-417`; live `/kpi/1/history` | Manually Verified | — |
| KPI performance history | Implemented | End-to-end | Same, rendered in `kpiHistory.js:25-73` | as above | Manually Verified | — |
| Performance trend | Partially Implemented | UI | History is a per-quarter list; no trend line, delta, or sparkline | `kpiHistory.js` (read in full) | Not Tested | No trend computation/visualization |
| Export performance history | Implemented | End-to-end | Real CSV export (`quarter,pillarAScore,pillarBScore,finalScore,statusBand`), wired to a button | `kpiScoringService.js:419-433`; `kpiController.js:60-68`; `kpiHistory.js:6-18,50` | Manually Verified (route + wiring read, not click-tested in a browser) | — |

### Portal §11 — Employee Evaluation

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Monthly/quarterly evaluation score | Implemented | End-to-end | Same quarterly breakdown system; **quarterly cadence only**, no monthly option exists | `kpiScoringService.js:39-42` | Manually Verified | Doc says "Monthly / quarterly" — only quarterly is real |
| Manager evaluation | Implemented but Needs Changes | End-to-end (different architecture) | Implemented as **anonymous peer review** aggregated into Pillar A (`kpi_pillar_a_reviews`), not a single named manager score — a deliberate design per ADR-0012 | migration `019`; `kpiPeerReviewService.js` | Manually Verified (structure); role semantics differ from the doc | Doc implies manager-attributed scoring; code is "everyone reviews everyone," anonymized |
| Employee self-evaluation | Implemented | End-to-end | `kpi_self_evaluations`, one row/employee/quarter, shown alongside but not folded into the official score | migration `013`; `kpiScoringService.js:370-403` | Manually Verified | — |
| Upcoming evaluation deadlines | Partially Implemented | Backend + UI | Only the *current* quarter's close date is surfaced — no forward multi-deadline list | `kpiScoringService.js:267-271`; `kpi.js:324,338` | Manually Verified | Single countdown, not a calendar of deadlines |

### Portal §12 — Required Actions

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Actions required from employee (general) | Partially Implemented | End-to-end (narrow scope) | `computeRequiredActions()` returns exactly 3 types, all KPI-domain: `self_evaluation`, `missing_kpi_scores`, `missing_pillar_a` | `kpiScoringService.js:435-466`; live-verified `/kpi/required-actions` | Manually Verified | KPI-siloed — see Key Finding below |
| Pending approvals/actions (cross-domain) | Not Started (for non-KPI) | — | No awareness of pending leave approvals or profile-change-requests in this aggregator | grep confirms no cross-domain aggregation | Not Tested | Would require a cross-module aggregation design |
| Pending KPI updates | Implemented | End-to-end | `missing_kpi_scores` action type | `kpiScoringService.js:448-457` | Manually Verified | — |
| Missing employee information | Not Started | — | No profile-completeness check anywhere in the required-actions computation | Confirmed via full read of `computeRequiredActions` | Not Tested | Depends on a profile-completeness concept existing (see §18) |
| Documents requiring signature | Not Started | — | No document-signing concept anywhere; Employee Documents (§16) doesn't exist | grep: no `signature`/`acknowledg` hits (excl. unrelated HMAC webhook "signature") | Not Tested | Blocked on §16 existing |
| Policies requiring acknowledgment | Not Started | — | Same — Policies (§17) doesn't exist | same grep | Not Tested | Blocked on §17 existing |

### Portal §13 — Training & Onboarding

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Required training | Not Started | — | Zero matches for "training" as a feature; `git log --all --grep="training" -i` returns zero commits | grep + git log confirm absence | Not Tested | Entire feature absent |
| Onboarding actions | Not Started | — | Zero matches; `git log --all --grep="onboarding" -i` returns zero commits | grep + git log confirm absence | Not Tested | Entire feature absent |
| Pending onboarding requirements | Not Started | — | Same | same | Not Tested | Entire feature absent |

*Cross-reference: Governance doc §18 "Onboarding Workflow" explicitly calls for a "Mandatory portal onboarding module (Day 1)" — this has zero backing in code. Governance §10's Training Plan is live/recorded-session training (not necessarily an in-portal module), so this is not automatically a contradiction — but the Portal doc's own §13 explicitly asks for in-portal training tracking, which does not exist.*

### Portal §14 — Notifications

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Notifications (general) | Partially Implemented | Backend + UI (KPI-scoped only) | `kpi_employee_notifications` table, `listNotifications`/`markNotificationRead` — no notification type outside the KPI domain | migration `014`; `kpiController.js` | Manually Verified (live `/kpi/notifications`, functional but empty) | No leave/profile/announcement notifications exist |
| Notification indicator | Partially Implemented | UI | KPI notification badge exists (`kpi.js:101` panel) — no portal-wide indicator | `views/js/kpi.js:101` | Not Tested | Scoped to KPI tab only |
| Approval notifications (leave, etc.) | Not Started | — | No notification fires on leave manager-decision/pc-confirm | grep confirms no notification write in `timeOffService.js` | Not Tested | — |
| KPI feedback notifications | Implemented | End-to-end | Covered by the KPI notification system | migration `014`, `kpiNotificationRepository.js` | Manually Verified | — |
| Policy update notifications | Not Started | — | Policies (§17) doesn't exist, so nothing to notify about | — | Not Tested | Blocked on §17 |

### Portal §15 — Announcements & Company Updates

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Company announcements | Not Started | — | Zero matches for "announcement" anywhere in code; `git log --all --grep="announcement" -i` returns zero commits | grep + git log confirm absence | Not Tested | Entire feature absent |
| Policy updates | Not Started | — | Same (depends on §17 too) | — | Not Tested | — |
| Important internal updates | Not Started | — | Same | — | Not Tested | — |
| Upcoming company events/meetings | Not Started | — | Same | — | Not Tested | — |

### Portal §16 — Employee Documents

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Employee contract | Not Started | — | Zero matches for a document-storage feature (excluding unrelated DOM `document.*` calls and one unrelated CEO-dashboard mock string) | repo-wide grep | Not Tested | Entire feature absent |
| Job description | Not Started | — | Same | — | Not Tested | — |
| NDA | Not Started | — | Zero matches for "NDA" | — | Not Tested | — |
| Employee handbook | Not Started | — | Zero matches for "handbook" | — | Not Tested | — |
| Download/view documents | Not Started | — | The only file-upload code in the repo is photo-upload (`photoUpload.js`), narrowly scoped to images; no generic document model/table/routes exist | — | Not Tested | `multer` is already a dependency and reusable, but no document schema exists |

### Portal §17 — Policies

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Company policies | Not Started | — | Zero matches for a policy-storage feature | repo-wide grep | Not Tested | Entire feature absent |
| Performance policy | Not Started | — | Same | — | Not Tested | — |
| Leave policy (as a document) | Not Started (rules ≠ document) | — | Leave *rules* (notice windows, auto-reject logic) exist and are shown under a "Leave Rules" sub-tab — but that's a computed rules engine, not a published, versioned policy document with acknowledgment | `timeOffRules.js`; `views/js/timeOff.js` "Leave Rules" sub-tab | Manually Verified (rules exist) / Not Started (as a document) | The distinction matters for the governance SOP's acknowledgment requirement |
| Policy acknowledgment | Not Started | — | No acknowledgment-tracking mechanism of any kind | grep: zero "acknowledg" hits | Not Tested | **This is a *mandatory* SOP item per Governance §12/§13 with a hard 5-business-day compliance window — zero backing implementation.** |

### Portal §18 — Personal & Contact Information

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Employee personal information | Partially Implemented | Backend only (work info only) | Only work-related fields exist; no DOB/national ID/address etc. | `employee.model.js:5-31` (full field list) | Manually Verified (schema read) | No true "personal info" fields beyond identity/work data |
| Contact information | Not Started | — | Only `users.email` (login/work email) exists | grep: no `phone`/`emergency_contact`/`personal_email`/`address` hits | Not Tested | No phone field anywhere |
| Emergency contact | Not Started | — | No fields exist in schema at all | same grep | Not Tested | HR/safety-relevant gap |
| Work email | Implemented | End-to-end | `users.email`, returned on every employee/directory response | `employee.model.js:14` | Manually Verified (live login response) | — |
| Work phone if applicable | Not Started | — | No phone field of any kind | same grep | Not Tested | — |
| Profile completion percentage | Not Started | — | No completion computation anywhere in the employees module (only unrelated KPI peer-review "completion rate" hits) | `grep -rn "completion"` — 9 matches, all KPI-unrelated | Not Tested | — |
| Ability to update allowed personal information | Implemented (for work fields; N/A for absent personal fields) | End-to-end | Real two-tier self-service model: first edit applies immediately and locks the profile; every edit after that becomes an audited change-request an admin/manager/P&C must approve | `rosterService.js:325-384`; migration `008`; `employeeProfileChangeRequestRepository.js`; routes `/profile-change-requests/:id/approve|reject` | Manually Verified (code + live route reachability) | Approver role set is `admin/manager/people_culture`, not literally "HR" — a naming/role-mapping note, not a functional gap |

### Portal §19 — My Team

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| My Team section for managers | Implemented | End-to-end | `maintab-team` nav tab; `myTeamSectionHtml()` computed from manager FK + department | `index.html:62`; `views/js/team.js:60-93` | Manually Verified | Visible to anyone with a manager or department, not gated to formal "manager" role only — broader than doc implies, not narrower |
| Team member names | Implemented | End-to-end | `myTeamCardHtml()` | `team.js:26-41` | Manually Verified | — |
| Team member roles (job title) | Implemented | End-to-end | Card shows `jobTitle` | `team.js:33` | Manually Verified | — |
| Team member departments | Implemented | End-to-end | Card shows department label | `team.js:37` | Manually Verified | — |
| Employees reporting directly to the manager | Implemented | End-to-end | `getDirectReports(managerEmployeeId)` | `rosterService.js:189-191` | Manually Verified | — |
| Quick link to team member profile | Partially Implemented | UI | Card expands inline (accordion) to show department/email/manager — not a navigable "profile page" link | `team.js:44-52` | Manually Verified | Functional but not literally a "quick link to profile" |

### Portal §20 — Team Performance

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Team KPI summary where permission allows | **Fixed and browser-verified (2026-09-10)** | End-to-end | `kpiScoringService.computeTeamSummary` now returns different shapes by caller: any employee with `is_team_head = true` gets a flat array of just their own direct reports (`employeeRepository.findByManagerId(actorEmployee.id)`, one level, matching `getDirectReports`/"My Team"'s existing scoping). `manager` (CEO)/`admin` get `{ myTeam, byDepartment }` instead of one flat company-wide list — `myTeam` is their own direct reports (same FK), `byDepartment` is every department's real, current membership (`departmentRepository.findAll()` × `employeeRepository.findAllActive()`, grouped by `employees.department`), independent of `myTeam` — an employee can appear in both (confirmed intentional with the user, not deduplicated). Everyone else still gets 403. Frontend (`kpi.js`, `kpiTeam.js`) updated to match: the "Team Performance" sub-tab was previously shown only to `isManager`/`isAdmin`, so even after the backend fix a real team head still couldn't see it — fixed by also gating on the already-computed `kpiPerms.hasReports` flag; `kpiTeam.js` rewritten to render both the flat-array shape and the `{myTeam, byDepartment}` shape. | `kpiScoringService.js` `computeTeamSummary`/`summaryRow`; `container.js` (added `departmentRepository` dependency); `kpi.js` (tab-visibility gate); `kpiTeam.js` (full rewrite) — commit `16d8341` on branch `feature/team-kpi-summary-department-view` (pushed to origin, not yet merged) | **Manually Verified end-to-end in a real browser** — created 3 throwaway test accounts (`zzz-test-*@ceastest.local`, deactivated after testing, not deleted), confirmed the team-head account (`is_team_head=true`, 2 direct reports) sees exactly those 2 reports under "Team Performance"; then temporarily promoted the same account to `manager` and confirmed it instead shows "My Team" (the same 2 reports) followed by one section per real department (AI & Innovation, Content, Management, Operations, Test), each listing that department's actual current members, matching the design confirmed with the user. Required a server restart mid-test (the running dev server wasn't in watch mode and hadn't picked up the code change). | None remaining. |
| Team KPI summary — "Team Head" badge (manager/admin view only) | **Implemented and browser-verified (2026-09-10)** | End-to-end | Follow-up UI request, not in either source doc: within the manager/admin `{myTeam, byDepartment}` view specifically (not the team head's own flat view — confirmed with the user this is scoped to admin/manager accounts only), any row where `isTeamHead === true` gets a "Team Head" badge next to their name, reusing the exact same `badge badge-approved` style `roster.js` already uses for the identical flag, rather than inventing a new one. | `kpiScoringService.js` `summaryRow` (added `isTeamHead: entry.isTeamHead` to the returned row); `kpiTeam.js` (`summaryTableHtml`'s new `showTeamHeadBadge` parameter, `true` for `myTeam`/`byDepartment` call sites, `false` for the team-head's own flat-array call site) | Manually Verified in a real browser — reactivated the same 3 throwaway test accounts, confirmed a real existing team head ("Mohamed Khalid") showed the badge in the live "AI & Innovation" department section, and the dedicated test team head ("ZZZ_TEST TeamHead") showed it in the "Test" department section while "ZZZ_TEST Report1"/"Report2" correctly showed no badge | None remaining. |
| Team availability (in this section) | Implemented | Backend only | Covered by the Leave module's "off today"/"who's online" features (see §6) | see §6 | Manually Verified | Not a dedicated "team performance" widget, reuses §6's data |
| Team performance visibility based on permissions | **Implemented but Needs Changes** | End-to-end, incorrectly scoped | Same RBAC gap as the row above — "based on permissions" is not correctly enforced for non-CEO/non-admin managers | `kpiScoringService.js:468-490` | Manually Verified | Same as above |

### Portal §21 — Requests Center

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Recent requests (unified, cross-type) | Not Started | — | No single "Requests Center" aggregating leave requests + profile-change requests + anything else into one list | routes confirm 3 separate silos: `/leave-requests/*`, `/profile-change-requests/*`, `/conflict-pairs/*` | Not Tested | Each request type lives in its own tab/endpoint |
| Request date | Not Applicable | — | Exists per-silo (e.g. leave requests have dates) | — | — | Data exists, just not unified |
| Request category | Not Applicable | — | Implicit per-silo (the tab you're in) | — | — | — |
| Request status | Not Applicable | — | Exists per-silo | — | — | — |
| Request details | Not Applicable | — | Exists per-silo | — | — | — |
| Search / filter requests | Not Started | — | No cross-type search found | grep confirms no unified search | Not Tested | — |
| Activity / history log | Partially Implemented | Backend only | `audit_log` table captures every mutation with actor/timestamp — but it's an internal audit trail, not a user-facing "my activity" history view | `common/audit.js` | Manually Verified (schema/writer read) | Not exposed to end users at all — see Governance §9 gap below |

### Portal §22 — Dashboard & System Experience

| Requirement | Progress | Depth | Evidence | Testing | Gaps |
|---|---|---|---|---|---|
| Dashboard greeting + current date | Implemented | UI | Overview tab renders a greeting/summary header | `views/js/overview.js` | Manually Verified (code read) | — |
| Quick actions section | Partially Implemented | UI | Some quick-nav buttons exist (switch to roster/team/KPI tabs) but not a dedicated "Quick Actions" widget matching the doc's exact list | `overview.js:167,212,259,295,306,364` | Not Tested | — |
| → Request Time Off | Implemented | UI | Tab switch to Time Off | as above | Manually Verified | — |
| → View KPIs / Performance | Implemented | UI | Tab switch to KPI | as above | Manually Verified | — |
| → View Team | Implemented | UI | Tab switch to Team/Roster | as above | Manually Verified | — |
| → Update Profile | Partially Implemented | UI | Profile editing lives in Account Settings (accessed via account menu), not a one-click Overview action | inferred from `rosterService.js` `updateMine` being the backing call | Unable to Test (not browser-exercised) | — |
| → View Documents | Not Started | — | Feature doesn't exist (§16) | — | Not Tested | — |
| → View Policies | Not Started | — | Feature doesn't exist (§17) | — | Not Tested | — |
| Useful empty-state CTAs | Partially Implemented | UI | Some empty states exist (e.g. "No other teammates found yet", `team.js:84-86`) but not confirmed comprehensive across every panel | spot-checked in `team.js` | Not Tested | — |
| Hide irrelevant sections when no data/role | Implemented | UI | Nav tabs (`maintab-team`, `maintab-roster`, `maintab-leave-report`, `tab-users`) are `style="display:none"` by default and shown via JS role checks | `index.html:62-64`; `main.js` role-gating logic | Manually Verified (HTML source read) | — |
| Role-based visibility for employees/managers/HR/admins | Implemented | End-to-end (server + client) | Both client-side nav hiding **and** server-side `requireRole`/service-level role checks exist for every sensitive route reviewed in this audit | multiple, see Governance §9 table below | Manually Verified | — |
| Clear alerts for items requiring immediate action | Partially Implemented | UI | KPI required-actions and notification badges exist; no unified "alerts" surface spanning leave/profile/other domains | `kpi.js` notification panel | Not Tested | Same KPI-siloed limitation as §12/§14 |
| **Mobile-responsive dashboard** | **Not Started** | — | **Zero `@media` queries found in any of the 4 module CSS files** (`login.css`, `employees.css`, `ceoDashboard.css`, `commercialLeads.css`) | `grep -l "@media" src/modules/**/*.css` → no output | Not Tested | Hard, verifiable gap — directly fails Governance §21's "Mobile responsiveness checked" launch-checklist item |
| Filters by date/status where relevant | Partially Implemented | UI | Some filtering exists in specific views (e.g. off-today by date); no universal filter pattern | scattered, not centrally verified | Not Tested | — |
| Notification indicator for new requests/approvals/KPI/policy | Partially Implemented | UI | KPI notifications only, as in §14 | see §14 | Not Tested | — |
| Export/download option for leave and performance history | Partially Implemented | Backend (KPI only) | Only `kpi/:employeeId/history/export` (CSV) exists — no leave-history export | `kpiController.js:60-66` | Manually Verified | Doc explicitly asks for leave export too — absent |

---

## 4. Implemented

Fully end-to-end, live-verified, and matching (or exceeding) the requirement doc's intent:

- Employee Profile core fields (name, photo w/ magic-byte validation, job title, department, employment type, joining date, work location, computed status) — Portal §1
- Real manager reporting-line FK (`manager_employee_id`) and directory manager-name resolution — Portal §2
- Two-stage (manager → People & Culture) leave approval workflow with ClickUp sync, conflict-pair overlap warnings, and audited decisions — Portal §4
- Real-time-ish presence ("who's online," 5-min staleness window) — Portal §6
- The entire KPI scoring engine: overall score, quarter tracking, targets/weights/comments, CSV history export, self-evaluation, anonymized peer review (Pillar A) — Portal §8–§11
- Self-service profile-edit lock + audited change-request approval workflow — Portal §18
- My Team directory (names/roles/departments/direct reports) — Portal §19
- Team KPI summary, correctly scoped to the reporting-line FK for team heads (fixed 2026-09-10 — this line was inaccurate in the original v1 audit, which listed this as working while §7 correctly flagged it as broken; both are now consistent) — Portal §20
- Server-side + client-side role gating on every sensitive route reviewed (Margin Planner, CEO Dashboard, Commercial Leads, roster management, leave decisions) — Governance §9
- Least-privilege signup default (`employee` role, no self-elevation path) — Governance §15
- Access-token-in-memory / httpOnly-scoped-refresh-cookie / no-permissive-CORS security model — Governance §9, CLAUDE.md
- **Module-boundary discipline (CLAUDE.md's non-negotiable module-isolation rule) is fully compliant** — a repo-wide grep for cross-module `require()` calls found zero violations; every inter-module reference goes through that module's own `index.js` public interface, exactly as specified
- Audit-log coverage of every mutation in every module that actually exists (30+ call sites) — see the Governance §12 coverage table in §9 below

## 5. Partially Implemented

- Leave Balance (§3) — request-count breakdown exists; no entitlement/accrual/remaining-days ledger
- Reporting line/org structure (§2) — one-level FK exists; no chart, no multi-level chain endpoint
- Team Availability aggregates (§6) — "who's off today" and "who's online" are real; count-based summaries (# working/on leave/remote/offline) are not
- Employee Evaluation (§11) — self-eval and quarterly scoring are real; "manager evaluation" is architecturally anonymous peer review, not a named manager score
- Required Actions (§12) — real but entirely KPI-scoped; 3 of 6 doc bullets have zero backing
- Notifications (§14) — real but entirely KPI-scoped
- Personal & Contact Information (§18) — work-side data is solid; no phone/emergency-contact/completion-% fields exist
- Requests Center (§21) — the underlying data (leave, profile-change, audit log) all exists; there is no unified cross-domain view
- Dashboard quick actions / empty states / filters / notification indicator (§22) — partial coverage, not systematic across every panel

## 6. Missing / Not Started

- **Leave entitlement/accrual/remaining balance** (§3) — the literal core concept of the section
- **Organizational chart visualization** (§2)
- **Training & Onboarding module** (§13) — zero commits in git history
- **Announcements & Company Updates** (§15) — zero commits in git history
- **Employee Documents** (§16, contract/job description/NDA/handbook storage) — zero commits in git history
- **Policies module + acknowledgment tracking** (§17) — a **mandatory** governance SOP item with a hard 5-business-day compliance window and zero implementation
- **General-purpose (non-KPI) notifications** (§14) — leave approvals, policy updates, announcements all fire no notification of any kind
- **Mobile-responsive CSS** — zero `@media` queries anywhere in the codebase (Governance §21 launch-blocker item)
- **In-app audit-log viewer** — the data is captured (`audit_log` table + mirrored JSON logs) but there is no `/api/audit` route or admin UI to review it (Governance §9, §15)
- **Access-list export** for the mandatory quarterly access audit (Governance §9)
- **Automated tests of any kind** — zero test files, no CI pipeline

## 7. Needs Correction

- ~~Team KPI Summary was scoped by auth role instead of the real reporting line (§20)~~ — **Fixed and browser-verified 2026-09-10.** `kpiScoringService.computeTeamSummary` previously granted access to `MANAGER`/`ADMIN` auth roles only and returned the entire company's KPI standing as one undifferentiated list, silently denying the feature to every real team head who wasn't the CEO or an admin. Fix (confirmed with the user in two rounds — first the RBAC scoping, then a refinement to split company-wide into `myTeam` + per-department groups instead of one flat list): team heads get their own direct reports (flat); `manager`/`admin` get `{ myTeam, byDepartment }`. A second bug was found and fixed in the same pass: the frontend never showed the "Team Performance" tab to team heads at all (gated on auth role only), so the backend fix alone wouldn't have been visible to any real team head. See §20 table above for full verification detail.
- **`working_hours`/`work_schedule` regression** (§1) — was implemented, then deliberately dropped by migration `021` on 2026-09-06; the requirement doc (authored ~2 Sep) still marks this ✅. Needs a product decision: update the requirement doc, or reconsider the drop. See Regression Tracking, §12.
- **Response envelope does not match CLAUDE.md / `docs/api-guidelines.md`** — CLAUDE.md states responses must follow `{ data }` / `{ error: { message, code, details } }`. The real, deliberate implementation uses a flat `{ error: "<string>" }` for errors (`common/errorHandler.js:4-7`, explicitly commented as intentional to match the legacy Margin Planner frontend's contract) and unwrapped success payloads (`{ token, user }`, not `{ data: { token, user } }` — `authController.js:28,37`). This is a **documented, deliberate** divergence in the code, but `docs/api-guidelines.md` was never updated to describe it (unlike `docs/migration-plan.md`, which *was* reconciled on 2026-09-08). Needs either a doc update or a real migration to the documented envelope.
- **`process.env` read outside `config/index.js`** — CLAUDE.md: "Never read `process.env` outside `config/index.js`" is listed as non-negotiable. Directly re-verified by the coordinating session (`grep -rln "process\.env" src --include="*.js"`, excluding `config/index.js` itself): **11 other files** read it directly — `src/backup.js`, `src/auth.js` (likely dead legacy code per `migration-plan.md`'s own note), `src/seed-owner.js`, `src/index.js`, `src/common/logger.js`, `src/common/integrations/clickupClient.js`, and five ClickUp-related job/controller files: `modules/management/commercial-leads/jobs/reconcile.js`, `modules/management/commercial-leads/controllers/webhookController.js`, `modules/employees/jobs/clickupUserSyncSchedule.js`, `modules/employees/controllers/kpiClickupWebhookController.js`, `modules/employees/jobs/kpiClickupListSync.js`. **This is a partially self-documented, deliberate deferral** — `config/index.js:3-8` has a comment naming several (but not all) of these files as "deliberately out of scope... belongs with the Commercial Lead relocation pass" — but the comment's file list is now stale relative to the actual set, and `src/index.js` itself (reading `JWT_SECRET`/`PORT`/`HOST` directly even though `config/index.js` already exports all three) isn't mentioned in that comment at all.
- **KPI status labels don't literally match the doc** (§8) — 5-tier band vs. the doc's named 3-tier (On Track/Needs Attention/Off Track). Functional superset, but a literal-spec mismatch worth a product decision either way.
- **Admin lacks Governance §9's promised "Full" access on P&C leave queues** — `listPcPending`/`listAutoRejected` are hard-gated to `people_culture` only, no admin bypass (`timeOffService.js:174,184`); live-verified: admin token → `403` on both routes. Deliberate business-logic scoping, but contradicts the letter of the Access Matrix's "Admin: Full" column on every row.

## 8. Testing Status

**No automated tests exist anywhere in this repository.** `npm test` fails with `Missing script: "test"`. `package.json` devDependencies contain only `smee-client` (a ClickUp tunneling tool, not a test framework). No Jest/Mocha/Supertest/ESLint. No `.github/workflows` directory — no CI pipeline of any kind. This directly contradicts `docs/testing.md`, which still describes an (unbuilt) Jest + Supertest + real-Postgres-DB + CI-gate strategy — unlike `docs/migration-plan.md`, this file has **not** been reconciled to reality as of this audit.

Every status in §3 above marked **Manually Verified** means: the relevant service/repository/migration code was read in full, **and** at least one authenticated, read-only `curl` call was made against the real running local dev server (`localhost:3001`, real working SQLite DB) confirming the endpoint responds with the expected shape. No mutating (`POST`/`PATCH`/`DELETE`) calls were made against the shared dev database during this audit — write-path correctness (e.g., the leave two-stage approval actually transitioning state correctly end-to-end) is verified by code reading only, not by exercising it live.

**Not exercised in this pass:** any real browser session (no `claude-in-chrome` UI walkthrough was performed — every UI claim above is a static-code read of the relevant `views/js/*.js` file, not an observed rendering). Mobile responsiveness, calendar-widget rendering, empty-state completeness, and click-through flows should be spot-checked in a real browser in a future audit before being upgraded to "Manually Verified."

**Server health:** the local dev server (running since 2026-09-09, PID observed at audit time) responded `200` on `/` and handled every test request without crashing; a spot-check of `server/data/logs/app-2026-09-10.log` showed only expected 4xx errors from this audit's own deliberate probing (missing query params, role-gated 403s) — no unexpected 5xx or stack-trace crashes.

**`npm audit`: 3 moderate-severity vulnerabilities** (transitive `qs` package, via `body-parser`/`express`) — fixable via `npm audit fix`. This is new information; a prior session's memory recorded this as "clean, 0 vulnerabilities" as of 2026-08-19 — see Regression Tracking §12.

## 9. Gaps and Contradictions

**Between the two requirement documents:**
- The Governance doc's Access & Permission Matrix (§9) names 7 distinct roles: **Employee, Manager, HR, Operations, Commercial, CEO, Admin**. The Portal doc doesn't define roles at all (it's a data/feature spec), but its "My Team"/manager-scoped sections implicitly assume a real line-manager role distinct from "CEO." Neither document reconciles this with the fact that a true line-manager relationship (who approves whose leave) is a *data relationship* (an FK), while "Manager" as an *access role* in the Governance doc's matrix is really the CEO's account in the shipped system — two very different concepts sharing one word.
- The Governance doc's §12 SOP table describes leave approvals as a single-owner, single-approver process ("Owner: Manager, Approver: Manager"); the actual (and, per code comments, deliberately designed) system requires a *second* People & Culture confirmation step after the manager's decision. Not a contradiction of intent, but the SOP documentation doesn't describe the real process.

**Between the requirement documents and the current website:**
- Three requirement-doc sections (Documents §16, Policies §17, Training & Onboarding §13) and one governance-mandatory SOP item (policy acknowledgment) have **zero code**, despite the Governance doc explicitly marking related processes "Yes — mandatory" for in-portal handling (§12 SOP table).
- Governance §9's access-lifecycle workflow ("HR requests access → Ops Manager approves role template → Portal Admin creates account → tests login → HR notifies employee") does not exist — the real system is fully self-service registration (`authService.js:36-72`), with role elevation as a separate, unlinked, no-approval-trail manual step afterward.
- Governance §9's mandated quarterly access-list export doesn't exist — `listUsers` returns a plain in-memory JSON array with no export capability (`accountAdminController.js:5-8`).

**Between the code's own role model and the documents' role models:**
- Code has 6 roles: `employee, manager, operations, finance, admin, people_culture`. `manager` = the CEO's account (confirmed by multiple code comments across `rosterService.js`, `timeOffService.js`, `ceo-dashboard/routes/index.js`, `employees/views/js/main.js`). There is **no distinct "Commercial" role** — the Commercial Leads module is gated to `USER_MANAGER_ROLES` (admin/manager/operations), the same set that gates several unrelated management functions, not a role scoped to Commercial staff specifically. There is **no distinct "CEO" role separate from `manager`**. `people_culture` is the functional equivalent of the doc's "HR." **`finance` exists in the role enum and is assignable via the Users admin UI, but has zero permission gates anywhere in the codebase** — a fully dead/inert role as of this audit.

**Between the frontend and backend:**
- None found that constitute a security gap — every sensitive frontend nav-hiding decision reviewed in this audit (Margin Planner, CEO Dashboard, Commercial Leads, roster management) has a matching server-side `requireRole`/service-level check, not just a hidden button.

**Between roles/permissions and intended stakeholder access:**
- Admin does not get the Governance doc's promised blanket "Full" access on the P&C leave-approval queues (§9 finding above) — a real, verified (403, live-tested) divergence from the documented Access Matrix.

**Between database design and requirements:**
- No schema exists at all for: leave entitlements/balances, documents, policies, announcements, training/onboarding records, general notifications, or personal/emergency-contact fields. These aren't partial — they are absent at the schema level, not just the UI level.

**Audit-trail coverage vs. Governance §12's mandatory list** (every process below is marked "Yes"/"Yes — mandatory" for in-portal handling; ✅ = `audit.record()` is actually called on this action, ❌ = not possible because the feature doesn't exist):

| Governance §12 process | Audited in code? |
|---|---|
| Employee information updates | ✅ (`rosterService.js`, roster + self-service change-request flows) |
| Leave requests / Leave approvals | ✅ (`timeOffService.js`, 4 call sites: submit, manager decision, P&C confirm, cancel) |
| KPI updates | ✅ (`kpiScoringService.js`, manual entry / target-setting / auto-mapping changes) |
| Performance evaluation | ✅ (via KPI manual entry + peer review submission) |
| Required actions | N/A — no distinct "action" entity beyond the above to audit |
| Policy acknowledgment | ❌ — module doesn't exist |
| Employee document updates | ❌ — module doesn't exist |
| Team information (reporting changes) | ✅ (`rosterService.js` update) |
| Announcements | ❌ — module doesn't exist |
| Internal requests | Partial — leave and profile-change requests are audited; there is no generic "requests" entity to audit as a whole |
| Onboarding tasks | ❌ — module doesn't exist |

Where the underlying feature exists, audit coverage is genuinely comprehensive (30+ `audit.record()` call sites found across auth, roster, departments, KPI, conflict-pairs, and time-off) — the gaps above are 100% a function of the missing modules, not of the audit-logging discipline itself. **However, the captured audit trail has no in-app viewer anywhere** — reviewing it requires direct DB access or grepping structured JSON log files by user UUID (a pattern explicitly described in a code comment in `usersAdmin.js:58`). This blocks the Governance doc's weekly/quarterly review processes (§9, §23) from actually happening inside the portal.

**Role elevation has no second-approver step.** Governance §15 states "elevated access requires Operations Manager approval, logged in the Permission Matrix change log." In the real code, `accountAdminService.changeRole` performs the role change immediately, in one step, by whichever single authorized actor initiates it — there is no separate approval/second-actor gate, only after-the-fact audit logging and admin-shielding guards (can't touch/assign `admin` except as an existing admin). This satisfies "dated and attributed" but not "[requires separate] approval."

**Documentation vs. documentation (repo `docs/` vs. reality):**
- `docs/migration-plan.md` was explicitly reconciled to reality on 2026-09-08 (a genuinely good practice — it now states plainly what was and wasn't built). `docs/testing.md` and `docs/api-guidelines.md` have **not** been similarly reconciled and still describe unbuilt/inaccurate targets (Postgres+Jest+CI; the `{data}/{error:{...}}` envelope). This inconsistency-in-reconciliation is itself worth flagging: some docs get updated as reality diverges, others don't, with no visible policy for which.

**No system-side support for the Downtime SOP (Governance §14) — v1.1 addition.** The Downtime SOP assumes a human reports an outage ("Issue reported → Portal Admin logs timestamp and severity"), with no automated-detection assist anywhere in the app: `grep -rn "'/health'\|\"/health\"\|/status\b\|maintenance" server/src` found no health-check route, no `/status` endpoint, and no maintenance-mode banner/flag of any kind. This is a small, cheap addition (a simple `/health` route already has everything it needs — `db` connectivity and process uptime) that would let external monitoring (or even a simple browser tab) detect P1/P2 outages without waiting on a person to notice and report one, which is exactly the failure mode Governance §14 exists to shorten.

## 10. Dependencies

- **Leave Balance (§3)** needs a new `leave_entitlements`/`leave_balances` table + accrual logic before "remaining days" can be shown anywhere — currently blocks §3 entirely and partially blocks §22's "export leave history."
- **Documents (§16) and Policies (§17)** are foundational to: Required Actions' "documents requiring signature"/"policies requiring acknowledgment" (§12), Announcements' "policy updates" (§15), Notifications' "policy update notifications" (§14), and the Governance doc's mandatory policy-acknowledgment SOP (§12/§13). Building a shared document/content module first would unblock four downstream doc sections at once.
- **A general-purpose (non-KPI) notification system** is a prerequisite for real "approval notifications," "policy update notifications" (§14), and a real "notification indicator" across the whole dashboard (§22) — currently every notification concept is hand-rolled inside the KPI module (`kpi_employee_notifications`) with no shared abstraction other modules could reuse.
- **Profile completion percentage (§18)** depends on first deciding which fields count as "the profile" (work fields only, or the not-yet-built personal/contact fields too) — a product decision, not just an engineering task.
- **An in-app audit-log viewer (Governance §9/§15)** depends on nothing new — the `audit_log` table and `common/audit.js` writer already exist; this is a pure "expose existing data" task, the cheapest gap to close in the whole tracker.
- **Access-list export (Governance §9)** similarly depends on nothing new — `listUsers` already returns the full data; only a CSV/export endpoint is missing.
- **Mobile responsiveness (§22 / Governance §21)** has no code dependency, only design/CSS work — but is a hard launch-checklist blocker per the Governance doc's own Go/No-Go criteria.

## 11. Recommended Implementation Order

Ordered by dependency, business importance, security/permissions, data integrity, and testing need — not by document order:

1. ~~Fix the Team KPI Summary RBAC scoping bug (§20)~~ — **Done 2026-09-10**, see §16 Change History.
2. **Automated test coverage for the leave and KPI approval paths** (currently the two highest-value, most-mutation-heavy modules in the app, with zero test coverage and real payroll/HR consequences if a status-transition bug ships silently).
3. **In-app audit-log viewer + access-list export** — cheapest possible wins (data already exists), directly close two Governance §9/§15 mandatory-SOP gaps.
4. **Leave Balance / entitlement ledger (§3)** — the single most-named, most business-critical missing concept in the whole Portal doc; also unblocks a cleaner "export leave history" for §22. *(Note: a concurrent background session was observed already working in this area — coordinate before starting.)*
5. **Fix the `npm audit` moderate vulnerabilities** (`npm audit fix` — likely a quick, low-risk dependency bump) and reconcile `finance`'s dead-role status (either wire it to something real or remove it from `ASSIGNABLE_ROLES`).
6. **Documents + Policies module** (shared content infrastructure) — unblocks four downstream doc sections at once (§12, §14, §15, §17) and closes the Governance doc's mandatory policy-acknowledgment SOP gap.
7. **Mobile-responsive CSS pass** — a hard Governance §21 launch-checklist blocker, low engineering complexity relative to its business urgency given the Governance doc's compressed 9-Sep launch timeline.
8. **General-purpose notification system**, generalizing the existing KPI-notification pattern to leave/profile/policy events.
9. **Announcements & Training/Onboarding modules** — lowest immediate business urgency of the missing features (no hard compliance deadline attached, unlike policy acknowledgment), but explicitly required by the Governance doc's mandatory-use policy (§13) once the higher-priority items above are done.
10. **Unify Requests Center (§21) and org-chart visualization (§2)** — genuine UX improvements, but nothing else depends on them.

## 12. Regression Tracking

| Date detected | Feature | Regression | Previous state | Current state | Cause | Resolution |
|---|---|---|---|---|---|---|
| 2026-09-10 (this audit) | Employee Profile — Working hours / schedule (Portal §1) | Feature was built, then deliberately removed | Columns `employees.working_hours`/`work_schedule` existed (migrations `007`, `008`); Portal doc marks this bullet ✅ (authored ~2 Sep 2026) | Columns dropped entirely, no replacement (migration `021_drop_working_hours_and_work_schedule.js`, commit `e09ff93`, 2026-09-06, merged via PR #38) | Explicit, documented product decision (migration comment: "removed as a product decision; there's no replacement") — not a bug | **Open** — needs a decision: update the requirement doc to remove the ✅, or reconsider the drop |
| 2026-09-10 (this audit) | `npm audit` vulnerability count | Regression in dependency security posture | Prior session memory (2026-08-19) recorded "clean, 0 vulnerabilities" | 3 moderate-severity vulnerabilities (`qs` via `body-parser`/`express`), confirmed by running `npm audit` directly in this session | Upstream dependency advisory published between 2026-08-19 and 2026-09-10; not a code change in this repo | **Open** — `npm audit fix` likely resolves it; not yet applied (out of scope for an audit-only session) |

## 13. Decision Log

| Date | Decision | Type | Reason | Affected Features | Status |
|---|---|---|---|---|---|
| 2026-09-06 | Drop `working_hours`/`work_schedule` fields, drop hybrid work locations, relabel Cairo/Alex | **Existing decision** (found in code) | Migration `021` comment: "removed as a product decision; there's no replacement" — no further rationale captured in-repo | Portal §1 (Employee Profile) | Implemented in code; **not yet reconciled with the Portal requirement doc**, which still shows this bullet as ✅ |
| 2026-09-08 | Reconcile `docs/migration-plan.md` to describe the real SQLite/no-Knex/no-Postgres architecture instead of the original aspirational plan | **Existing decision** (found in `docs/migration-plan.md`'s own header) | Explicitly stated in the doc: keep the original plan as historical record, add a reality-check section on top | Documentation accuracy generally | Done for this one file; `docs/testing.md` and `docs/api-guidelines.md` were **not** similarly reconciled — flagged as an open inconsistency |
| 2026-09-10 (this audit) | Leave requests require a two-stage approval (manager decision, then People & Culture confirmation) before terminal "approved" status | **Existing decision** (found in code, cited against an internal, non-audited `Time_off.pdf` spec) | Code comments cite this as the actual designed process; not described by either requirement document audited here | Portal §4 (Time Off Requests) | Implemented; **recommended** that the Governance doc's §12 SOP table be updated to describe this second stage explicitly |
| 2026-09-10 (this audit) | "Manager evaluation" (Portal §11) is implemented as anonymous, aggregated peer review rather than a named manager score | **Existing decision** (documented in ADR-0012) | ADR-0012 (`docs/adr/0012-kpi-evaluation-lifecycle.md`) | Portal §11 | Implemented; a genuine, documented architectural choice — **recommended** that the Portal requirement doc's "Manager evaluation" language be reconciled with this reality, or the decision revisited, as a product conversation |
| — | Build a shared Documents/Policies module before the KPI-domain notification system is generalized | **Recommended decision** (this audit) | Four downstream doc sections (§12, §14, §15, §17) and one mandatory governance SOP all depend on this existing first | Portal §12, §14, §15, §17; Governance §12/§13 | Open |
| — | Should the `finance` role be wired to real permissions, or removed from `ASSIGNABLE_ROLES`? | **Open decision** | Currently assignable via the Users admin UI with zero effect — a confusing, inert option for whoever administers roles | Governance §9 Access Matrix, `common/permissions.js` | Open |
| 2026-09-10 | Re-scope Team KPI Summary, round 1: keep `manager`/`admin` company-wide (unchanged), add `is_team_head` employees scoped to `findByManagerId(actorEmployee.id)` (their own direct reports, one level) | **Existing decision** (made this session, with the user, before implementing) | User confirmed exact semantics in conversation: team heads see people they manage; the CEO's `manager` role is "the same thing... plus the company-wide teams/departments," i.e. company-wide already is a superset of "their team," so no separate merge logic was needed | Portal §20 (Team Performance) | **Superseded by round 2 below** — implementation was correct for round 1's spec, but the spec itself changed |
| 2026-09-10 | Re-scope Team KPI Summary, round 2 (final): company-wide is not one flat list — split into `myTeam` (the manager's own direct reports) + `byDepartment` (every department's full real membership, independent of `myTeam`, duplicates allowed). Team heads unaffected (still flat, round 1's design). | **Existing decision** (user explicitly corrected round 1's assumption: "i need the company wide kpi summary to be different reports, not all reports of the company") | Company-wide as one undifferentiated list didn't give department-level visibility the business actually wants; user confirmed via a concrete worked example (using their own employee-numbering scenario) with three structural options presented — picked "departments always complete, duplicates allowed" | Portal §20 (Team Performance) | **Done** — implemented, and separately confirmed a frontend bug (Team Performance tab never shown to team heads) that would have made the backend fix invisible; both fixed and verified live in a real browser with a throwaway test account (see §20 table, §16 Change History) |
| — | Should role elevation (`changeRole`) require a second approver, per Governance §15's literal language? | **Open decision** | Currently one authorized actor can both initiate and finalize a role change in a single step; only after-the-fact audit logging exists | Governance §15 Access & Permissions SOP | Open |
| — | Should `docs/testing.md` and `docs/api-guidelines.md` be reconciled to reality (the way `docs/migration-plan.md` was), or should the code be changed to match them? | **Open decision** | Both currently describe unbuilt/inaccurate targets; CLAUDE.md states docs are source of truth when they conflict with implementation, but that assumes the docs are current | Testing strategy, API response envelope | Open |

## 14. Questions / Decisions Needed

Genuine open questions that cannot be resolved from the two requirement documents or the code alone — each needs a human/stakeholder decision, not an engineering guess. (These are drawn from the Decision Log's "Open"/"Recommended" rows above, surfaced here as a standalone worklist per the tracker's reporting spec.)

1. **The Portal doc still marks "Working hours / schedule" (§1) ✅, but migration `021` deliberately dropped those fields on 2026-09-06.** Should the requirement doc be updated to remove that checkmark, or should the drop be reconsidered? Cannot be resolved from code alone — this is a product call.
2. **The Portal doc's "Manager evaluation" (§11) is implemented as anonymous, aggregated peer review (ADR-0012), not a named manager score.** Is this architectural substitution acceptable as the permanent design, or does the business actually need a manager-attributed score alongside it? The code and ADR explain *what* was built, not whether it still satisfies the original ask.
3. **Should the `finance` role be wired to real permissions, or removed from `ASSIGNABLE_ROLES`?** It is currently assignable via the Users admin UI with zero effect anywhere in the codebase — neither document explains what `finance` was meant to gate.
4. ~~Should the Team KPI Summary endpoint (§20) be re-scoped to the real reporting-line FK?~~ — **Resolved 2026-09-10, in two rounds.** User confirmed: yes for team heads (their own direct reports). For `manager`/`admin`, the initial fix kept the old flat company-wide list, but the user then refined this further: company-wide should be `myTeam` (their own direct reports) plus one section per real department, not one undifferentiated list. Implemented, and verified live in a real browser. See §13 Decision Log and §20 table.
5. **Should `docs/testing.md` and `docs/api-guidelines.md` be reconciled to reality** (the way `docs/migration-plan.md` was on 2026-09-08), or should the code be changed to match them (real Jest/Supertest/CI; the `{data}/{error:{...}}` envelope)? CLAUDE.md states docs win when docs and code disagree, but that assumes the docs are current — these two aren't, and no one has yet decided which direction to reconcile.
6. **Should role elevation (`changeRole`) require a second approver**, per Governance §15's literal "elevated access requires Operations Manager approval" language? Today one authorized actor completes the change alone, with only after-the-fact audit logging.
7. **Is the Governance doc's 7-role model (Employee/Manager/HR/Operations/Commercial/CEO/Admin) meant to be implemented literally** (i.e., should the code eventually grow a distinct line-manager role and a distinct Commercial role, separate from `manager`=CEO), or was the doc written aspirationally/organizationally without intending a 1:1 role-enum mapping? This affects how much of the "Needs Correction" RBAC work in §7 above is actually in scope for engineering vs. already acceptable as-is.
8. **Is a literal in-portal "Training & Onboarding module" (Portal §13) actually wanted**, given the Governance doc's own Training Plan (§10) describes live/recorded-session training that may not need a portal-tracked module at all? The two documents don't contradict each other outright, but they also don't confirm the Portal doc's §13 is still the intended design — worth a direct check with whoever owns both documents before scoping this work.

---

## 15. Progress History

| Date | Overall Progress (Portal-doc bullet score) | Major Completed Areas | Major Remaining Areas |
|---|---|---|---|
| 2026-09-10 | **≈ 60%** (unweighted, all 22 Portal-doc sections; see §2 methodology) | KPI/Performance engine (§8–11, ~80–100% per section); Time Off Requests workflow (§4, 93%); Employee Profile core (§1, 89%); My Team (§19, ~92%) | Documents/Policies/Training/Announcements/general Notifications (§13–17, ~5% combined); Leave Balance concept (§3, 43%); mobile responsiveness (0%); automated testing (0%) |

*(This is the first snapshot. Future updates must append new rows here, never overwrite this one, even if the methodology changes — document any methodology change explicitly alongside the new row.)*

## 16. Change History

| Date | Change | Features Affected | Previous Status | New Status | Commit / Reference | Notes |
|---|---|---|---|---|---|---|
| 2026-09-10 | **Tracker created** — full initial audit of both requirement documents against the live codebase | All | N/A (no prior tracker existed) | See §3 table | This document, initial commit | Baseline for all future updates |
| 2026-09-06 | Working hours/schedule fields dropped; hybrid locations dropped; Cairo/Alex relabeled | Portal §1 Employee Profile | Implemented | Not Started (regressed) | `e09ff93`, PR #38 | See Regression Tracking §12 |
| 2026-09-07 | KPI dashboard, ClickUp automation, hosted peer review built out | Portal §8–§11 | Partial (base scoring only, from `63bf7dd` 2026-08-19) | Implemented (most bullets) | `14a1baf` | Largest single-commit feature addition found in this audit's git history review |
| 2026-09-06 | Departments converted from a hardcoded array to a real role-managed DB table + FK; conflict-pair edit/delete added | Portal §1 (Department), internal conflict-pair feature | Partial | Implemented | `eb4e2a1`, ADR-0011 | — |
| 2026-09-10 | "Learn with Marie" added to the fixed job-title list | Portal §1 (Job title) | Implemented | Implemented (list extended) | `31688a2` (current HEAD) | Minor, noted for completeness |
| 2026-09-10 | **Cross-verification pass** — two of the five parallel research agents used in this same audit session independently cross-checked each other's areas and both wrote to this file; the coordinating session then re-verified the highest-stakes claims directly against the code (`npm audit`, `computeTeamSummary`, `process.env` grep) | All | v1 findings | One correction (process.env file count, 10→11); all other findings converged, no other corrections needed (see §0 reconciliation note) | This document | Additive findings folded in: Downtime SOP / no health-check-endpoint gap (§9), module-boundary-compliance bullet (§4) |
| 2026-09-10 | **Fixed the Team KPI Summary RBAC bug, round 1** — `computeTeamSummary` no longer 403s every non-manager/admin actor; `is_team_head` employees now see their own direct reports, `manager`/`admin` keep the company-wide list | Portal §20 Team Performance | Implemented but Needs Changes (real RBAC gap, §7) | Implemented (round 1) | `kpiScoringService.js` (working-tree change) | Verified read-only against real dev data via the DI-wired service. Superseded same-day by round 2 below once the user refined the requirement. |
| 2026-09-10 | **Refined the fix, round 2 — company-wide split into `myTeam` + `byDepartment`; frontend tab-visibility bug found and fixed; full browser verification performed** | Portal §20 Team Performance | Implemented (round 1) | **Implemented and browser-verified** | `kpiScoringService.js` (`computeTeamSummary`, new `summaryRow` helper, added `departmentRepository` dependency), `container.js` (dependency wiring), `kpi.js` (`renderSubNav`'s tab-visibility gate, line ~418), `kpiTeam.js` (rewritten to render both response shapes) — commit `16d8341` | User corrected round 1's assumption that company-wide should stay one flat list; after three rounds of clarifying questions (using concrete worked examples with the user's own employee numbers) landed on `{myTeam, byDepartment}` with duplicates allowed across groups. Separately discovered the frontend never showed the "Team Performance" tab to team heads at all (`kpi.js` gated it on `isManager\|\|isAdmin` only) — without this, round 1's backend fix would have been permanently invisible to any real team head. Both fixed together. **Full live verification**: created 3 throwaway test accounts via the real registration + admin APIs (`zzz-test-teamhead/report1/report2@ceastest.local`), wired a real `is_team_head`/`manager_employee_id` structure, restarted the dev server (it wasn't in watch mode and hadn't picked up the earlier edits), logged into the team-head test account in a real browser session and confirmed the tab now appears and shows exactly the 2 direct reports; temporarily promoted the same account to `manager`, re-logged-in, and confirmed it shows "My Team" + one section per real department with correct real membership. Reverted the role change and deactivated all 3 test accounts afterward (not hard-deleted, per this repo's revoke-never-delete convention) — confirmed as a side effect that deactivation correctly blocks the live session too. Flagged to the user before logging into a test account in their real Chrome profile, per standing guidance that claude-in-chrome uses their actual browser session. |
| 2026-09-10 | **Added a "Team Head" badge to the manager/admin Team Performance view** — follow-up UI request from the user, not in either source doc | Portal §20 Team Performance | Implemented and browser-verified (round 2) | Implemented and browser-verified (with badge) | `kpiScoringService.js` (`summaryRow`), `kpiTeam.js` (`summaryTableHtml`) — commit `16d8341` | Confirmed with the user first (scope = manager/admin view only, every `is_team_head` row gets it, "Team Head" label is sufficient, reused the existing `roster.js` badge style rather than a new one). Verified live: reactivated the same 3 throwaway test accounts, confirmed the badge on both a real pre-existing team head and the dedicated test team head, confirmed no badge on non-team-head rows. **Incident during this verification pass**: a stale httpOnly refresh-token cookie from an earlier admin login in this same session silently resumed when navigating to `/login` in the browser, so the first attempt briefly landed on the real admin account's dashboard instead of the test account — caught immediately (before any data was changed), fixed by explicitly logging out first each time before logging into a test account. Re-deactivated and role-reverted all 3 test accounts afterward, same as round 2. |
| 2026-09-10 | **Committed and pushed** all of the above (Team KPI Summary fix, department view, Team Head badge, and this tracker's creation) to a new branch | Portal §20 Team Performance; this document | Working-tree changes | Committed | `16d8341` on `feature/team-kpi-summary-department-view` (pushed to `origin`, PR not yet opened) | Branched off `feature/add-learn-with-marie-job-title` (HEAD at the time, itself already fully pushed/up to date with `origin`) rather than reusing that branch, matching this repo's own convention of one scoped branch per feature. `docs/migration-plan.md`, modified before this session started and unrelated to today's work, was deliberately left unstaged/uncommitted. |

## 17. Appendix — Role Mapping (Governance doc ↔ actual code)

| Governance doc role | Code equivalent | Notes |
|---|---|---|
| Employee | `employee` | Direct match |
| HR | `people_culture` | Functional match; naming differs |
| Operations | `operations` | Direct match |
| Admin | `admin` | Direct match; admin-shielding logic in `common/permissions.js` |
| CEO | `manager` | **The code's `manager` role literally is the CEO's account** — confirmed by comments in `rosterService.js:10`, `timeOffService.js:133`, `ceo-dashboard/routes/index.js:9-11`, `employees/views/js/main.js:13,30` |
| Manager (line manager) | *No dedicated role* — enforced via `employees.manager_employee_id` FK | A real employee can approve leave for their direct reports regardless of their own auth role, because `managerDecision`'s authorization checks the FK relationship, not a role string (`timeOffService.js:231-238`) |
| Commercial | *No dedicated role* | Commercial Leads module is gated to `USER_MANAGER_ROLES` (`admin`/`manager`/`operations`) — the same broad set used elsewhere, not a role scoped to Commercial staff |
| *(no doc equivalent)* | `finance` | Exists in the role enum, assignable via the Users admin UI, **zero permission gates found anywhere** — a dead role as of this audit |
| *(no doc equivalent)* | `is_team_head` (employee flag, not an auth role) | Closest code concept to the doc's "Department Head" — a per-employee boolean, independent of `role` |

---

## 18. Functionality Beyond Either Requirement Document

Real, substantial, live features that exist in the codebase with no mention in either requirement document — tracked here so a future audit doesn't mistake them for scope creep or miss them entirely:

- **`/planner` — Margin Planner**: the original "Pricing Portal" project-costing/quoting tool this whole repo is named for. Gated to `USER_MANAGER_ROLES`.
- **`/commercial-lead` — Commercial Leads dashboard**: a live, ClickUp-webhook-driven sales/deals pipeline (deal stages, stage-duration analytics, quarterly KPIs for the Commercial team). Built essentially in one day (`9249f0d`/`74ab150`, 2026-08-13).
- **`/ceo` — CEO Dashboard**: an executive summary dashboard, originally a mocked-data prototype (`bb29011`, 2026-08-23), later partially wired to real Margin Planner cost data.
- **Conflict-pair management**: a leave-overlap warning system between paired employees (e.g. two people who must not be out simultaneously) — not described in either doc, warn-only, never blocks submission.

These should be tracked as **Not Applicable / Out of documented scope** in any percentage calculation, not silently ignored.

---

## 19. Future Update Workflow

When a future session is asked to **"update the CEAS Portal implementation tracker,"** follow this sequence. The goal is evolution, not regeneration — this file's history (§12 Regression Tracking, §13 Decision Log, §15 Progress History, §16 Change History) is itself the record of how the project moved; overwriting it destroys that record.

1. **Read this file in full first.** Do not start from the requirement documents alone — you need to know what was already found, what was already flagged as "Open," and what the last "Last Verified" date was for the area you're about to touch.
2. **Re-read the relevant requirement document section(s)** — `CEAS_Portal_Governance_Workflow.pdf` and/or `Employee_Portal_Sections_Requirements.pages` (the latter is Apple's binary iWork format; export it via `osascript` driving Pages.app to PDF, then `pdftotext -layout`, the same approach used to produce this version — do not attempt to parse the `.pages` bundle's `.iwa` files directly).
3. **Inspect the current codebase** for the area in question — routes, controllers, services, repositories, models, and migrations, not just the frontend. A UI element, route, or DB column existing is not evidence a feature works end-to-end; verify the logic behind it.
4. **Inspect the current website/running app** where practical — the dev server can be started with `npm start`/`npm run dev` in `server/`; check `lsof -i :3001` first in case it's already running (it was, throughout this audit). Use authenticated, read-only `curl` calls (seed credentials in `server/.env`, `SEED_OWNER_USERNAME`/`SEED_OWNER_PASSWORD`, login via `POST /api/auth/login` with `{"email":..., "password":...}`) against a **real dev copy**, never production, and avoid mutating shared dev data unless the user explicitly asks for a live write-path test.
5. **Inspect recent Git history** — `git log --oneline -30`, and targeted `git log --grep` searches for the feature area — to see what actually shipped since the last "Last Verified" date on the rows you're revisiting.
6. **Run relevant tests where practical.** As of this version, **zero automated tests exist in this repository** (`npm test` → "Missing script"); if that has changed, note it explicitly as a major status change (see step 13) — don't silently assume it's still true.
7. **Compare the current implementation against this tracker's existing rows** for the area in question, not just against the requirement doc from scratch — you're looking for *drift* (regressions, newly-fixed gaps, newly-changed scope), not re-deriving everything.
8. **Identify newly implemented features** — update their row's Progress/Depth/Evidence/Testing columns in §3, and add a line to §4 Implemented if it's now fully done.
9. **Identify newly partially-implemented features** — same, moving items between §5/§6/§7 as appropriate.
10. **Identify newly discovered gaps** — add rows to §3/§6/§9 (Gaps and Contradictions) as needed; do not delete a gap that turns out to still be open, just confirm it's still accurate.
11. **Identify regressions** — anything previously marked Implemented that is now broken, removed, or degraded gets a **new row in §12 Regression Tracking** (never edit a past regression row's "Previous state"/"Current state" — those are historical facts about that point in time). Cross-reference the specific commit that caused it if findable via `git log`/`git blame`.
12. **Update Testing Status (§8)** for anything you actually exercised this pass — be honest about what's still only "Manually Verified" via code-reading vs. what you clicked through in a real browser or ran through an automated test.
13. **Update the Overall Progress percentages (§2)** — recompute using the same bullet-level methodology already documented there (or explicitly document a methodology change if you're deliberately changing it — never silently change how the number is computed without saying so).
14. **Append a new row to §15 Progress History** — never overwrite the existing rows, even if the methodology changed.
15. **Append rows to §16 Change History** for every meaningful change** (new features, completed requirements, regressions, changed requirements, new/resolved gaps, new/failed tests, fixed bugs, architecture/database/permission changes, integrations added/changed, important decisions). Skip purely cosmetic file changes — this log is for things a stakeholder would care about.
16. **Add rows to §13 Decision Log** for any new architectural/product decision discovered or made during the update — tag each as **Existing decision** (found in code/docs, not made this session), **Recommended decision** (your suggestion, not yet accepted), or **Open decision** (genuinely unresolved) — never record a decision that wasn't actually made or proposed.
17. **Update §14 Questions / Decisions Needed** — remove a question once it's been genuinely answered (and note where/how, e.g. "resolved 2026-10-01: user confirmed the ✅ mark should be removed"), and add any new ones surfaced this pass.
18. **Preserve everything else.** Do not delete historical rows in §12/§13/§15/§16 even if they look resolved or superseded — mark their `Status`/`Resolution` column instead. Do not regenerate §17 (Role Mapping) or §18 (Functionality Beyond Either Requirement Document) from scratch — update them in place if the underlying facts changed.

**A note on parallel research agents:** this initial audit used five parallel sub-agents to cover the codebase's functional areas concurrently, which is why §0's Audit History looks the way it does. That's a valid approach for future large updates too (e.g., "re-audit everything" after months of development), but for a small, targeted update ("did the leave balance feature ship yet?") a single focused read is more appropriate — match the effort to the size of the actual change being verified, and always have one coordinating pass review and reconcile whatever the sub-agents produce before treating it as final, the way this version's §0/§2 corrections were made.
