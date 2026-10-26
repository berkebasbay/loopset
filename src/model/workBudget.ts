import { normalizeRunLimits } from '../engine/provenance';
import type { RunLimits, RunOptions, SimulationModel } from './types';
import { assertModel } from './validate';

export interface WorkGroup { label: string; model: SimulationModel; runs: number }
export interface WorkBudget {
  minimumRuns: number; maximumRuns: number; limits: RunLimits; maximumWorkUnits: number;
  groups: { label: string; runs: number; arrivalsPerRun: number; stochastic: boolean }[];
}

/** Unstopped external arrivals in [0,horizon), including warm-up. No engine run. */
export function arrivalExpectation(model: SimulationModel): { count: number; stochastic: boolean } {
  assertModel(model);
  let count = 0; let stochastic = false;
  for (const source of model.nodes) {
    if (source.kind !== 'source') continue;
    const arrival = source.arrival;
    if (arrival.kind === 'schedule') count += arrival.times.length;
    else if (arrival.kind === 'fixed' && arrival.perHour > 0) {
      const interval = 3600 / arrival.perHour;
      let n = Math.max(1, Math.ceil(model.horizon / interval));
      // Use the engine's multiplication at the half-open horizon boundary.
      // A quotient alone can round across an integer in binary floating point.
      if (n > 0 && (n - 1) * interval >= model.horizon) n--;
      if (n * interval < model.horizon) n++;
      count += n;
    } else if (arrival.kind === 'poisson') {
      stochastic = true;
      for (const segment of arrival.segments) count += (segment.end - segment.start) * segment.perHour / 3600;
    }
  }
  return { count, stochastic };
}

/** Counts a bounded plan, not its duration, heap usage or realized event count. */
export function calculationBudget(groups: readonly WorkGroup[], options: RunOptions = {}, conditionalRuns = 0): WorkBudget {
  if (!groups.length || groups.length > 34 || groups.some(group => !Number.isSafeInteger(group.runs) || group.runs < 1 || group.runs > 1000)) throw new Error('Use a bounded plan with 1–1,000 calculations per group.');
  const maximumRuns = groups.reduce((sum, group) => sum + group.runs, 0);
  if (maximumRuns > 1000 || !Number.isSafeInteger(conditionalRuns) || conditionalRuns < 0 || conditionalRuns >= maximumRuns) throw new Error('The calculation plan must contain 1–1,000 runs and a valid conditional count.');
  const limits = normalizeRunLimits(options);
  return {
    minimumRuns: maximumRuns - conditionalRuns, maximumRuns, limits, maximumWorkUnits: maximumRuns * limits.maxEvents,
    groups: groups.map(group => { const arrival = arrivalExpectation(group.model); return { label: group.label, runs: group.runs, arrivalsPerRun: arrival.count, stochastic: arrival.stochastic }; }),
  };
}
