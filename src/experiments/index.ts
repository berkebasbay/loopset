import type { ExperimentResult, MetricEstimate, PairedComparison, RunOptions, RunResult, SimulationModel } from '../model/types';
import { modelHash } from '../model/identity';
import { assertModel } from '../model/validate';
import { buildCouplingManifest, simulate, simulateAsync } from '../engine';

// Two-sided 95% Student-t critical values, df 1–30. Above 30 use the explicit
// Cornish-Fisher expansion through 1/df³ (documented approximation).
const t95 = [0, 12.706204736, 4.30265273, 3.182446305, 2.776445105, 2.570581836, 2.446911851, 2.364624252, 2.306004135, 2.262157163, 2.228138852, 2.20098516, 2.17881283, 2.160368656, 2.144786688, 2.131449546, 2.119905299, 2.109815578, 2.10092204, 2.093024054, 2.085963447, 2.079613845, 2.073873068, 2.06865761, 2.063898562, 2.059538553, 2.055529439, 2.051830516, 2.048407142, 2.045229642, 2.042272456];
function critical(df: number): number {
  if (df <= 30) return t95[df];
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

export function estimate(values: readonly number[]): MetricEstimate {
  if (values.some(x => !Number.isFinite(x))) throw new Error('An estimate requires finite observations.');
  const samples = values.length;
  const mean = samples ? values.reduce((a, b) => a + b, 0) / samples : 0;
  if (samples < 2) return { mean, standardError: null, lower95: null, upper95: null, samples };
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (samples - 1);
  const standardError = Math.sqrt(variance / samples); const margin = critical(samples - 1) * standardError;
  return { mean, standardError, lower95: mean - margin, upper95: mean + margin, samples };
}

function validateSeeds(seeds: readonly number[]) {
  if (!seeds.length || seeds.length > 100 || seeds.some(s => !Number.isSafeInteger(s)) || new Set(seeds).size !== seeds.length) throw new Error('Use 1–100 distinct safe-integer replication seeds.');
}

function completedRun(run: RunResult) {
  if (run.status !== 'completed') throw new Error(`Replication ${run.seed} is ${run.status}: ${run.reason ?? 'incomplete run'}. It cannot enter an estimate.`);
}

function summarize(model: SimulationModel, seeds: readonly number[], runs: RunResult[]): ExperimentResult {
  runs.forEach(completedRun);
  const measuredWaits = runs.filter(r => r.summary.waitSampleSize > 0);
  return { modelHash: modelHash(model), seeds: [...seeds], runs,
    completed: estimate(runs.map(r => r.summary.completed)), wait: estimate(measuredWaits.map(r => r.summary.meanWait)),
    p95Wait: estimate(measuredWaits.map(r => r.summary.p95Wait)), cost: estimate(runs.map(r => r.summary.cost)),
  };
}

const experimentOptions = (options: RunOptions, seed: number): RunOptions => ({ maxTraceEntities: 0, maxTraceEvents: 0, ...options, seed });

// One shared snapshot per candidate survives structuredClone/postMessage without
// duplicating empirical samples for every replication. The wire-size budget is
// explicit; it is an allocation guard, not a claim about browser heap/GPU bytes.
const RETAINED_BYTES = 32 * 1024 * 1024;
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeSnapshot(child); Object.freeze(value); }
  return value;
}
class RetentionBudget {
  private used = 0;
  private snapshots = new WeakMap<SimulationModel, SimulationModel>();
  check(bytes: number) { if (this.used + bytes > RETAINED_BYTES) throw new Error('Experiment exceeds the 32 MiB retained-result budget. Reduce candidates, replications, input samples or explicit trace retention. No partial estimate was accepted.'); }
  retain(value: unknown) { const bytes = encodedBytes(value); this.check(bytes); this.used += bytes; }
  snapshot(model: SimulationModel) {
    const existing = this.snapshots.get(model); if (existing) return existing;
    this.retain(model); const snapshot = freezeSnapshot(structuredClone(model));
    this.snapshots.set(model, snapshot); this.snapshots.set(snapshot, snapshot); return snapshot;
  }
  run(run: RunResult, snapshot: SimulationModel) {
    completedRun(run); this.retain({ ...run, model: undefined }); run.model = snapshot; return run;
  }
}

function replications(model: SimulationModel, seeds: readonly number[], options: RunOptions, budget: RetentionBudget): ExperimentResult {
  assertModel(model); validateSeeds(seeds); const snapshot = budget.snapshot(model); const runs: RunResult[] = [];
  for (const seed of seeds) runs.push(budget.run(simulate(snapshot, experimentOptions(options, seed)), snapshot));
  return summarize(snapshot, seeds, runs);
}

/** Independent replications, each with its own keyed seed; executed sequentially. */
export function runExperiment(model: SimulationModel, seeds: readonly number[], options: RunOptions = {}): ExperimentResult {
  return replications(model, seeds, options, new RetentionBudget());
}

export async function runExperimentAsync(model: SimulationModel, seeds: readonly number[], options: RunOptions = {}): Promise<ExperimentResult> {
  assertModel(model); validateSeeds(seeds); const runs: RunResult[] = []; const budget = new RetentionBudget(); const snapshot = budget.snapshot(model);
  for (const seed of seeds) {
    const run = await simulateAsync(snapshot, experimentOptions(options, seed)); runs.push(budget.run(run, snapshot));
  }
  return summarize(snapshot, seeds, runs);
}

