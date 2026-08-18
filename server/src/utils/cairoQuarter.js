/* Genuinely cross-module: db.js's own generated columns (origin_quarter,
   event_quarter) need cairoQuarterExpr for their SQL, and it isn't owned by
   any one module — db.js sits below the module layer entirely. The
   commercial-leads module also needs all three functions here for its own
   quarter-metric queries and the freeze job. This is the first real
   occupant of utils/ (previously empty on purpose — see docs/adr/0002 for
   why jwt/hash went into modules/auth/ instead of here); this one qualifies
   because two things outside any single module's ownership both need it,
   which is exactly the bar utils/ was reserved for.

   Single source of truth for Cairo-local calendar-quarter math. Two
   related but genuinely different operations live here: cairoQuarterExpr()
   classifies an arbitrary timestamp into its quarter (used inside SQL
   queries/generated columns), while quarterCloseTimestampUtc() computes the
   boundary instant a given quarter closes at (needed as a bound parameter,
   not something a generated column can produce). Both apply the same DST
   approximation, so they're kept in the same file and cross-checked against
   each other in this module's verification rather than risking silent
   divergence between two unrelated files. See
   docs/commercial-lead-quarterly-kpis-plan.md §5 for the full derivation
   and docs/adr/0010-commercial-lead-quarterly-kpis.md for why a fixed
   month-range approximation of Egypt's actual DST rule (Law No. 24/2023) is
   safe for quarter classification specifically. Relocated from the old
   commercialLeadQuarter.js unchanged. */

function cairoQuarterExpr(column) {
  const offset = `(CASE WHEN CAST(strftime('%m', ${column}) AS INTEGER) BETWEEN 5 AND 10 THEN '+3 hours' ELSE '+2 hours' END)`;
  const local = `datetime(${column}, ${offset})`;
  return `strftime('%Y', ${local}) || '-Q' || ((CAST(strftime('%m', ${local}) AS INTEGER) - 1) / 3 + 1)`;
}

/* The UTC instant a given 'YYYY-Qn' quarter CLOSES at — the next quarter's
   local midnight, converted to UTC using the same fixed-offset
   approximation as cairoQuarterExpr (safe for the same reason: the next
   quarter's first month is always either solidly inside or solidly outside
   Egypt's real DST window, never in the narrow transition week). */
function quarterCloseTimestampUtc(quarter) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Invalid quarter string: ${quarter}`);
  const year = Number(match[1]);
  const q = Number(match[2]);
  const nextQuarterStartMonth = [4, 7, 10, 1][q - 1]; // 1-indexed calendar month
  const nextQuarterYear = q === 4 ? year + 1 : year;
  const offsetHours = nextQuarterStartMonth >= 5 && nextQuarterStartMonth <= 10 ? 3 : 2;
  const localMidnightAsUtcMs = Date.UTC(nextQuarterYear, nextQuarterStartMonth - 1, 1, 0, 0, 0);
  return new Date(localMidnightAsUtcMs - offsetHours * 3600 * 1000).toISOString();
}

/* The quarter immediately before the given one — used by the freeze job to
   turn "what quarter is it right now" (evaluated exactly at a quarter
   boundary, so it's already the NEW quarter) into "which quarter just
   closed". */
function previousQuarter(quarter) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Invalid quarter string: ${quarter}`);
  const year = Number(match[1]);
  const q = Number(match[2]);
  return q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
}

module.exports = { cairoQuarterExpr, quarterCloseTimestampUtc, previousQuarter };
