import type { WorkBudget } from '../model/workBudget';
import './calculationBudget.css';

const count = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 2 });
export function CalculationBudget({ budget }: { budget: WorkBudget }) {
  const { limits, minimumRuns, maximumRuns } = budget;
  return <section className="calculation-budget" aria-label="Calculation work and limits">
    <p className="budget-plan"><strong>{minimumRuns === maximumRuns ? count(maximumRuns) : `${count(minimumRuns)}–${count(maximumRuns)}`} model {maximumRuns === 1 ? 'run' : 'runs'}</strong>{minimumRuns !== maximumRuns && <span>Held-out runs happen only if a training candidate is selected.</span>}</p>
    <table><caption>Arrival workload before execution limits</caption><thead><tr><th>Plan</th><th>Runs</th><th>Arrivals per run</th></tr></thead><tbody>{budget.groups.map((group, index) => <tr key={index}><th>{group.label}</th><td>{count(group.runs)}</td><td>{group.stochastic ? '≈ ' : ''}{count(group.arrivalsPerRun)}{group.stochastic ? ' expected' : ' scheduled'}</td></tr>)}</tbody></table>
    <p>Includes warm-up arrivals. Random arrivals can differ; paths, queues and repeated visits determine event work. A limit or cancellation can stop a run earlier.</p>
    <details open><summary>Limits for each model run</summary><dl>
      <div><dt>Work units · events and transitions</dt><dd>{count(limits.maxEvents)}</dd></div>
      <div><dt>External arrivals</dt><dd>{count(limits.maxEntities)}</dd></div>
      <div><dt>Transitions at one timestamp</dt><dd>{count(limits.maxMicrosteps)}</dd></div>
      <div><dt>Retained replay entities</dt><dd>{count(limits.maxTraceEntities)}</dd></div>
      <div><dt>Retained replay events</dt><dd>{count(limits.maxTraceEvents)}</dd></div>
    </dl><p>At most {count(budget.maximumWorkUnits)} work units across the largest plan. Zero is a literal limit. Replay retention is separate from numerical results.</p></details>
    <p>These counts do not predict duration or guarantee total memory use. Calculations can be cancelled.</p>
    <p className="budget-recovery">If a run reaches a limit, inspect its incomplete attempt, reduce arrivals or the horizon, or simplify looping routes, then run again. Fewer repetitions reduce total work; they do not raise a per-run limit.</p>
  </section>;
}
