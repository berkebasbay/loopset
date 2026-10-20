import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulate, simulateAsync } from '../src/engine';
import { capacitySearch, comparePaired, runExperiment } from '../src/experiments';
import type { SimulationModel } from '../src/model/types';
import { createExample } from '../src/examples';
import { WorkerClient } from '../src/worker/client';
import type { WorkerPort, WorkerState } from '../src/worker/client';
import { experimentEnvelope, readExperimentRequest, readExperimentResponse, readSimulationRequest, readSimulationResponse, simulationEnvelope } from '../src/worker/protocol';
import type { ExperimentRequest, SimulationRunRequest } from '../src/worker/protocol';

const model = (): SimulationModel => ({ id: 'wire', name: 'Wire fixture', horizon: 20, warmup: 0, seed: 1, slaSeconds: 10, currency: 'USD',
  resources: [{ id: 'team', label: 'Team', installedCapacity: 3, capacity: 1, calendar: [], costPerHour: 3600, overtimeCostPerHour: 0 }],
  nodes: [
    { id: 'src', samplingId: 'src', label: 'Source', kind: 'source', next: 'q', arrival: { kind: 'schedule', times: [0, 0, 0] }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] },
    { id: 'q', samplingId: 'q', label: 'Queue', kind: 'queue', next: 's', capacity: null, discipline: 'fifo', patience: null },
    { id: 's', samplingId: 's', label: 'Service', kind: 'service', next: 'out', servers: 3, duration: { kind: 'constant', value: 10 }, resources: [{ poolId: 'team', units: 1 }] },
    { id: 'out', samplingId: 'out', label: 'Out', kind: 'sink' },
  ] });
const simulation = (id = 'run-1'): SimulationRunRequest => ({ ...simulationEnvelope(id), type: 'run', model: model() });
const replications = (id = 'lab-1'): Extract<ExperimentRequest, { kind: 'replications' }> => ({ ...experimentEnvelope(id, 'replications'), type: 'run', kind: 'replications', model: model(), seeds: [1, 2] });
const resultMessage = (request: SimulationRunRequest) => ({ ...simulationEnvelope(request.id), type: 'result', result: simulate(request.model, request.options) });

class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  sent: unknown[] = []; terminated = false; throwOnPost = false;
  postMessage(message: unknown) { if (this.throwOnPost) throw new Error('clone failed'); this.sent.push(message); }
  terminate() { this.terminated = true; }
  deliver(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
  crash() { this.onerror?.({ message: 'Worker crashed.' } as ErrorEvent); }
}
function harness() {
  const workers: FakeWorker[] = []; const states: WorkerState[] = [];
  const client = new WorkerClient(() => { const w = new FakeWorker(); workers.push(w); return w; }, readSimulationResponse, state => states.push(state), 'simulation', r => ({ ...simulationEnvelope(r.id), type: 'cancel' }));
  return { client, workers, states };
}

