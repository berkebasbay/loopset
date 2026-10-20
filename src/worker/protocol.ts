import type { CapacitySearchResult, CapacitySearchSpec } from '../experiments';
import type { ExperimentResult, PairedComparison, RunLimits, RunOptions, RunResult, SimulationModel } from '../model/types';
import { ENGINE_VERSION } from '../model/types';
import { assertModel } from '../model/validate';
import { demandHash, fingerprint, modelHash } from '../model/identity';
import { buildCouplingManifest, normalizeRunLimits } from '../engine/provenance';
import { RNG_VERSION } from '../engine/random';

/** Bump when either endpoint changes the transport or accepted result contract. */
export const WORKER_PROTOCOL_VERSION = 1 as const;
export type WireRunOptions = Omit<RunOptions, 'onProgress' | 'shouldCancel'>;
type Envelope<C extends string> = { protocolVersion: typeof WORKER_PROTOCOL_VERSION; channel: C; id: string };
export type SimulationRequest = Envelope<'simulation'> & (
  | { type: 'run'; model: SimulationModel; options?: WireRunOptions }
  | { type: 'cancel' }
);
export type SimulationRunRequest = Extract<SimulationRequest, { type: 'run' }>;
export type ExperimentKind = 'replications' | 'paired' | 'search';
export type ExperimentRequest = Envelope<'experiment'> & { type: 'run' } & (
  | { kind: 'replications'; model: SimulationModel; seeds: number[] }
  | { kind: 'paired'; baseline: SimulationModel; model: SimulationModel; seeds: number[] }
  | { kind: 'search'; model: SimulationModel; spec: CapacitySearchSpec }
);
export type ExperimentValue = { kind: 'replications'; value: ExperimentResult }
  | { kind: 'paired'; value: PairedComparison } | { kind: 'search'; value: CapacitySearchResult };
export type WorkerResponse<T> = { type: 'start' } | { type: 'progress'; fraction: number }
  | { type: 'result'; result: T } | { type: 'error'; message: string };
type LifecycleResponse = Exclude<WorkerResponse<never>, { type: 'result' }>;
export type SimulationResponse = Envelope<'simulation'> & (LifecycleResponse | { type: 'result'; result: RunResult });
export type ExperimentResponse = Envelope<'experiment'> & (
  | LifecycleResponse & { kind: ExperimentKind }
  | ExperimentValue & { type: 'result' }
);
export const simulationEnvelope = (id: string) => ({ protocolVersion: WORKER_PROTOCOL_VERSION, channel: 'simulation' as const, id });
export const experimentEnvelope = (id: string, kind: ExperimentKind) => ({ protocolVersion: WORKER_PROTOCOL_VERSION, channel: 'experiment' as const, id, kind });

type Data = Record<string, unknown>;
const record = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const fail = (at: string): never => { throw new Error(`Invalid worker ${at}.`); };
function object(v: unknown, at: string): Data { return record(v) ? v : fail(at); }
function text(v: unknown, at: string, max = 100_000): asserts v is string { if (typeof v !== 'string' || !v.length || v.length > max) fail(at); }
function number(v: unknown, at: string, min = 0, max = Number.MAX_VALUE): asserts v is number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(at); }
function integer(v: unknown, at: string, max = Number.MAX_SAFE_INTEGER, min = 0): asserts v is number { number(v, at, min, max); if (!Number.isSafeInteger(v)) fail(at); }
function list(v: unknown, max: number, at: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(at);
  const values = v as unknown[];
  for (let i = 0; i < values.length; i++) if (!Object.hasOwn(values, i)) fail(`sparse ${at}`);
  return values;
}
function strings(v: unknown, max: number, at: string) { list(v, max, at).forEach(x => text(x, at)); }
function fields(v: Data, names: string[], at: string) { for (const key of names) number(v[key], `${at}.${key}`); }
function counts(v: Data, names: string[], at: string) { for (const key of names) integer(v[key], `${at}.${key}`); }
function optionalText(v: unknown, at: string) { if (v !== undefined) text(v, at); }
function boolean(v: unknown, at: string) { if (typeof v !== 'boolean') fail(at); }
function oneOf(v: unknown, values: readonly string[], at: string) { if (typeof v !== 'string' || !values.includes(v)) fail(at); }
function exactKeys(v: Data, allowed: readonly string[], at: string) { if (Object.keys(v).some(key => !allowed.includes(key))) fail(at); }

