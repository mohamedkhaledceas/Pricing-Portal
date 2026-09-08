/* Reusable, parameterized ClickUp metric primitives — "export methods, use
   wherever needed" (see docs/adr/0012 addendum). Every primitive takes
   list IDs / status names / tags as arguments; none of them hardcode a
   specific list, status string, or tag anywhere in this file. Callers
   (computeAutoScores, driven by kpi_auto_metric_mappings) supply the
   role/list-specific values. */
const { previousQuarter, quarterCloseTimestampUtc } = require('../../../utils/cairoQuarter');

function quarterDateRangeMs(quarter) {
  return {
    startMs: new Date(quarterCloseTimestampUtc(previousQuarter(quarter))).getTime(),
    endMs: new Date(quarterCloseTimestampUtc(quarter)).getTime(),
  };
}

function createKpiClickupMetricsService({ clickupGet, teamId, kpiClickupStatusEventRepository }) {
  // Count of transitions into `toStatus`, for one of our own employees, in
  // one quarter, restricted to the given real ClickUp list IDs. Backed by
  // kpi_clickup_status_events (forward-only, captured via webhook — see
  // docs/adr/0012 addendum for why this can't be reconstructed
  // historically from ClickUp's own API).
  function countStatusEntries({ employeeId, listIds, toStatus, quarter }) {
    return kpiClickupStatusEventRepository.countByEmployeeStatusQuarter({ employeeId, listIds, toStatus, quarter });
  }

  // Real ClickUp tasks for a real ClickUp user, restricted to the given
  // lists and a quarter's date range — the shared fetch every primitive
  // below builds on.
  async function fetchTasksInScope({ clickupUserId, listIds, quarter, extra }) {
    const { startMs, endMs } = quarterDateRangeMs(quarter);
    const params = new URLSearchParams();
    params.append('assignees[]', String(clickupUserId));
    listIds.forEach((id) => params.append('list_ids[]', String(id)));
    params.append('include_closed', 'true');
    params.append('subtasks', 'true');
    params.append('date_done_gt', String(startMs));
    params.append('date_done_lt', String(endMs));
    if (extra) Object.entries(extra).forEach(([k, v]) => params.append(k, v));
    const result = await clickupGet(`/team/${teamId}/task?${params.toString()}`);
    return result.tasks || [];
  }

  // Average cumulative time (minutes) this employee's in-scope tasks spent
  // in a given status this quarter, using ClickUp's own retroactive
  // time_in_status endpoint per task — no local storage needed, safe to
  // call for historical data. Tasks that never visited the status are
  // excluded from the average, not counted as zero (a task that skipped a
  // status entirely didn't "take 0 minutes in it" — it was never there).
  async function avgTimeInStatus({ clickupUserId, listIds, statusName, quarter }) {
    const tasks = await fetchTasksInScope({ clickupUserId, listIds, quarter });
    const samples = [];
    for (const task of tasks) {
      let result;
      try {
        result = await clickupGet(`/task/${task.id}/time_in_status`);
      } catch (error) {
        continue; // one bad task lookup shouldn't sink the whole average
      }
      const entries = [result.current_status, ...(result.status_history || [])].filter(Boolean);
      const match = entries.find((e) => e.status === statusName);
      if (match && match.total_time) samples.push(match.total_time.by_minute);
    }
    if (samples.length === 0) return null;
    return samples.reduce((sum, n) => sum + n, 0) / samples.length;
  }

  // Count of tasks closed this quarter, tagged `tag`, ending in one of
  // `closedStatuses` — "done" is a different literal status name on
  // different lists (`scheduled` vs `complete`, confirmed during
  // planning), so the caller supplies the exact set that counts as done
  // for that particular list.
  async function countClosedTasksByTag({ clickupUserId, listIds, tag, closedStatuses, quarter }) {
    const tasks = await fetchTasksInScope({ clickupUserId, listIds, quarter, extra: { 'tags[]': tag } });
    return tasks.filter((t) => closedStatuses.includes(t.status.status)).length;
  }

  // On-time rate = tasks closed on/before their due date ÷ tasks that HAD
  // a due date. Tasks with no due date are excluded from the denominator,
  // not counted as late — an unmeasurable task shouldn't silently drag
  // the rate down.
  async function dueDateOnTimeRate({ clickupUserId, listIds, quarter }) {
    const tasks = await fetchTasksInScope({ clickupUserId, listIds, quarter });
    const withDueDate = tasks.filter((t) => t.due_date);
    if (withDueDate.length === 0) return null;
    const onTime = withDueDate.filter((t) => t.date_closed && Number(t.date_closed) <= Number(t.due_date));
    return (onTime.length / withDueDate.length) * 100;
  }

  return { countStatusEntries, avgTimeInStatus, countClosedTasksByTag, dueDateOnTimeRate };
}

module.exports = createKpiClickupMetricsService;
