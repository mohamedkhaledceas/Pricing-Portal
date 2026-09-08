const { EmployeesError } = require('../errors');
const { quarterCloseTimestampUtc, previousQuarter } = require('../../../utils/cairoQuarter');

const DIMENSION_KEYS = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
const DEFAULT_WINDOW_DAYS_BEFORE_CLOSE = 14;

function createKpiPeerReviewService({
  employeeRepository, pillarAReviewRepository, kpiPeerReviewRepository, kpiReviewWindowRepository, audit, roles,
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

  function setWindow({ quarter, opensAt, closesAt, actorAuthRole, actorEmployee, ip }) {
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
    audit.record({
      userId: actorEmployee ? actorEmployee.id : null,
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
    const responses = kpiPeerReviewRepository.findByReviewee(revieweeEmployeeId, quarter).filter((r) => r.worked_with);
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

  function submitReview({ reviewerEmployeeId, revieweeEmployeeId, quarter, workedWith, dimensions, comment, actorEmployee, actorId, ip }) {
    if (!actorEmployee || actorEmployee.id !== reviewerEmployeeId) {
      throw new EmployeesError('You can only submit your own reviews.', 403);
    }
    if (reviewerEmployeeId === revieweeEmployeeId) {
      throw new EmployeesError('You cannot review yourself.');
    }
    if (!employeeRepository.findById(revieweeEmployeeId)) {
      throw new EmployeesError('Employee not found.', 404);
    }
    if (!isWindowOpen(quarter)) {
      throw new EmployeesError('The peer review window is not currently open for this quarter.', 403);
    }
    if (workedWith) {
      for (const key of DIMENSION_KEYS) {
        const v = dimensions[key];
        if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0 || v > 10)) {
          throw new EmployeesError(`${key} must be a number from 0 to 10.`);
        }
      }
    }

    const response = kpiPeerReviewRepository.upsert({
      reviewerEmployeeId, revieweeEmployeeId, quarter, workedWith,
      communication: dimensions.communication, collaboration: dimensions.collaboration,
      reliability: dimensions.reliability, attitude: dimensions.attitude,
      contribution: dimensions.contribution, growth: dimensions.growth,
      comment,
    });

    recomputeAggregate(revieweeEmployeeId, quarter);

    // Audited without score content — the anonymity guarantee is about
    // what other employees/P&C can see through the app's normal read
    // paths, not the admin-only audit log (which already has broad
    // visibility into every other significant action in this app). Who
    // submitted a review, when, and for whom is fair audit material;
    // what they actually scored is not recorded here.
    audit.record({
      userId: actorId,
      action: 'kpi.peer_review.submit',
      entityType: 'kpi_peer_review_response',
      entityId: String(response.id),
      details: { quarter, revieweeEmployeeId, workedWith },
      ip,
    });

    return response;
  }

  // P&C-only: who has/hasn't submitted, and how many reviews each active
  // employee has received — counts only, never content. Same anonymity
  // boundary submitReview's own comment documents.
  function getCompletion({ quarter, actorAuthRole }) {
    if (actorAuthRole !== roles.PEOPLE_CULTURE && actorAuthRole !== roles.ADMIN) {
      throw new EmployeesError('You do not have permission to view review completion.', 403);
    }
    const employees = employeeRepository.findAllActive();
    const receivedCounts = new Map(kpiPeerReviewRepository.countReviewersByReviewee(quarter).map((r) => [r.reviewee_employee_id, r.n]));
    const totalReviewers = employees.length - 1;

    return employees.map((e) => {
      const submitted = kpiPeerReviewRepository.findRevieweeIdsByReviewer(e.id, quarter).length;
      return {
        employeeId: e.id,
        firstName: e.user_first_name,
        lastName: e.user_last_name,
        reviewsSubmitted: submitted,
        reviewsExpected: totalReviewers,
        reviewsReceived: receivedCounts.get(e.id) || 0,
      };
    });
  }

  // Manager/P&C-role, company-wide participation number — deliberately
  // less detailed than getCompletion (P&C's per-employee breakdown): just
  // how many employees have finished their full set of reviews out of
  // how many total, e.g. "27/33". Gated on the auth role itself, not on
  // being a specific employee's manager.
  function getSubmissionCounter({ quarter, actorAuthRole }) {
    if (actorAuthRole !== roles.MANAGER && actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to view this.', 403);
    }
    const employees = employeeRepository.findAllActive();
    const expectedPerPerson = Math.max(0, employees.length - 1);
    const completed = expectedPerPerson === 0 ? 0 : employees.filter((e) => {
      const submitted = kpiPeerReviewRepository.findRevieweeIdsByReviewer(e.id, quarter).length;
      return submitted >= expectedPerPerson;
    }).length;
    return { completed, total: employees.length };
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
    getWindow, setWindow, isWindowOpen, getRoster, submitReview, getCompletion, getSubmissionCounter, getMyTeamSubmissionCounter, getMyStatus,
  };
}

module.exports = createKpiPeerReviewService;