/** Existing model validation owns modeling rules. This preliminary wire check
 * rejects functions, accessors, exotic objects and cycles in extra properties as
 * well. Its ceiling covers 100 sources with 100,000 scheduled arrivals each. */
function wireModel(value: unknown) {
  let entries = 0; let characters = 0;
  const seen = new WeakSet<object>(); const ancestors = new WeakSet<object>();
  function visit(v: unknown, depth: number) {
    if (++entries > 11_000_000 || depth > 16) fail('model wire budget');
    if (v === null || v === undefined || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail('model number'); return; }
    if (typeof v === 'string') { characters += v.length; if (characters > 1_000_000) fail('model text budget'); return; }
    if (typeof v !== 'object' || !Array.isArray(v) && !record(v)) fail('model wire data');
    if (ancestors.has(v as object)) fail('cyclic model');
    if (seen.has(v as object)) return;
    ancestors.add(v as object);
    if (Array.isArray(v)) { let i = 0; for (const item of v) { if (!Object.hasOwn(v, i++)) fail('sparse model array'); visit(item, depth + 1); } }
    else for (const key of Object.keys(v as object)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('model wire property');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(v as object); seen.add(v as object);
  }
  visit(value, 0); assertModel(value);
}

/** Read identity only after checking the container. A different string ID is stale,
 * even when its version/payload is malformed; it must not stop a current request. */
export function responseId(v: unknown): string | undefined { return record(v) && typeof v.id === 'string' ? v.id : undefined; }
function envelope(v: unknown, channel: 'simulation' | 'experiment'): Data {
  const data = object(v, 'message');
  if (data.protocolVersion !== WORKER_PROTOCOL_VERSION) fail('protocol version');
  if (data.channel !== channel) fail('channel');
  text(data.id, 'request ID', 128);
  return data;
}
function options(v: unknown): asserts v is WireRunOptions {
  const data = object(v, 'run options');
  exactKeys(data, ['seed', 'maxEvents', 'maxEntities', 'maxMicrosteps', 'maxTraceEntities', 'maxTraceEvents'], 'run options');
  if (data.seed !== undefined) integer(data.seed, 'run seed', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
  // This is the engine's validator; zero caps and ceilings have one definition.
  normalizeRunLimits(data as WireRunOptions);
}
function seeds(v: unknown): asserts v is number[] {
  const values = list(v, 100, 'replication seeds');
  if (!values.length) fail('replication seeds');
  values.forEach(seed => integer(seed, 'replication seed', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER));
  if (new Set(values).size !== values.length) fail('distinct replication seeds');
}
export function readSimulationRequest(v: unknown): SimulationRequest {
  const data = envelope(v, 'simulation');
  oneOf(data.type, ['run', 'cancel'], 'request type');
  exactKeys(data, ['protocolVersion', 'channel', 'id', 'type', ...(data.type === 'run' ? ['model', 'options'] : [])], 'request fields');
  if (data.type === 'run') { wireModel(data.model); if (data.options !== undefined) options(data.options); }
  return data as SimulationRequest;
}
export function readExperimentRequest(v: unknown): ExperimentRequest {
  const data = envelope(v, 'experiment');
  if (data.type !== 'run') fail('experiment request type');
  oneOf(data.kind, ['replications', 'paired', 'search'], 'experiment kind');
  exactKeys(data, ['protocolVersion', 'channel', 'id', 'type', 'kind', 'model', ...(data.kind === 'search' ? ['spec'] : ['seeds']), ...(data.kind === 'paired' ? ['baseline'] : [])], 'experiment fields');
  wireModel(data.model);
  if (data.kind === 'paired') wireModel(data.baseline);
  if (data.kind !== 'search') seeds(data.seeds);
  else {
    const spec = object(data.spec, 'search settings');
    exactKeys(spec, ['poolId', 'capacities', 'trainingSeeds', 'verificationSeeds', 'targetCompleted', 'maxMeanWait', 'maxRuns'], 'search settings');
    text(spec.poolId, 'search resource', 64);
    const capacities = list(spec.capacities, 32, 'search capacities');
    if (!capacities.length) fail('search capacities');
    capacities.forEach(c => integer(c, 'capacity', 1000));
    seeds(spec.trainingSeeds); seeds(spec.verificationSeeds);
    if (spec.targetCompleted !== undefined) number(spec.targetCompleted, 'completed target');
    if (spec.maxMeanWait !== undefined) number(spec.maxMeanWait, 'wait target');
    if (spec.maxRuns !== undefined) integer(spec.maxRuns, 'run budget', 1000, 1);
    // Pool membership, installed capacity, disjoint seeds, constraints and the
    // planned-run budget remain authoritative in capacitySearch, before its runs.
  }
  return data as ExperimentRequest;
}

/** Compare a bounded expected contract without serializing/copying untrusted data.
 * Traversal follows only the bounded expected tree, including for cyclic input. */
function sameData(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => sameData(actual[i], value));
  if (record(expected)) return record(actual) && Object.keys(actual).length === Object.keys(expected).length && Object.keys(expected).every(key => Object.hasOwn(actual, key) && sameData(actual[key], expected[key]));
  return actual === expected;
}
type Context = { models: WeakMap<object, string>; matchedModels: WeakMap<object, SimulationModel>; visits: number };
const context = (): Context => ({ models: new WeakMap(), matchedModels: new WeakMap(), visits: 0 });
function checkedModel(v: unknown, context: Context): SimulationModel {
  const data = object(v, 'result model');
  if (!context.models.has(data)) { wireModel(data); context.models.set(data, modelHash(data as unknown as SimulationModel)); }
  return data as unknown as SimulationModel;
}
function estimate(v: unknown, samples: number) {
  const data = object(v, 'estimate'); number(data.mean, 'estimate mean', -Number.MAX_VALUE);
  integer(data.samples, 'estimate samples', samples);
  for (const key of ['standardError', 'lower95', 'upper95']) if (data[key] !== null) number(data[key], `estimate ${key}`, key === 'standardError' ? 0 : -Number.MAX_VALUE);
  if (Number(data.samples) < 2 && [data.standardError, data.lower95, data.upper95].some(x => x !== null)) fail('single-run interval');
  if (Number(data.samples) >= 2 && [data.standardError, data.lower95, data.upper95].some(x => x === null)) fail('estimate interval');
}
function runResult(v: unknown, expected: SimulationModel, seed: number, limits: RunLimits, context: Context): asserts v is RunResult {
  const run = object(v, 'result'); const model = checkedModel(run.model, context);
  const hash = context.models.get(model)!;
  checkedModel(expected, context);
  if (context.matchedModels.get(model) !== expected) {
    if (!sameData(model, expected)) fail('result snapshot');
    context.matchedModels.set(model, expected);
  }
  if (hash !== context.models.get(expected) || run.modelHash !== hash || run.seed !== seed || run.engineVersion !== ENGINE_VERSION || run.demandHash !== demandHash(model, seed) || run.id !== fingerprint({ engine: ENGINE_VERSION, hash, seed })) fail('result identity');
  const provenance = object(run.provenance, 'run provenance');
  if (provenance.rngVersion !== RNG_VERSION || !sameData(provenance.limits, limits)) fail('run provenance');
  oneOf(run.status, ['completed', 'cancelled', 'limited', 'failed'], 'run status'); optionalText(run.reason, 'run reason');
  if (run.status !== 'completed' && run.reason === undefined) fail('incomplete run reason');
  number(run.simulatedUntil, 'simulation coverage', 0, model.horizon); number(run.elapsedMs, 'elapsed time');
  if (run.status === 'completed' && run.simulatedUntil !== model.horizon) fail('completed run coverage');
  integer(run.processedEvents, 'processed work', limits.maxEvents);
  const summary = object(run.summary, 'summary');
  counts(summary, ['arrivals', 'completed', 'balked', 'reneged', 'inSystem', 'slaMet', 'waitSampleSize'], 'summary');
  fields(summary, ['meanWait', 'p50Wait', 'p95Wait', 'meanSojourn', 'throughputPerHour', 'cost', 'measurementStart', 'measurementEnd'], 'summary');
  if (summary.slaRate !== null) number(summary.slaRate, 'SLA fraction', 0, 1);
  if (Number(summary.completed) + Number(summary.balked) + Number(summary.reneged) + Number(summary.inSystem) !== summary.arrivals || summary.waitSampleSize !== summary.completed || Number(summary.slaMet) > Number(summary.completed)) fail('cohort counts');
  if (summary.measurementStart !== model.warmup || summary.measurementEnd !== Math.max(model.warmup, Number(run.simulatedUntil))) fail('measurement coverage');
  const trace = object(run.trace, 'trace'); boolean(trace.complete, 'trace completeness'); number(trace.until, 'trace coverage', 0, Number(run.simulatedUntil));
  if (trace.entityLimit !== limits.maxTraceEntities || trace.eventLimit !== limits.maxTraceEvents || trace.complete && run.status !== 'completed') fail('trace limits');
  if (trace.complete && trace.until !== run.simulatedUntil) fail('complete trace coverage');
  const nodeIds = new Set(model.nodes.map(n => n.id)); const sources = new Map(model.nodes.filter(n => n.kind === 'source').map(n => [n.id, n]));
  const serviceIds = new Set(model.nodes.filter(n => n.kind === 'service').map(n => n.id)); const poolIds = new Set(model.resources.map(p => p.id));
  const entities = list(run.entities, limits.maxTraceEntities, 'trace entities'); const entityIds = new Set<string>();
  for (const value of entities) {
    const entity = object(value, 'trace entity'); text(entity.id, 'entity ID', 160); if (entityIds.has(entity.id)) fail('duplicate entity'); entityIds.add(entity.id);
    const source = sources.get(String(entity.sourceId)) ?? fail('entity source'); text(entity.classId, 'entity class', 64);
    integer(entity.ordinal, 'arrival ordinal'); integer(entity.priority, 'entity priority', 1000, -1000);
    const entityClass = source.classes.find(cls => cls.id === entity.classId);
    if (!entityClass || entityClass.priority !== entity.priority || entity.id !== `${source.samplingId}:${entity.ordinal}`) fail('entity identity or class');
    number(entity.arrivedAt, 'arrival time', 0, Number(run.simulatedUntil)); if (entity.endedAt !== undefined) number(entity.endedAt, 'end time', Number(entity.arrivedAt), Number(run.simulatedUntil));
    oneOf(entity.status, ['active', 'completed', 'balked', 'reneged'], 'entity status');
    const visits = list(entity.visits, limits.maxEvents, 'entity visits'); context.visits += visits.length;
    if (context.visits > 10_000_000) fail('retained visit budget');
    for (const value of visits) {
      const visit = object(value, 'visit'); if (!nodeIds.has(String(visit.nodeId))) fail('visit node');
      number(visit.arrival, 'visit arrival', Number(entity.arrivedAt), Number(run.simulatedUntil));
      if (visit.start !== undefined) number(visit.start, 'visit start', Number(visit.arrival), Number(run.simulatedUntil));
      if (visit.end !== undefined) number(visit.end, 'visit end', Number(visit.start ?? visit.arrival), Number(run.simulatedUntil));
      if (visit.outcome !== undefined) oneOf(visit.outcome, ['served', 'balked', 'reneged', 'passed'], 'visit outcome');
    }
  }
  let previousEventTime = 0;
  for (const value of list(run.events, limits.maxTraceEvents, 'trace events')) {
    const event = object(value, 'trace event'); number(event.time, 'event time', previousEventTime, Number(run.simulatedUntil)); previousEventTime = Number(event.time);
    oneOf(event.kind, ['arrival', 'queue', 'start', 'finish', 'complete', 'balk', 'renege', 'transfer'], 'event kind');
    if (!nodeIds.has(String(event.nodeId)) || !entityIds.has(String(event.entityId))) fail('event reference');
  }
  const stations = list(run.stations, serviceIds.size, 'stations'); const seenStations = new Set();
  for (const value of stations) {
    const station = object(value, 'station'); if (!serviceIds.has(String(station.nodeId)) || seenStations.has(station.nodeId)) fail('station reference'); seenStations.add(station.nodeId);
    counts(station, ['arrived', 'started', 'finished', 'balked', 'reneged', 'queueAtEnd', 'busyAtEnd'], 'station');
    fields(station, ['averageQueue', 'averageWait', 'p95Wait', 'busySeconds'], 'station'); if (station.utilization !== null) number(station.utilization, 'station utilization');
  }
  if (stations.length !== serviceIds.size) fail('missing station');
  const pools = list(run.pools, poolIds.size, 'pools'); const seenPools = new Set();
  for (const value of pools) {
    const pool = object(value, 'pool'); if (!poolIds.has(String(pool.poolId)) || seenPools.has(pool.poolId)) fail('pool reference'); seenPools.add(pool.poolId);
    fields(pool, ['scheduledUnitSeconds', 'busyUnitSeconds', 'overtimeUnitSeconds', 'cost'], 'pool'); if (pool.utilization !== null) number(pool.utilization, 'pool utilization');
  }
  if (pools.length !== poolIds.size) fail('missing pool');
  strings(run.warnings, 100, 'warnings');
  const diagnostics = object(run.diagnostics, 'diagnostics');
  counts(diagnostics, ['totalArrivals', 'activeWaiting', 'activeService', 'activeTransfer', 'bypassedRequests', 'maxHeapSize', 'maxActiveEntities'], 'diagnostics');
  const active = Number(diagnostics.activeWaiting) + Number(diagnostics.activeService) + Number(diagnostics.activeTransfer);
  if (Number(diagnostics.totalArrivals) < entities.length || Number(diagnostics.totalArrivals) < Number(summary.arrivals) || Number(diagnostics.totalArrivals) > limits.maxEntities || active > Number(diagnostics.totalArrivals) || active < Number(summary.inSystem) || Number(diagnostics.maxActiveEntities) < active || Number(diagnostics.maxActiveEntities) > Number(diagnostics.totalArrivals)) fail('diagnostic population');
  const classIds = new Set([...sources.values()].flatMap(source => source.classes.map(cls => cls.id)));
  const classMetrics = list(run.classes, classIds.size, 'class metrics'); const seenClasses = new Set();
  const cohortKeys = ['arrivals', 'completed', 'balked', 'reneged', 'inSystem', 'waitSampleSize'] as const;
  const classTotals = Object.fromEntries(cohortKeys.map(key => [key, 0]));
  for (const value of classMetrics) {
    const cls = object(value, 'class metric'); text(cls.classId, 'class ID', 64);
    if (!classIds.has(cls.classId) || seenClasses.has(cls.classId)) fail('class identity'); seenClasses.add(cls.classId);
    counts(cls, ['arrivals', 'completed', 'balked', 'reneged', 'inSystem', 'waitSampleSize'], 'class'); number(cls.meanWait, 'class wait');
    if (Number(cls.completed) + Number(cls.balked) + Number(cls.reneged) + Number(cls.inSystem) !== cls.arrivals || cls.waitSampleSize !== cls.completed) fail('class cohort');
    for (const key of cohortKeys) classTotals[key] += Number(cls[key]);
  }
  if (classMetrics.length !== classIds.size || cohortKeys.some(key => classTotals[key] !== summary[key])) fail('class population totals');
  const distribution = object(run.waitDistribution, 'wait distribution'); integer(distribution.sampleSize, 'wait samples');
  if (distribution.sampleSize !== summary.waitSampleSize) fail('wait sample count');
  const bins = list(distribution.bins, 100, 'wait bins'); let previousEnd = 0; let observations = 0;
  for (const [index, value] of bins.entries()) {
    const bin = object(value, 'wait bin'); number(bin.from, 'bin start', previousEnd);
    if (bin.to === null) { if (index !== bins.length - 1) fail('open wait bin'); }
    else { number(bin.to, 'bin end', Number(bin.from)); if (bin.to === bin.from) fail('empty wait interval'); previousEnd = Number(bin.to); }
    integer(bin.count, 'bin count'); observations += Number(bin.count);
  }
  if (observations !== distribution.sampleSize) fail('wait distribution population');
}
function experimentResult(v: unknown, model: SimulationModel, requestedSeeds: number[], context: Context): asserts v is ExperimentResult {
  const value = object(v, 'experiment result');
  checkedModel(model, context);
  if (value.modelHash !== context.models.get(model) || !sameData(value.seeds, requestedSeeds)) fail('experiment identity');
  const runs = list(value.runs, requestedSeeds.length, 'experiment runs'); if (runs.length !== requestedSeeds.length) fail('missing replication');
  runs.forEach((run, i) => { runResult(run, model, requestedSeeds[i], normalizeRunLimits({ maxTraceEntities: 0, maxTraceEvents: 0 }), context); if (run.status !== 'completed') fail('incomplete estimate'); });
  const observedWaitRuns = (runs as RunResult[]).filter(run => run.summary.waitSampleSize > 0).length;
  for (const key of ['completed', 'wait', 'p95Wait', 'cost']) {
    estimate(value[key], runs.length);
    if (object(value[key], 'estimate').samples !== (key === 'wait' || key === 'p95Wait' ? observedWaitRuns : runs.length)) fail('estimate observation count');
  }
}
function experimentValue(v: unknown, request: ExperimentRequest): ExperimentValue {
  const checked = context();
  if (request.kind === 'replications') { experimentResult(v, request.model, request.seeds, checked); return { kind: request.kind, value: v }; }
  const value = object(v, 'experiment value');
  if (request.kind === 'paired') {
    experimentResult(value.baseline, request.baseline, request.seeds, checked); experimentResult(value.candidate, request.model, request.seeds, checked);
    const baseline = value.baseline; const candidate = value.candidate;
    boolean(value.paired, 'paired status'); optionalText(value.reason, 'paired reason');
    const delta = object(value.delta, 'paired differences'); for (const key of ['completed', 'wait', 'cost']) estimate(delta[key], request.seeds.length);
    const coupling = buildCouplingManifest(baseline.runs[0], candidate.runs[0]);
    if (!sameData(value.coupling, coupling)) fail('coupling manifest');
    const paired = coupling.compatibility.sameMeasurementPolicies && baseline.runs.every((run, index) => run.demandHash === candidate.runs[index].demandHash);
    if (value.paired !== paired) fail('paired eligibility');
    const waitPairs = paired ? candidate.runs.filter((run, index) => run.summary.waitSampleSize > 0 && baseline.runs[index].summary.waitSampleSize > 0).length : 0;
    for (const key of ['completed', 'wait', 'cost']) if (object(delta[key], 'paired estimate').samples !== (key === 'wait' ? waitPairs : paired ? request.seeds.length : 0)) fail('paired observation count');
    return { kind: request.kind, value: value as unknown as PairedComparison };
  }
  const candidates = list(value.candidates, 32, 'search candidates');
  if (candidates.length !== request.spec.capacities.length) fail('missing candidate');
  const capacities = [...request.spec.capacities].sort((a, b) => a - b);
  const feasible = (experiment: ExperimentResult) => (request.spec.targetCompleted === undefined || experiment.completed.mean >= request.spec.targetCompleted) && (request.spec.maxMeanWait === undefined || experiment.wait.samples === experiment.runs.length && experiment.wait.mean <= request.spec.maxMeanWait);
  for (const [i, item] of candidates.entries()) {
    const candidate = object(item, 'candidate'); if (candidate.capacity !== capacities[i]) fail('candidate capacity'); boolean(candidate.feasible, 'candidate feasibility');
    // Only the pool's base capacity changes; no duplicate large model is created.
    const model = { ...request.model, resources: request.model.resources.map(pool => pool.id === request.spec.poolId ? { ...pool, capacity: capacities[i] } : pool) };
    experimentResult(candidate.experiment, model, request.spec.trainingSeeds, checked);
    if (candidate.feasible !== feasible(candidate.experiment)) fail('candidate feasibility');
  }
  boolean(value.verified, 'verification status'); optionalText(value.reason, 'search reason'); integer(value.totalRuns, 'total runs', 1000); integer(value.runBudget, 'run budget', 1000, 1);
  if (value.runBudget !== (request.spec.maxRuns ?? 256) || Number(value.totalRuns) > Number(value.runBudget)) fail('search budget');
  if (value.selectedCapacity === null) { if (value.verification !== null || value.verified !== false || value.totalRuns !== candidates.length * request.spec.trainingSeeds.length || candidates.some(item => object(item, 'candidate').feasible)) fail('unselected search'); }
  else {
    const selected = candidates.map(x => object(x, 'candidate')).find(c => c.capacity === value.selectedCapacity);
    if (!selected || selected.feasible !== true) fail('selected capacity');
    const experiment = selected!.experiment as ExperimentResult;
    experimentResult(value.verification, experiment.runs[0].model, request.spec.verificationSeeds, checked);
    if (value.verified !== feasible(value.verification)) fail('held-out feasibility');
    if (value.totalRuns !== candidates.length * request.spec.trainingSeeds.length + request.spec.verificationSeeds.length) fail('search run count');
  }
  return { kind: request.kind, value: value as unknown as CapacitySearchResult };
}
function response(v: unknown, channel: 'simulation' | 'experiment', id: string): Data {
  const data = envelope(v, channel); if (data.id !== id) fail('response ID');
  oneOf(data.type, ['start', 'progress', 'result', 'error'], 'response type');
  if (data.type === 'progress') number(data.fraction, 'progress fraction', 0, 1);
  if (data.type === 'error') text(data.message, 'error message');
  return data;
}
export function readSimulationResponse(v: unknown, request: SimulationRunRequest): WorkerResponse<RunResult> {
  const data = response(v, 'simulation', request.id);
  if (data.type === 'result') {
    runResult(data.result, request.model, request.options?.seed ?? request.model.seed, normalizeRunLimits(request.options), context());
    return { type: 'result', result: data.result };
  }
  return data as WorkerResponse<RunResult>;
}
export function readExperimentResponse(v: unknown, request: ExperimentRequest): WorkerResponse<ExperimentValue> {
  const data = response(v, 'experiment', request.id); if (data.kind !== request.kind) fail('experiment response kind');
  if (data.type === 'result') return { type: 'result', result: experimentValue(data.value, request) };
  return data as WorkerResponse<ExperimentValue>;
}
