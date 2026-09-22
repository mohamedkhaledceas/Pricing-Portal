import { setOut, flushOut, setRecomputeHandler } from './dom.js';
import { S } from './state.js';
import { disp } from './format.js';
import { computeTeamOutputs } from './team.js';
import { computeExpenseOutputs } from './expenses.js';
import { computeCurrentProjectOutputs } from './projects.js';
import { computeScenarioOutputs } from './scenarios.js';
import { computeQuoteOutputs } from './quote.js';
import { computeDashboardOutputs } from './dashboard.js';
import { renderCapacity } from './capacity.js';

/* Orchestrates the single global recalculation every tab's edit handlers
   trigger (see dom.js's recompute() dispatcher for why this can't just be
   imported directly by tab files). This is the final stage of the refactor
   — every compute slice is now wired in, in the same order the original
   single recompute() function computed them (renderCapacity() runs last,
   unconditionally, same as the original). */
function runRecompute() {
  setOut('cur.disp', '(' + disp() + ')');
  setOut('cur.base', S().currency);
  computeTeamOutputs();
  computeExpenseOutputs();
  computeDashboardOutputs();
  computeCurrentProjectOutputs();
  computeScenarioOutputs();
  computeQuoteOutputs();
  renderCapacity();
  flushOut();
}

setRecomputeHandler(runRecompute);