describe('versioned requests and narrow boundary values', () => {
  it('rejects null, arrays, primitives, missing and wrong versions before traversal', () => {
    for (const value of [null, [], 2, 'run', {}, { ...simulation(), protocolVersion: 0 }, { ...simulation(), channel: 'experiment' }]) expect(() => readSimulationRequest(value)).toThrow();
    for (const value of [null, [], {}, { ...replications(), protocolVersion: 2 }]) expect(() => readExperimentRequest(value)).toThrow();
  });
  it('uses actual model/limit rules, accepts zero caps and rejects callbacks or unknown options', () => {
    const request = { ...simulation(), options: { maxEvents: 0, maxEntities: 0, maxMicrosteps: 0, maxTraceEvents: 0, maxTraceEntities: 0, seed: -1 } };
    expect(readSimulationRequest(request)).toBe(request);
    for (const options of [[], null, { maxEvents: -1 }, { maxEntities: 1_000_001 }, { maxEvents: .5 }, { seed: NaN }, { onProgress: () => {} }, { shouldCancel: () => true }, { unexpected: true }, { maxTraceEvents: () => 0 }]) expect(() => readSimulationRequest({ ...request, options })).toThrow();
    expect(() => readSimulationRequest({ ...request, model: { ...model(), horizon: 0 } })).toThrow('Run length');
  });
  it('rejects cyclic, functional and accessor model extras without hashing them', () => {
    const cyclic = { ...model(), extra: {} }; cyclic.extra = cyclic;
    for (const input of [cyclic, { ...model(), extra: () => 1 }, { ...model(), extra: new Date() }]) expect(() => readSimulationRequest({ ...simulation(), model: input })).toThrow();
    const getter = vi.fn(() => 'secret'); const input = model(); Object.defineProperty(input, 'extra', { enumerable: true, get: getter });
    expect(() => readSimulationRequest({ ...simulation(), model: input })).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('versions cancellation and bounds replication/search inputs without dispatching work', () => {
    const cancel = { ...simulationEnvelope('run-1'), type: 'cancel' }; expect(readSimulationRequest(cancel)).toBe(cancel);
    expect(() => readSimulationRequest({ ...cancel, protocolVersion: 999 })).toThrow('version');
    for (const seeds of [[], [1, 1], [NaN], Array(1), Array(101).fill(1), '1']) expect(() => readExperimentRequest({ ...replications(), seeds })).toThrow();
    const request = { ...experimentEnvelope('search', 'search'), type: 'run', kind: 'search', model: model(), spec: { poolId: 'team', capacities: [1], trainingSeeds: [1], verificationSeeds: [2], maxRuns: 2 } };
    expect(readExperimentRequest(request)).toBe(request);
    expect(() => readExperimentRequest({ ...request, spec: { ...request.spec, capacities: new Array(33) } })).toThrow();
    expect(() => readExperimentRequest({ ...request, options: { onProgress: () => {} } })).toThrow();
  });
  it('keeps schema-wide legal schedule/class/calendar extremes within the wire guard', () => {
    const extreme = model(); extreme.nodes = [{ id: 'out', samplingId: 'out', label: 'O'.repeat(160), kind: 'sink' }];
    extreme.horizon = 604800;
    for (let i = 0; i < 99; i++) extreme.nodes.push({
      id: `s${i}`.padEnd(64, 'x'), samplingId: `sample${i}`.padEnd(64, 'x'), label: 'S'.repeat(160), kind: 'source', next: 'out',
      arrival: { kind: 'schedule', times: Array(100_000).fill(0) },
      classes: Array.from({ length: 20 }, (_, c) => ({ id: `class${c}`.padEnd(64, 'x'), label: 'C'.repeat(160), priority: 1000, probability: .05 })),
    });
    extreme.resources = Array.from({ length: 50 }, (_, i) => ({ id: `pool${i}`.padEnd(64, 'x'), label: 'R'.repeat(160), installedCapacity: 1000, capacity: 1000, costPerHour: 1e6, overtimeCostPerHour: 1e6,
      calendar: Array.from({ length: 200 }, (_, j) => ({ start: j * 3000, end: (j + 1) * 3000, capacity: 1000 })) }));
    const request = { ...simulation(), model: extreme };
    expect(readSimulationRequest(request)).toBe(request);
  });
  it('accepts the largest legal collection of empirical distributions', () => {
    const extreme = model(); extreme.nodes = extreme.nodes.filter(n => n.kind === 'source' || n.kind === 'sink');
    (extreme.nodes[0] as Extract<SimulationModel['nodes'][number], { kind: 'source' }>).next = 'd0';
    for (let i = 0; i < 98; i++) extreme.nodes.push({ id: `d${i}`, samplingId: `d${i}`, label: 'D'.repeat(160), kind: 'delay', next: 'out', duration: { kind: 'empirical', values: Array(10_000).fill(1) } });
    expect(readSimulationRequest({ ...simulation(), model: extreme }).type).toBe('run');
  });
});

describe('response validation with actual engine and experiment output', () => {
  it('accepts real completed, limited, cancelled and failed shapes with exact provenance', async () => {
    const completed = simulation(); expect(readSimulationResponse(resultMessage(completed), completed).type).toBe('result');
    const limited = { ...simulation(), options: { maxEvents: 1, maxTraceEntities: 0, maxTraceEvents: 0 } };
    const value = simulate(limited.model, limited.options); expect(value.status).toBe('limited');
    expect(readSimulationResponse({ ...simulationEnvelope(limited.id), type: 'result', result: value }, limited)).toEqual({ type: 'result', result: value });
    const request = simulation(); const cancelled = await simulateAsync(request.model, { shouldCancel: () => true }); expect(cancelled.status).toBe('cancelled');
    expect(readSimulationResponse({ ...simulationEnvelope(request.id), type: 'result', result: cancelled }, request).type).toBe('result');
    const failed = simulation(); const service = failed.model.nodes.find(n => n.kind === 'service')!; service.duration = { kind: 'constant', value: Number.MIN_VALUE };
    (failed.model.nodes[0] as Extract<SimulationModel['nodes'][number], { kind: 'source' }>).arrival = { kind: 'schedule', times: [1] };
    const output = simulate(failed.model); expect(output.status).toBe('failed');
    expect(readSimulationResponse({ ...simulationEnvelope(failed.id), type: 'result', result: output }, failed).type).toBe('result');
    const zero = { ...simulation(), options: { seed: -27, maxEvents: 0, maxEntities: 0, maxMicrosteps: 0, maxTraceEntities: 0, maxTraceEvents: 0 } };
    expect(readSimulationResponse(resultMessage(zero), zero).type).toBe('result');
  });
  it('accepts all real example results and a completed result with truncated replay', () => {
    for (const world of ['factory', 'festival', 'service'] as const) {
      const request = { ...simulation(), model: createExample(world).model, options: { maxTraceEntities: 1, maxTraceEvents: 1 } };
      const message = resultMessage(request); expect(message.result.status).toBe('completed'); expect(message.result.trace.complete).toBe(false);
      expect(readSimulationResponse(message, request)).toEqual({ type: 'result', result: message.result });
    }
  });
  it('keeps real partial cohorts valid across zero/entity/work/microstep stops and pre-warm-up cancellation', () => {
    for (const options of [{ maxEntities: 1 }, { maxEvents: 3 }, { maxMicrosteps: 1 }, { maxEvents: 0 }]) {
      const request = { ...simulation(), options }; const result = resultMessage(request);
      expect(result.result.status).toBe('limited'); expect(readSimulationResponse(result, request).type).toBe('result');
    }
    const request = simulation(); request.model.warmup = 10;
    const result = simulate(request.model, { shouldCancel: () => true }); expect(result.simulatedUntil).toBeLessThan(request.model.warmup);
    expect(readSimulationResponse({ ...simulationEnvelope(request.id), type: 'result', result }, request).type).toBe('result');
  });
  it('rejects mismatched identity/version/channel and invalid fractions for every lifecycle type', () => {
    const request = simulation();
    for (const type of ['start', 'progress', 'result', 'error']) {
      const message = { ...simulationEnvelope(request.id), type, fraction: .5, message: 'Reason', result: simulate(request.model) };
      expect(() => readSimulationResponse({ ...message, protocolVersion: 99 }, request)).toThrow('version');
      expect(() => readSimulationResponse({ ...message, id: 'different' }, request)).toThrow('ID');
      expect(() => readSimulationResponse({ ...message, channel: 'experiment' }, request)).toThrow('channel');
    }
    for (const fraction of [-.1, 1.1, NaN, Infinity, '0.5', null, {}, []]) expect(() => readSimulationResponse({ ...simulationEnvelope(request.id), type: 'progress', fraction }, request)).toThrow();
    for (const value of [null, [], {}, { ...simulationEnvelope(request.id), type: 'cancel' }]) expect(() => readSimulationResponse(value, request)).toThrow();
  });
  it('rejects broken result/provenance/trace/nested measurements and excessive arrays', () => {
    const request = simulation(); const actual = resultMessage(request);
    const mutate: ((value: typeof actual.result) => void)[] = [
      value => { value.provenance = { ...value.provenance, rngVersion: 'old' }; }, value => { value.provenance = { ...value.provenance, limits: { ...value.provenance.limits, maxEvents: 1 } }; },
      value => { value.summary.completed = NaN; }, value => { value.summary.slaRate = 2; }, value => { value.modelHash = 'forged'; },
      value => { value.events = new Array(100_001); }, value => { value.stations[0].averageWait = Infinity; },
      value => { value.entities[0].visits = [null as never]; }, value => { value.trace.until = value.model.horizon + 1; },
      value => { value.provenance = null as never; }, value => { value.summary = [] as never; },
      value => { value.simulatedUntil = 0; value.summary.measurementEnd = 0; value.trace.until = 0; },
      value => { value.trace.until = 0; }, value => { value.summary.completed++; }, value => { value.summary.waitSampleSize++; },
    ];
    for (const change of mutate) { const value = structuredClone(actual.result); change(value); expect(() => readSimulationResponse({ ...actual, result: value }, request)).toThrow(); }
  });
  it('accepts actual replication, paired manifest, unpaired and held-out search results unchanged', () => {
    const request = replications(); const output = runExperiment(request.model, request.seeds);
    const parsed = readExperimentResponse({ ...experimentEnvelope(request.id, request.kind), type: 'result', value: output }, request);
    expect(parsed.type === 'result' && parsed.result.value).toBe(output);
    for (const compatible of [true, false]) {
      const baseline = model(); if (!compatible) baseline.warmup = 1;
      const paired = { ...experimentEnvelope('pair', 'paired'), type: 'run' as const, kind: 'paired' as const, baseline, model: model(), seeds: [1, 2] };
      const value = comparePaired(baseline, paired.model, paired.seeds); expect(value.paired).toBe(compatible);
      expect(readExperimentResponse({ ...experimentEnvelope(paired.id, 'paired'), type: 'result', value }, paired).type).toBe('result');
    }
    for (const targetCompleted of [2, 100]) {
      const search = { ...experimentEnvelope('search', 'search'), type: 'run' as const, kind: 'search' as const, model: model(), spec: { poolId: 'team', capacities: [1, 2], trainingSeeds: [1], verificationSeeds: [2], targetCompleted, maxRuns: 3 } };
      const value = capacitySearch(search.model, search.spec);
      expect(readExperimentResponse({ ...experimentEnvelope(search.id, 'search'), type: 'result', value }, search).type).toBe('result');
    }
  });
  it('rejects wrong experiment kind, missing runs, altered manifests and partial estimates', () => {
    const request = replications(); const value = runExperiment(request.model, request.seeds);
    for (const type of ['start', 'progress', 'error', 'result']) expect(() => readExperimentResponse({ ...experimentEnvelope(request.id, 'paired'), type, fraction: .5, message: 'Failure', value }, request)).toThrow('kind');
    expect(() => readExperimentResponse({ ...experimentEnvelope(request.id, request.kind), type: 'result', value: { ...value, runs: [] } }, request)).toThrow('replication');
    expect(() => readExperimentResponse({ ...experimentEnvelope(request.id, request.kind), type: 'result', value: { ...value, runs: Array(2) } }, request)).toThrow('sparse');
    value.runs[0] = simulate(request.model, { maxEvents: 1 });
    expect(() => readExperimentResponse({ ...experimentEnvelope(request.id, request.kind), type: 'result', value }, request)).toThrow();
    const pair = { ...experimentEnvelope('pair', 'paired'), type: 'run' as const, kind: 'paired' as const, baseline: model(), model: model(), seeds: [1] };
    const paired = comparePaired(pair.baseline, pair.model, pair.seeds); paired.coupling.matchedStages[0].changes = ['capacity'];
    expect(() => readExperimentResponse({ ...experimentEnvelope(pair.id, pair.kind), type: 'result', value: paired }, pair)).toThrow('manifest');
  });
});

describe('cross-field transport populations', () => {
  it('rejects finite but inconsistent retained populations and estimate sample metadata', () => {
    const request = simulation(); const actual = resultMessage(request);
    for (const change of [
      (run: typeof actual.result) => { run.waitDistribution.bins[0].count++; },
      (run: typeof actual.result) => { run.classes[0].completed++; },
      (run: typeof actual.result) => { run.diagnostics.totalArrivals = 0; },
      (run: typeof actual.result) => { run.entities[0].classId = 'unknown'; },
      (run: typeof actual.result) => { run.events.reverse(); },
      (run: typeof actual.result) => { run.entities[0].visits[0].start = -1; },
    ]) {
      const result = structuredClone(actual.result); change(result);
      expect(() => readSimulationResponse({ ...actual, result }, request)).toThrow();
    }
    const experiment = replications(); const value = runExperiment(experiment.model, experiment.seeds);
    value.completed = { mean: 0, samples: 0, standardError: null, lower95: null, upper95: null };
    expect(() => readExperimentResponse({ ...experimentEnvelope(experiment.id, experiment.kind), type: 'result', value }, experiment)).toThrow('observation count');
  });
  it('rejects paired and feasibility flags inconsistent with actual compatible inputs and estimates', () => {
    const baseline = model(); baseline.warmup = 1;
    const paired = { ...experimentEnvelope('pair', 'paired'), type: 'run' as const, kind: 'paired' as const, baseline, model: model(), seeds: [1, 2] };
    const pairValue = comparePaired(baseline, paired.model, paired.seeds); pairValue.paired = true;
    expect(() => readExperimentResponse({ ...experimentEnvelope(paired.id, paired.kind), type: 'result', value: pairValue }, paired)).toThrow('eligibility');
    const search = { ...experimentEnvelope('search', 'search'), type: 'run' as const, kind: 'search' as const, model: model(), spec: { poolId: 'team', capacities: [1, 2], trainingSeeds: [1], verificationSeeds: [2], targetCompleted: 2, maxRuns: 3 } };
    const actual = capacitySearch(search.model, search.spec);
    const falseCandidate = structuredClone(actual); falseCandidate.candidates[0].feasible = !falseCandidate.candidates[0].feasible;
    expect(() => readExperimentResponse({ ...experimentEnvelope(search.id, search.kind), type: 'result', value: falseCandidate }, search)).toThrow('feasibility');
    const falseVerification = structuredClone(actual); falseVerification.verified = !falseVerification.verified;
    expect(() => readExperimentResponse({ ...experimentEnvelope(search.id, search.kind), type: 'result', value: falseVerification }, search)).toThrow('feasibility');
  });
});

describe('actual client generation safety and recovery', () => {
  it('ignores a wrong ID before touching even hostile fields', async () => {
    const { client, workers, states } = harness(); const request = simulation(); const pending = client.run(request);
    const getter = vi.fn(() => { throw new Error('must not read'); }); const data = { id: 'old' }; Object.defineProperty(data, 'protocolVersion', { get: getter });
    workers[0].deliver(data); expect(getter).not.toHaveBeenCalled(); expect(workers[0].terminated).toBe(false); expect(states.at(-1)?.running).toBe(true);
    const accepted = resultMessage(request); workers[0].deliver(accepted); expect(await pending).toBe(accepted.result); client.dispose();
  });
  it('terminates invalid active payloads and creates a real replacement on retry', async () => {
    for (const bad of [null, [], { protocolVersion: 9 }, { type: 'progress', fraction: NaN }, { type: 'result', result: {} }]) {
      const { client, workers, states } = harness(); const request = simulation(); const pending = client.run(request); const rejection = expect(pending).rejects.toThrow('Run again to restart');
      workers[0].deliver(bad === null || Array.isArray(bad) ? bad : { ...simulationEnvelope(request.id), ...bad });
      await rejection; expect(workers[0].terminated).toBe(true); expect(states.at(-1)).toMatchObject({ running: false, cancelling: false });
      const retry = simulation('retry'); const next = client.run(retry); expect(workers).toHaveLength(2); workers[1].deliver(resultMessage(retry)); expect((await next).status).toBe('completed'); client.dispose();
    }
  });
  it('old worker callbacks never alter a replacement even when they claim its new ID', async () => {
    const { client, workers, states } = harness(); const first = client.run(simulation('first')); const rejected = expect(first).rejects.toThrow('Superseded');
    const request = simulation('second'); const second = client.run(request); await rejected;
    workers[0].deliver(null); workers[0].deliver({ ...simulationEnvelope(request.id), protocolVersion: 9 }); workers[0].crash(); workers[0].onmessageerror?.({} as MessageEvent);
    expect(states.at(-1)).toMatchObject({ running: true, error: null }); expect(workers[1].terminated).toBe(false);
    workers[1].deliver(resultMessage(request)); expect((await second).status).toBe('completed'); client.dispose();
  });
  it('keeps same-worker stale results/errors away from a later request', async () => {
    const { client, workers, states } = harness(); const first = simulation('first'); const a = client.run(first); workers[0].deliver(resultMessage(first)); await a;
    const second = simulation('second'); const b = client.run(second); expect(workers).toHaveLength(1);
    workers[0].deliver({ ...simulationEnvelope(first.id), type: 'error', message: 'old' }); workers[0].deliver({ ...simulationEnvelope(first.id), type: 'result', result: null });
    expect(states.at(-1)?.error).toBeNull(); expect(states.at(-1)?.running).toBe(true); workers[0].deliver(resultMessage(second)); await b; client.dispose();
  });
  it('cooperatively cancels simulation with a versioned message and accepts its actual partial result', async () => {
    const { client, workers, states } = harness(); const request = simulation(); const pending = client.run(request); client.cancel();
    expect(workers[0].sent.at(-1)).toEqual({ ...simulationEnvelope(request.id), type: 'cancel' }); expect(states.at(-1)?.cancelling).toBe(true);
    const partial = simulate(request.model, { shouldCancel: () => true }); workers[0].deliver({ ...simulationEnvelope(request.id), type: 'result', result: partial });
    expect((await pending).status).toBe('cancelled'); expect(states.at(-1)?.cancelling).toBe(false); client.dispose();
  });
  it('terminates synchronous experiments on cancel, ignores late results and accepts a retry', async () => {
    const workers: FakeWorker[] = []; const states: WorkerState[] = [];
    const client = new WorkerClient(() => { const w = new FakeWorker(); workers.push(w); return w; }, readExperimentResponse, s => states.push(s), 'experiment');
    const request = replications(); const first = client.run(request); const rejected = expect(first).rejects.toThrow('No partial estimate'); client.cancel(); await rejected;
    expect(workers[0].terminated).toBe(true); expect(workers[0].sent).toHaveLength(1);
    const retry = replications('retry'); const second = client.run(retry); workers[0].deliver({ ...experimentEnvelope(retry.id, 'replications'), type: 'result', value: null });
    expect(workers[1].terminated).toBe(false); workers[1].deliver({ ...experimentEnvelope(retry.id, 'replications'), type: 'result', value: runExperiment(retry.model, retry.seeds) });
    expect((await second).kind).toBe('replications'); expect(workers[1].terminated).toBe(true); expect(states.at(-1)?.error).toBeNull(); client.dispose();
  });
  it('rejects an active experiment kind mismatch while preserving the last accepted object', async () => {
    const workers: FakeWorker[] = []; const states: WorkerState[] = [];
    const client = new WorkerClient(() => { const w = new FakeWorker(); workers.push(w); return w; }, readExperimentResponse, s => states.push(s), 'experiment');
    const first = replications(); const value = runExperiment(first.model, first.seeds); let accepted: unknown;
    const pending = client.run(first).then(value => { accepted = value; });
    workers[0].deliver({ ...experimentEnvelope(first.id, first.kind), type: 'result', value }); await pending; const previous = accepted;
    const retry = replications('retry'); const rejected = expect(client.run(retry)).rejects.toThrow('incompatible or invalid');
    workers[1].deliver({ ...experimentEnvelope(retry.id, 'paired'), type: 'progress', fraction: .5 }); await rejected;
    expect(accepted).toBe(previous); expect(workers[1].terminated).toBe(true); expect(states.at(-1)?.running).toBe(false);
    const recovered = replications('recovered'); const next = client.run(recovered); expect(workers).toHaveLength(3);
    workers[2].deliver({ ...experimentEnvelope(recovered.id, recovered.kind), type: 'result', value }); expect((await next).kind).toBe('replications'); client.dispose();
  });
  it('recovers from startup, postMessage, messageerror and worker errors without a stuck pending request', async () => {
    let starts = 0; const worker = new FakeWorker(); const client = new WorkerClient(() => { if (++starts === 1) throw new Error('start failed'); return worker; }, readSimulationResponse, () => {}, 'simulation');
    await expect(client.run(simulation())).rejects.toThrow('Run again to retry'); const request = simulation('retry'); const retry = client.run(request); worker.deliver(resultMessage(request)); await retry;
    for (const mode of ['post', 'decode', 'crash', 'error'] as const) {
      const { client, workers } = harness(); client.prepare(); workers[0].throwOnPost = mode === 'post'; const pending = client.run(simulation()); const rejected = expect(pending).rejects.toThrow('Run again');
      if (mode === 'decode') workers[0].onmessageerror?.({} as MessageEvent);
      if (mode === 'crash') workers[0].crash();
      if (mode === 'error') workers[0].deliver({ ...simulationEnvelope('run-1'), type: 'error', message: 'Numerical failure.' });
      await rejected; expect(workers[0].terminated).toBe(true); const request = simulation('retry'); const retry = client.run(request); workers[1].deliver(resultMessage(request)); await retry; client.dispose();
    }
  });
});


describe('actual worker endpoints', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('rejects malformed simulation requests and emits versioned start/progress/result/error', async () => {
    const messages: unknown[] = [];
    const endpoint = { onmessage: null as null | ((event: MessageEvent<unknown>) => Promise<void>), postMessage: (message: unknown) => messages.push(message) };
    vi.stubGlobal('self', endpoint); await import('../src/worker/simulation.worker');
    await endpoint.onmessage!({ data: null } as MessageEvent); expect(messages).toEqual([]);
    const bad = { ...simulation(), protocolVersion: 0 }; await endpoint.onmessage!({ data: bad } as MessageEvent);
    expect(messages).toEqual([expect.objectContaining({ ...simulationEnvelope(bad.id), type: 'error' })]);
    messages.length = 0;
    const request = simulation(); await endpoint.onmessage!({ data: request } as MessageEvent);
    expect(messages[0]).toMatchObject({ ...simulationEnvelope(request.id), type: 'start' });
    expect(messages.some(message => readSimulationResponse(message, request).type === 'progress')).toBe(true);
    const last = readSimulationResponse(messages.at(-1), request); expect(last.type === 'result' && last.result.status).toBe('completed');
  });
  it('returns an actual versioned cancelled partial run after cooperative cancellation', async () => {
    vi.resetModules(); const messages: unknown[] = [];
    const endpoint = { onmessage: null as null | ((event: MessageEvent<unknown>) => Promise<void>), postMessage: (message: unknown) => messages.push(message) };
    vi.stubGlobal('self', endpoint); await import('../src/worker/simulation.worker');
    const request = simulation(); const source = request.model.nodes[0] as Extract<SimulationModel['nodes'][number], { kind: 'source' }>;
    source.arrival = { kind: 'schedule', times: Array(10_000).fill(0) };
    const task = endpoint.onmessage!({ data: request } as MessageEvent);
    await endpoint.onmessage!({ data: { ...simulationEnvelope(request.id), type: 'cancel' } } as MessageEvent);
    await task; const result = readSimulationResponse(messages.at(-1), request);
    expect(result.type === 'result' && result.result.status).toBe('cancelled');
    for (const message of messages) expect(() => readSimulationResponse(message, request)).not.toThrow();
  });
  it('validates the synchronous experiment endpoint before nested traversal and never accepts a cancel message', async () => {
    const messages: unknown[] = [];
    const endpoint = { onmessage: null as null | ((event: MessageEvent<unknown>) => void), postMessage: (message: unknown) => messages.push(message) };
    vi.stubGlobal('self', endpoint); await import('../src/worker/experiments.worker');
    for (const data of [null, [], {}, { ...replications(), type: 'cancel' }]) endpoint.onmessage!({ data } as MessageEvent);
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ type: 'error', protocolVersion: 1 }); messages.length = 0;
    const request = replications(); endpoint.onmessage!({ data: request } as MessageEvent);
    expect(messages[0]).toMatchObject({ ...experimentEnvelope(request.id, request.kind), type: 'start' });
    for (const message of messages) expect(() => readExperimentResponse(message, request)).not.toThrow();
    const last = readExperimentResponse(messages.at(-1), request); expect(last.type === 'result' && last.result.kind).toBe('replications');
    messages.length = 0;
    endpoint.onmessage!({ data: { ...request, model: null } } as MessageEvent); expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'error', protocolVersion: 1 });
  });
});
