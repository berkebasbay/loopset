import { calculationBudgetMessages as m } from '../ui/messages/CalculationBudget';
import type { WorkBudget } from '../model/workBudget';
import './calculationBudget.css';

const count = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 2 });
export function CalculationBudget({ budget }: { budget: WorkBudget }) {
  const { limits, minimumRuns, maximumRuns } = budget;
  return <section className="calculation-budget" aria-label={m.calculationWorkAndLimits}>
    <p className="budget-plan"><strong>{m.plannedRuns(count(minimumRuns), count(maximumRuns), maximumRuns)}</strong>{minimumRuns !== maximumRuns && <span>{m.heldOutRunsHappenOnlyIfATrainingCandidate}</span>}</p>
    <table><caption>{m.arrivalWorkloadBeforeExecutionLimits}</caption><thead><tr><th>{m.plan}</th><th>{m.runs}</th><th>{m.arrivalsPerRun}</th></tr></thead><tbody>{budget.groups.map((group, index) => <tr key={index}><th>{group.label}</th><td>{count(group.runs)}</td><td>{m.arrivalWorkload(count(group.arrivalsPerRun), group.stochastic)}</td></tr>)}</tbody></table>
    <p>{m.includesWarmUpArrivalsRandomArrivalsCanDifferPaths}</p>
    <details open><summary>{m.limitsForEachModelRun}</summary><dl>
      <div><dt>{m.workUnitsEventsAndTransitions}</dt><dd>{count(limits.maxEvents)}</dd></div>
      <div><dt>{m.externalArrivals}</dt><dd>{count(limits.maxEntities)}</dd></div>
      <div><dt>{m.transitionsAtOneTimestamp}</dt><dd>{count(limits.maxMicrosteps)}</dd></div>
      <div><dt>{m.retainedReplayEntities}</dt><dd>{count(limits.maxTraceEntities)}</dd></div>
      <div><dt>{m.retainedReplayEvents}</dt><dd>{count(limits.maxTraceEvents)}</dd></div>
    </dl><p>{m.maximumWork(count(budget.maximumWorkUnits))}</p></details>
    <p>{m.theseCountsDoNotPredictDurationOrGuaranteeTotal}</p>
    <p className="budget-recovery">{m.ifARunReachesALimitInspectItsIncomplete}</p>
  </section>;
}
