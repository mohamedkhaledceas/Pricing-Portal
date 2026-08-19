/* New tables for the employees module (roster, time-off, KPI) — see
   docs (the approved employees-module plan) for the full rationale.

   Design notes worth keeping in mind when reading this:
   - `employees` deliberately has no name/email columns — those live on
     `users` (identity/auth), joined via the required, unique `user_id`
     FK. Keeps the auth/employees module boundary real: auth's own table
     never carries employees-domain columns.
   - `employees.active` (employment status) is deliberately distinct from
     `users.is_active` (login/access status) — the same distinction
     docs/adr/0002 already draws for employee_roster.active vs.
     users.is_active. Offboarding and "this account can't log in" are
     different facts that can change independently.
   - `conflict_pairs` is an inert extension point this pass — the data
     model exists, but no service calls it from the leave-submission flow
     yet. The actual business rule is still unresolved (see the plan);
     don't infer one from this schema.
   - `kpi_definitions` only models Pillar B (quality/delivery/growth/
     people_retention) — Pillar A's 6 dimensions are fixed and identical
     for every role (equally weighted, no per-role variation), so they
     don't need per-role definition rows the way Pillar B's genuinely
     role-specific metrics do. kpiScoringService knows the Pillar A shape
     directly; kpi_pillar_a_reviews stores the actual per-employee scores.
   - Every FK is ON DELETE RESTRICT, per the project's "revoke, never
     delete" rule for any row with retained history. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      clickup_user_id TEXT,
      department TEXT,
      kpi_profile TEXT CHECK (kpi_profile IN ('content','artdirector','aidesigner','production','am','pandc','heads','design')),
      manager_employee_id INTEGER,
      is_people_culture INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(manager_employee_id) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_employee_id);
    CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);

    /* status models Time_off.pdf's actual two-decision-maker flow (§2):
       pending -> manager_approved (manager said yes, P&C hasn't confirmed
       yet) -> approved (P&C's final confirmation, terminal); or rejected at
       either the manager or P&C stage (terminal); or auto_rejected at
       submission time by the notice-window/WFH-quota rules (terminal); or
       cancelled by the employee before either decision (terminal). A
       manager rejection and a P&C rejection are NOT distinguished by a
       separate status — both just land on 'rejected' — since the PDF
       itself doesn't treat them as different outcomes, only different
       reasons, which auto_reject_reason/audit_log already capture. */
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      leave_type TEXT NOT NULL CHECK (leave_type IN ('planned','short_notice','sick','emergency','mental_health','public_holiday','wfh','excuse','unpaid')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      half_day INTEGER NOT NULL DEFAULT 0,
      half_day_period TEXT CHECK (half_day_period IN ('morning','afternoon') OR half_day_period IS NULL),
      handover_employee_id INTEGER,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','manager_approved','approved','rejected','auto_rejected','cancelled')),
      auto_reject_reason TEXT,
      manager_decision_by INTEGER,
      manager_decision_at TEXT,
      pc_confirmed_by INTEGER,
      pc_confirmed_at TEXT,
      salary_deduction TEXT NOT NULL DEFAULT 'none' CHECK (salary_deduction IN ('none','half_day','full_day','unpaid')),
      unpaid_days_count INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(handover_employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(manager_decision_by) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(pc_confirmed_by) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

    CREATE TABLE IF NOT EXISTS conflict_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id_a INTEGER NOT NULL,
      employee_id_b INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id_a) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(employee_id_b) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS kpi_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kpi_profile TEXT NOT NULL CHECK (kpi_profile IN ('content','artdirector','aidesigner','production','am','pandc','heads','design')),
      pillar TEXT NOT NULL CHECK (pillar IN ('quality','delivery','growth','people_retention')),
      metric_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weight_pct REAL NOT NULL,
      target_text TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN ('auto','semi','manual','goals','odoo')),
      formula_config TEXT NOT NULL DEFAULT '{}',
      effective_quarter TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(kpi_profile, metric_id, effective_quarter)
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_definitions_profile_quarter ON kpi_definitions(kpi_profile, effective_quarter);

    CREATE TABLE IF NOT EXISTS kpi_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      quarter TEXT NOT NULL,
      metric_id TEXT NOT NULL,
      actual_value TEXT,
      computed_score REAL,
      entered_by INTEGER,
      entered_at TEXT,
      source TEXT NOT NULL CHECK (source IN ('auto','semi','manual','goals','odoo')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, quarter, metric_id),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(entered_by) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_scores_employee_quarter ON kpi_scores(employee_id, quarter);

    CREATE TABLE IF NOT EXISTS kpi_pillar_a_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      quarter TEXT NOT NULL,
      communication REAL,
      collaboration REAL,
      reliability REAL,
      attitude REAL,
      contribution REAL,
      growth REAL,
      response_count INTEGER NOT NULL DEFAULT 0,
      feedback_json TEXT NOT NULL DEFAULT '[]',
      entered_by INTEGER,
      entered_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, quarter),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(entered_by) REFERENCES employees(id) ON DELETE RESTRICT
    );
  `);
}

module.exports = { up };
