import { experimentPlanMessages as m } from '../ui/messages/experimentPlan';
import { capacitySearchPlan } from '../experiments';
import { calculationBudget } from '../model/workBudget';
import type { RunResult, SimulationModel } from '../model/types';
import { experimentEnvelope, readExperimentRequest } from '../worker/protocol';
import type { ExperimentKind, ExperimentRequest } from '../worker/protocol';

interface Settings {
  kind: ExperimentKind; model: SimulationModel; baseline: RunResult | null;
  count: number; firstSeed: number; poolId: string; capacities: string; target: string; maxWait: string;
}

/** The visible preflight and submitted request use the same validated plan. */
export function prepareExperiment(settings: Settings) {
  const { kind, model, baseline, count, firstSeed, poolId, capacities, target, maxWait } = settings;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error(m.invalidRunCount);
  const seeds = Array.from({ length: count }, (_, i) => firstSeed + i);
  if (seeds.some(seed => !Number.isSafeInteger(seed))) throw new Error(m.replicationSeedsMustBeSafeIntegers);
  const envelope = { ...experimentEnvelope('preflight', kind), type: 'run' as const };
  let request: ExperimentRequest;
  if (kind === 'replications') request = { ...envelope, kind, model, seeds };
  else if (kind === 'paired') {
    if (!baseline) throw new Error(m.createABaselineRunFirst);
    request = { ...envelope, kind, baseline: baseline.model, model, seeds };
  } else {
    if (!capacities.trim() || capacities.split(',').some(value => !value.trim())) throw new Error(m.enterCommaSeparatedIntegerCapacitiesWithoutEmptyValues);
    request = { ...envelope, kind, model, spec: { poolId, capacities: capacities.split(',').map(value => Number(value.trim())), trainingSeeds: seeds,
      verificationSeeds: Array.from({ length: count }, (_, i) => firstSeed + 1_000_000 + i), maxRuns: 256,
      targetCompleted: target.trim() ? Number(target) : undefined, maxMeanWait: maxWait.trim() ? Number(maxWait) : undefined } };
    capacitySearchPlan(model, request.spec);
  }
  readExperimentRequest(request);
  const groups = request.kind === 'paired'
    ? [{ label: m.baseline, model: request.baseline, runs: count }, { label: m.candidate, model, runs: count }]
    : request.kind === 'search'
      ? [{ label: m.trainingCandidates, model, runs: count * request.spec.capacities.length }, { label: m.heldOutVerificationIfSelected, model, runs: count }]
      : [{ label: m.independentReplications, model, runs: count }];
  const budget = calculationBudget(groups, { maxTraceEntities: 0, maxTraceEvents: 0 }, request.kind === 'search' ? count : 0);
  return { request, budget };
}
