const { EmployeesError } = require('../errors');
const { pillarAScore } = require('./pillarAScore');
const { quarterCloseTimestampUtc, previousQuarter } = require('../../../utils/cairoQuarter');

// Every dimension a stored answer can carry — 'growth' only on quarters
// before it was dropped from the form (2026-09-28).
const DIMENSION_KEYS = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
// What the form asks today: each is required when the reviewer rates someone.
const ASKED_KEYS = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution'];
const MAX_COMMENT_LENGTH = 2000;
const DEFAULT_WINDOW_DAYS_BEFORE_CLOSE = 14;

function createKpiPeerReviewService({
  employeeRepository, pillarAReviewRepository, kpiPeerReviewRepository, kpiReviewWindowRepository, transaction, audit, roles,
}) {
  // A configured row always wins; otherwise a computed suggestion (opens
  // 14 days before quarter close, closes at quarter close) — marked
  // `configured: false` so the UI can show it's only a default, and
  // P&C/admin can override it per the confirmed "shiftable, not fixed"
  // decision.
  function getWindow(quarter) {
    const row = kpiReviewWindowRepository.findByQuarter(quarter);
    if (row) return { quarter, opensAt: row.opens_at, closesAt: row.closes_at, configured: true };

    const closesAt = quarterCloseTimestampUtc(quarter);
    const opensAt = new Date(new Date(closesAt).getTime() - DEFAULT_WINDOW_DAYS_BEFORE_CLOSE * 24 * 3600 * 1000).toISOString();
    return { quarter, opensAt, closesAt, configured: false };
  }

  function setWindow({ quarter, opensAt, closesAt, actorAuthRole, actorEmployee, actorId, ip }) {
    if (actorAuthRole !== roles.PEOPLE_CULTURE && actorAuthRole !== roles.ADMIN) {
      throw new EmployeesError('You do not have permission to set the review window.', 403);
    }
    const opens = new Date(opensAt);
    const closes = new Date(closesAt);
    if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime()) || opens >= closes) {
      throw new EmployeesError('opensAt must be a valid date before closesAt.');
    }
    const result = kpiReviewWindowRepository.upsert({
      quarter, opensAt: opens.toISOString(), closesAt: closes.toISOString(),
      setBy: actorEmployee ? actorEmployee.id : null,
    });
    // audit_log.user_id is a users.id — the employee id here used to fail
    // the foreign key (entry lost) or name the wrong person.
    audit.record({
      userId: actorId,
      action: 'kpi.review_window.set',
      entityType: 'kpi_review_window',
      entityId: quarter,
      details: { quarter, opensAt: opens.toISOString(), closesAt: closes.toISOString() },
      ip,
    });
    return result;
  }

  function isWindowOpen(quarter) {
    const window = getWindow(quarter);
    const now = Date.now();
    return now >= new Date(window.opensAt).getTime() && now <= new Date(window.closesAt).getTime();
  }

  // Pillar A scores and the results report stay hidden until this is true
  // (user decision 2026-10-07): revealing them while reviews still arrive
  // would let someone see what one colleague gave them.
  function isWindowClosed(quarter) {
    return Date.now() > new Date(getWindow(quarter).closesAt).getTime();
  }

  // Everyone else active, each flagged with whether this reviewer has
  // already submitted for them this quarter — "everyone reviews everyone"
  // per the confirmed decision, no work-relationship filter.
  function getRoster({ actorEmployee, quarter }) {
    if (!actorEmployee) return [];
    const alreadyReviewed = new Set(kpiPeerReviewRepository.findRevieweeIdsByReviewer(actorEmployee.id, quarter));
    return employeeRepository.findAllActive()
      .filter((e) => e.id !== actorEmployee.id)
      .map((e) => ({
        employeeId: e.id,
        firstName: e.user_first_name,
        lastName: e.user_last_name,
        department: e.department,
        kpiProfile: e.kpi_profile,
        alreadyReviewed: alreadyReviewed.has(e.id),
      }));
  }

  // Recomputes reviewee's aggregate live into kpi_pillar_a_reviews —
  // reusing the exact shape enterPillarAReview already writes, so every
  // existing consumer (breakdown, status bands, history, team summary)
  // needs zero changes to read peer-review-sourced Pillar A. No minimum-
  // response-count gate, per the confirmed decision.
  function recomputeAggregate(revieweeEmployeeId, quarter) {
    const responses = kpiPeerReviewRepository.findAnswersByReviewee(revieweeEmployeeId, quarter).filter((r) => r.worked_with);
    const averages = {};
    for (const key of DIMENSION_KEYS) {
      const values = responses.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
      averages[key] = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
    }
    const feedback = responses.map((r) => r.comment).filter(Boolean);

    pillarAReviewRepository.upsert({
      employeeId: revieweeEmployeeId,
      quarter,
      ...averages,
      responseCount: responses.length,
      feedback,
      // No individual reviewer is ever attributed as "enteredBy" for a
      // peer-sourced aggregate — this field means "who typed this in
      // manually" (P&C, via enterPillarAReview) and stays null for a
      // system-recomputed row, which is itself a signal (in the UI) that
      // this came from live peer submissions, not a manual override.
      enteredBy: null,
    });
  }

  /* One reviewer's answer about one colleague — once only: a submitted
     review can't be changed (user decision 2026-10-07). Who submitted and
     what they said are written to two separate tables (migration 046), in
     one transaction with the reviewee's recomputed Pillar A. */
  function submitReview({ reviewerEmployeeId, revieweeEmployeeId, quarter, workedWith, dimensions, comment, actorEmployee, actorId, ip }) {
    if (!actorEmployee || actorEmployee.id !== reviewerEmployeeId) {
      throw new EmployeesError('You can only submit your own reviews.', 403);
    }
    if (reviewerEmployeeId === revieweeEmployeeId) {
      throw new EmployeesError('You cannot review yourself.');
    }
    const reviewee = employeeRepository.findById(revieweeEmployeeId);
    if (!reviewee || !reviewee.active) {
      throw new EmployeesError('Employee not found.', 404);
    }
    if (typeof quarter !== 'string' || !quarter) {
      throw new EmployeesError('quarter is required.');
    }
    if (!isWindowOpen(quarter)) {
      throw new EmployeesError('The peer review window is not currently open for this quarter.', 403);
    }
    const text = typeof comment === 'string' ? comment.trim() : '';
    if (text.length > MAX_COMMENT_LENGTH) {
      throw new EmployeesError(`The comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`);
    }
    const scores = {};
    if (workedWith) {
      for (const key of ASKED_KEYS) {
        const v = dimensions[key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) {
          throw new EmployeesError(`${key} must be a number from 0 to 10.`);
        }
        scores[key] = v;
      }
      if (!text) throw new EmployeesError('A comment is required for every colleague you rate.');
    }
    if (kpiPeerReviewRepository.hasSubmitted(reviewerEmployeeId, revieweeEmployeeId, quarter)) {
      throw new EmployeesError('You have already submitted your review of this colleague — it can\'t be changed.', 409);
    }

    let submissionId;
    try {
      transaction(() => {
        submissionId = kpiPeerReviewRepository.insertSubmission({ reviewerEmployeeId, revieweeEmployeeId, quarter });
        kpiPeerReviewRepository.insertAnswer({
          revieweeEmployeeId, quarter, workedWith, ...scores, comment: text || null,
        });
        recomputeAggregate(revieweeEmployeeId, quarter);
      });
    } catch (error) {
      // Two tabs submitting at once: the UNIQUE constraint is the real guard.
      if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new EmployeesError('You have already submitted your review of this colleague — it can\'t be changed.', 409);
      }
      throw error;
    }

    // Who submitted for whom, never what they answered — the answer row
    // has no reviewer and this entry carries none of its content.
    audit.record({
      userId: actorId,
      action: 'kpi.peer_review.submit',
      entityType: 'kpi_peer_review_submission',
      entityId: String(submissionId),
      details: { quarter, revieweeEmployeeId },
      ip,
    });

    return { id: submissionId, revieweeEmployeeId, quarter };
  }

  // How many active employees have finished their full set of reviews out
  // of how many total, e.g. "27/33" — getSubmissionCounter (CEO-only).
  function computeCompletion(quarter) {
    const employees = employeeRepository.findAllActive();
    const expectedPerPerson = Math.max(0, employees.length - 1);
    const completed = expectedPerPerson === 0 ? 0 : employees.filter((e) => {
      const submitted = kpiPeerReviewRepository.findRevieweeIdsByReviewer(e.id, quarter).length;
      return submitted >= expectedPerPerson;
    }).length;
    return { completed, total: employees.length };
  }

  // CEO-only, company-wide participation number — never who, never
  // content, per the confirmed anonymity decision (2026-09-28) that killed
  // the old per-employee completion table entirely. Gated on the auth role
  // itself, not on being a specific employee's manager.
  function getSubmissionCounter({ quarter, actorAuthRole }) {
    if (actorAuthRole !== roles.CEO) {
      throw new EmployeesError('You do not have permission to view this.', 403);
    }
    return computeCompletion(quarter);
  }

  const RESULT_ROLES = () => [roles.CEO, roles.PEOPLE_CULTURE, roles.ADMIN];

  // CEO, P&C and admin: whether the results can be read yet — a boolean
  // only, never the participation counts getSubmissionCounter returns.
  function getReportReadiness({ quarter, actorAuthRole }) {
    if (!RESULT_ROLES().includes(actorAuthRole)) {
      throw new EmployeesError('You do not have permission to view this.', 403);
    }
    return { ready: isWindowClosed(quarter) };
  }

  // The real gate behind getReviewResults/exportReviewResultsCsv — the
  // frontend hiding the button is a convenience. Results open when the
  // review window closes (user decision 2026-10-07), the same moment every
  // employee's own Pillar A appears.
  function requireReviewCycleComplete(quarter, actorAuthRole) {
    if (!RESULT_ROLES().includes(actorAuthRole)) {
      throw new EmployeesError('You do not have permission to view this.', 403);
    }
    if (!isWindowClosed(quarter)) {
      throw new EmployeesError('The team review results open when the review window closes.', 403);
    }
  }

  // CEO, P&C and admin, once the window has closed: every active
  // employee's averages, Pillar A out of 60, and the comments written about
  // them — never who wrote them (the answers table has no reviewer), and
  // never the comments about the viewer themselves (user decision
  // 2026-10-07). A pure read of kpi_pillar_a_reviews, which
  // recomputeAggregate keeps current.
  function getReviewResults({ quarter, actorAuthRole, actorEmployeeId = null }) {
    requireReviewCycleComplete(quarter, actorAuthRole);
    const employees = employeeRepository.findAllActive();
    const reviewsByEmployeeId = new Map(pillarAReviewRepository.findAllForQuarter(quarter).map((r) => [r.employee_id, r]));
    return employees
      .map((e) => {
        const r = reviewsByEmployeeId.get(e.id);
        return {
          employeeId: e.id,
          name: `${e.user_first_name || ''} ${e.user_last_name || ''}`.trim() || `Employee #${e.id}`,
          collaboration: r ? r.collaboration : null,
          communication: r ? r.communication : null,
          reliability: r ? r.reliability : null,
          attitude: r ? r.attitude : null,
          contribution: r ? r.contribution : null,
          pillarA: r ? pillarAScore(r) : null,
          responseCount: r ? r.response_count : 0,
          feedback: r && e.id !== actorEmployeeId ? JSON.parse(r.feedback_json || '[]') : [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Wraps a value in quotes and doubles any embedded quotes whenever it
  // contains a comma, quote, or newline — same escaping dealsService.js's
  // csvEscape uses; duplicated here rather than shared across modules per
  // this codebase's own stated convention (see departmentService.js's
  // comment on small per-service copies over a cross-service helper).
  function csvEscape(value) {
    const str = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function formatAverage(value) {
    return value === null || value === undefined ? '' : value.toFixed(1);
  }

  // CSV export of exactly what getReviewResults returns — same gate.
  function exportReviewResultsCsv({ quarter, actorAuthRole, actorEmployeeId = null }) {
    const rows = getReviewResults({ quarter, actorAuthRole, actorEmployeeId });
    const header = ['Name', 'Collaboration', 'Communication', 'Reliability', 'Positive Attitude', 'Contribution to Team Success', 'Pillar A (of 60)', 'Responses', 'Overall Performance Feedback'];
    const lines = [header.map(csvEscape).join(',')];
    rows.forEach((r) => {
      const line = [
        r.name,
        formatAverage(r.collaboration),
        formatAverage(r.communication),
        formatAverage(r.reliability),
        formatAverage(r.attitude),
        formatAverage(r.contribution),
        formatAverage(r.pillarA),
        r.responseCount,
        r.feedback.join('\n'),
      ];
      lines.push(line.map(csvEscape).join(','));
    });
    // CRLF — the CSV-standard line ending (matches dealsService.js's own
    // export, and what makes Excel on Windows treat every row correctly).
    return lines.join('\r\n');
  }

  // Any team head (an employee with direct reports) sees this same
  // participation number scoped to just the people who report to them,
  // e.g. "4/8" — distinct from getSubmissionCounter's company-wide number
  // and not gated by auth role, since "manages people" is a fact about the
  // employee record (manager_employee_id), not the account's role. Returns
  // null for anyone with no direct reports so the frontend can hide it
  // rather than showing a meaningless 0/0.
  function getMyTeamSubmissionCounter({ actorEmployee, quarter }) {
    if (!actorEmployee) return null;
    const reports = employeeRepository.findByManagerId(actorEmployee.id).filter((e) => e.active);
    if (reports.length === 0) return null;
    const expectedPerPerson = Math.max(0, employeeRepository.findAllActive().length - 1);
    const completed = expectedPerPerson === 0 ? 0 : reports.filter((e) => {
      const submitted = kpiPeerReviewRepository.findRevieweeIdsByReviewer(e.id, quarter).length;
      return submitted >= expectedPerPerson;
    }).length;
    return { completed, total: reports.length };
  }

  // Any role with an employee profile — "do I still have pending team
  // reviews to submit this quarter", for the Overview warning. Not
  // permission-gated beyond having a profile at all, since this is only
  // ever the caller's own status.
  function getMyStatus({ actorEmployee, quarter }) {
    if (!actorEmployee) return { open: false, submitted: 0, expected: 0 };
    const open = isWindowOpen(quarter);
    const expected = Math.max(0, employeeRepository.findAllActive().length - 1);
    const submitted = kpiPeerReviewRepository.findRevieweeIdsByReviewer(actorEmployee.id, quarter).length;
    return { open, submitted, expected };
  }

  return {
    getWindow,
    setWindow,
    isWindowOpen,
    isWindowClosed,
    getRoster,
    submitReview,
    getSubmissionCounter,
    getMyTeamSubmissionCounter,
    getMyStatus,
    getReportReadiness,
    getReviewResults,
    exportReviewResultsCsv,
  };
}

module.exports = createKpiPeerReviewService;