export function comparePaired(baselineModel: SimulationModel, candidateModel: SimulationModel, seeds: readonly number[], options: RunOptions = {}): PairedComparison {
  const budget = new RetentionBudget();
  budget.check(encodedBytes(baselineModel) + encodedBytes(candidateModel));
  const baseline = replications(baselineModel, seeds, options, budget); const candidate = replications(candidateModel, seeds, options, budget);
  const coupling = buildCouplingManifest(baseline.runs[0], candidate.runs[0]); budget.retain(coupling);
  const paired = coupling.compatibility.sameMeasurementPolicies && baseline.runs.every((r, i) => r.demandHash === candidate.runs[i].demandHash);
  if (!paired) return { paired, reason: 'External demand fingerprints or measurement/currency policies differ; paired deltas are unavailable.', baseline, candidate, coupling, delta: { completed: estimate([]), wait: estimate([]), cost: estimate([]) } };
  const measuredPairs = candidate.runs.flatMap((r, i) => r.summary.waitSampleSize && baseline.runs[i].summary.waitSampleSize ? [{ candidate: r, baseline: baseline.runs[i] }] : []);
  return { paired, baseline, candidate, coupling, reason: measuredPairs.length < seeds.length ? 'Wait delta excludes pairs without completed-cohort observations in both runs; inspect its sample count.' : undefined, delta: {
    completed: estimate(candidate.runs.map((r, i) => r.summary.completed - baseline.runs[i].summary.completed)),
    wait: estimate(measuredPairs.map(p => p.candidate.summary.meanWait - p.baseline.summary.meanWait)),
    cost: estimate(candidate.runs.map((r, i) => r.summary.cost - baseline.runs[i].summary.cost)),
  } };
}

export interface CapacitySearchSpec {
  poolId: string; capacities: number[]; trainingSeeds: number[]; verificationSeeds: number[];
  targetCompleted?: number; maxMeanWait?: number; maxRuns?: number;
}
export interface CapacityCandidate { capacity: number; feasible: boolean; experiment: ExperimentResult }
export interface CapacitySearchResult {
  candidates: CapacityCandidate[]; selectedCapacity: number | null; verification: ExperimentResult | null;
  verified: boolean; totalRuns: number; runBudget: number; reason?: string;
}
export interface CapacitySearchPlan { minimumRuns: number; maximumRuns: number; runBudget: number }

/** Validate/count the same finite plan used by execution, without running it. */
export function capacitySearchPlan(model: SimulationModel, spec: CapacitySearchSpec): CapacitySearchPlan {
  assertModel(model); validateSeeds(spec.trainingSeeds); validateSeeds(spec.verificationSeeds);
  const pool = model.resources.find(p => p.id === spec.poolId);
  if (!pool) throw new Error('Capacity search requires an existing resource pool.');
  if (!spec.capacities.length || spec.capacities.length > 32 || new Set(spec.capacities).size !== spec.capacities.length || spec.capacities.some(c => !Number.isSafeInteger(c) || c < 0 || c > pool.installedCapacity)) throw new Error('Use 1–32 distinct capacities within installed capacity.');
  if (spec.trainingSeeds.some(s => spec.verificationSeeds.includes(s))) throw new Error('Held-out verification seeds must be disjoint from training seeds.');
  if ([spec.targetCompleted, spec.maxMeanWait].some(v => v !== undefined && (!Number.isFinite(v) || v < 0))) throw new Error('Search constraints must be finite and non-negative.');
  const runBudget = spec.maxRuns ?? 256;
  const plannedRuns = spec.capacities.length * spec.trainingSeeds.length + spec.verificationSeeds.length;
  if (!Number.isSafeInteger(runBudget) || runBudget < 1 || runBudget > 1000 || plannedRuns > runBudget) throw new Error(`Search needs up to ${plannedRuns} runs, exceeding its valid 1–1,000 run budget.`);
  return { minimumRuns: spec.capacities.length * spec.trainingSeeds.length, maximumRuns: plannedRuns, runBudget };
}

/** Bounded finite candidate search. Selection means the cheapest training-feasible
 * candidate; an independent held-out experiment checks the same mean constraints.
 * This is neither a global optimum nor a statistical guarantee of feasibility. */
export function capacitySearch(model: SimulationModel, spec: CapacitySearchSpec, options: RunOptions = {}): CapacitySearchResult {
  const { maximumRuns: plannedRuns, runBudget } = capacitySearchPlan(model, spec);
  const budget = new RetentionBudget();
  budget.check(encodedBytes(model) * spec.capacities.length);
  const candidateModel = (capacity: number) => {
    const copy = structuredClone(model); copy.resources.find(p => p.id === spec.poolId)!.capacity = capacity; return copy;
  };
  const feasible = (experiment: ExperimentResult) => (spec.targetCompleted === undefined || experiment.completed.mean >= spec.targetCompleted) && (spec.maxMeanWait === undefined || experiment.wait.samples === experiment.runs.length && experiment.wait.mean <= spec.maxMeanWait);
  const candidates = [...spec.capacities].sort((a, b) => a - b).map(capacity => {
    const experiment = replications(candidateModel(capacity), spec.trainingSeeds, options, budget);
    return { capacity, experiment, feasible: feasible(experiment) };
  });
  const selected = candidates.filter(c => c.feasible).sort((a, b) => a.experiment.cost.mean - b.experiment.cost.mean || b.experiment.completed.mean - a.experiment.completed.mean || a.experiment.wait.mean - b.experiment.wait.mean || a.capacity - b.capacity)[0];
  if (!selected) return { candidates, selectedCapacity: null, verification: null, verified: false, totalRuns: candidates.length * spec.trainingSeeds.length, runBudget, reason: 'No training candidate meets the configured mean constraints.' };
  const verification = replications(selected.experiment.runs[0].model, spec.verificationSeeds, options, budget);
  return { candidates, selectedCapacity: selected.capacity, verification, verified: feasible(verification), totalRuns: plannedRuns, runBudget, reason: feasible(verification) ? undefined : 'Selected training candidate failed the independent held-out mean constraints.' };
}
