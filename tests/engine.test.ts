import { describe, expect, it } from 'vitest';
import { simulate, simulateAsync } from '../src/engine';
import { uniform } from '../src/engine/random';
import type { QueueNode, ServiceNode, SimulationModel, SourceNode } from '../src/model/types';
import { createExample } from '../src/examples';

const source = (times: number[], next = 'q', id = 'src', priority = 0): SourceNode => ({ id, samplingId: id, label: id, kind: 'source', next, arrival: { kind: 'schedule', times }, classes: [{ id: 'c', label: 'C', priority, probability: 1 }] });
const queue = (next = 's', id = 'q'): QueueNode => ({ id, samplingId: id, label: id, kind: 'queue', next, capacity: null, discipline: 'fifo', patience: null });
const service = (duration = 10, next = 'out', id = 's'): ServiceNode => ({ id, samplingId: id, label: id, kind: 'service', next, duration: { kind: 'constant', value: duration }, servers: 1, resources: [] });
function fixture(times = [0, 5, 10], duration = 10, horizon = 40): SimulationModel {
  return { id: 'test', name: 'Test', horizon, warmup: 0, seed: 42, slaSeconds: 5, currency: 'USD', resources: [], nodes: [source(times), queue(), service(duration), { id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' }] };
}
const starts = (result: ReturnType<typeof simulate>) => result.events.filter(e => e.kind === 'start').map(e => [e.entityId, e.nodeId, e.time]);
const deterministic = (run: ReturnType<typeof simulate>) => { const { elapsedMs: _ms, ...rest } = run; return rest; };

describe('hand-calculated deterministic engine', () => {
  it('matches the FIFO table and independent area/denominators', () => {
    const result = simulate(fixture());
    expect(result.status).toBe('completed');
    expect(starts(result)).toEqual([['src:0', 's', 0], ['src:1', 's', 10], ['src:2', 's', 20]]);
    expect(result.entities.map(e => [e.endedAt, e.visits.find(v => v.nodeId === 'q')?.end])).toEqual([[10, 0], [20, 10], [30, 20]]);
    expect(result.summary).toMatchObject({ arrivals: 3, completed: 3, balked: 0, reneged: 0, inSystem: 0, meanWait: 5, meanSojourn: 15, p95Wait: 10, waitSampleSize: 3, slaMet: 2, slaRate: 2 / 3 });
    expect(result.stations[0]).toMatchObject({ averageQueue: 15 / 40, busySeconds: 30, utilization: 0.75, averageWait: 5 });
  });
  it('advances through two true service stages and modeled delay', () => {
    const m = fixture([0, 1], 4, 20); (m.nodes[2] as ServiceNode).next = 'd';
    m.nodes.push({ id: 'd', samplingId: 'd', label: 'Transfer', kind: 'delay', next: 'q2', duration: { kind: 'constant', value: 2 } }, queue('s2', 'q2'), service(5, 'out', 's2'));
    const r = simulate(m);
    expect(starts(r)).toEqual([['src:0', 's', 0], ['src:1', 's', 4], ['src:0', 's2', 6], ['src:1', 's2', 11]]);
    expect(r.entities.map(e => e.endedAt)).toEqual([11, 16]); expect(r.summary.meanWait).toBe(2);
  });
  it('traverses Route and zero Delay before dispatch and leaves unfinished Delay censored', () => {
    const m = fixture([0], 2, 10); (m.nodes[0] as SourceNode).next = 'route';
    m.nodes.push({ id: 'route', samplingId: 'route', label: 'Route', kind: 'route', branches: [{ to: 'zero', probability: 1 }] }, { id: 'zero', samplingId: 'zero', label: 'Zero Delay', kind: 'delay', duration: { kind: 'constant', value: 0 }, next: 'q' });
    expect(starts(simulate(m))).toEqual([['src:0', 's', 0]]);
    (m.nodes[2] as ServiceNode).next = 'long'; m.nodes.push({ id: 'long', samplingId: 'long', label: 'Long Delay', kind: 'delay', duration: { kind: 'constant', value: 20 }, next: 'out' });
    const r = simulate(m); expect(r.summary).toMatchObject({ completed: 0, inSystem: 1, waitSampleSize: 0 });
    expect(r.entities[0].visits.find(v => v.nodeId === 'long')).toEqual({ nodeId: 'long', arrival: 2, start: 2 });
    expect(r.diagnostics).toMatchObject({ activeTransfer: 1, activeWaiting: 0, activeService: 0 });
  });
  it('handles no arrivals and null denominators without NaN', () => {
    const r = simulate(fixture([])); expect(r.summary).toMatchObject({ arrivals: 0, completed: 0, meanWait: 0, waitSampleSize: 0, slaRate: null });
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
  it('runs examples with WIP conservation at every completed result', () => {
    for (const world of ['factory', 'festival', 'service'] as const) {
      const r = simulate(createExample(world).model); const s = r.summary;
      expect(r.status).toBe('completed'); expect(s.arrivals).toBe(s.completed + s.balked + s.reneged + s.inSystem);
      expect(r.entities.filter(e => e.status === 'active')).toHaveLength(s.inSystem);
      for (const c of r.classes) expect(c.arrivals).toBe(c.completed + c.balked + c.reneged + c.inSystem);
      expect(r.classes.reduce((sum, c) => sum + c.arrivals, 0)).toBe(s.arrivals);
      expect(r.classes.reduce((sum, c) => sum + c.completed, 0)).toBe(s.completed);
      expect(r.diagnostics.activeWaiting + r.diagnostics.activeService + r.diagnostics.activeTransfer).toBe(s.inSystem);
      expect(r.stations.every(s => s.utilization! >= 0 && s.utilization! <= 1)).toBe(true);
    }
  });
});

describe('timestamp transaction, priority and abandonment', () => {
  it('reuses a zero waiting buffer at the exact completion boundary', () => {
    const m = fixture([0, 5, 10, 10], 10, 30); (m.nodes[1] as QueueNode).capacity = 0;
    const r = simulate(m);
    expect(starts(r)).toEqual([['src:0', 's', 0], ['src:2', 's', 10]]);
    expect(r.summary).toMatchObject({ completed: 2, balked: 2, inSystem: 0 });
    expect(r.events.filter(e => e.time === 10).map(e => e.kind)).toEqual(['finish', 'complete', 'arrival', 'arrival', 'start', 'balk']);
  });
  it('lets a completion free the full waiting buffer before new admission', () => {
    const m = fixture([0, 1, 10], 10, 31); (m.nodes[1] as QueueNode).capacity = 1;
    const r = simulate(m); expect(r.summary.balked).toBe(0); expect(r.summary.completed).toBe(3);
    expect(starts(r).map(x => x[2])).toEqual([0, 10, 20]);
  });
  it('new priority competes with old waiting work without preempting service', () => {
    const m = fixture([0, 1], 10, 35); (m.nodes[1] as QueueNode).discipline = 'priority';
    m.nodes.push(source([5, 10], 'q', 'urgent', -1));
    const r = simulate(m);
    expect(starts(r)).toEqual([['src:0', 's', 0], ['urgent:0', 's', 10], ['urgent:1', 's', 20], ['src:1', 's', 30]]);
  });
  it('dispatch beats patience expiration at the same time, while patience zero reneges', () => {
    const m = fixture([0, 5, 6], 10, 30); (m.nodes[1] as QueueNode).patience = { kind: 'constant', value: 5 };
    const r = simulate(m); expect(r.entities.map(e => e.status)).toEqual(['completed', 'completed', 'reneged']);
    expect(r.entities[2].endedAt).toBe(11); expect(r.summary).toMatchObject({ completed: 2, reneged: 1, balked: 0, meanWait: 2.5 });
    (m.nodes[1] as QueueNode).patience = { kind: 'constant', value: 0 };
    const zero = simulate(m); expect(zero.summary).toMatchObject({ completed: 1, reneged: 2, balked: 0 });
  });
  it('does not admit more work than waiting capacity during a burst', () => {
    const m = fixture([0, 0, 0, 0], 10, 25); (m.nodes[1] as QueueNode).capacity = 1;
    const r = simulate(m); expect(r.summary).toMatchObject({ completed: 2, balked: 2 });
    expect(r.stations[0].averageQueue).toBe(10 / 25);
  });
});

describe('atomic resources, shifts and observation windows', () => {
  it('allocates both pools atomically and bypasses an infeasible older request', () => {
    const m = fixture([0], 10, 30); m.resources = [
      { id: 'workers', label: 'Workers', capacity: 2, installedCapacity: 2, costPerHour: 3600, overtimeCostPerHour: 7200, calendar: [] },
      { id: 'tool', label: 'Tool', capacity: 0, installedCapacity: 1, costPerHour: 0, overtimeCostPerHour: 0, calendar: [{ start: 5, end: 30, capacity: 1 }] },
    ];
    (m.nodes[2] as ServiceNode).resources = [{ poolId: 'workers', units: 2 }, { poolId: 'tool', units: 1 }];
    m.nodes.push(source([1], 'q2', 'other'), queue('s2', 'q2'), service(10, 'out', 's2'));
    (m.nodes.at(-1) as ServiceNode).resources = [{ poolId: 'workers', units: 1 }];
    const r = simulate(m); expect(starts(r)).toEqual([['other:0', 's2', 1], ['src:0', 's', 11]]);
    expect(r.diagnostics.bypassedRequests).toBe(1);
    expect(r.pools.find(p => p.poolId === 'workers')).toMatchObject({ busyUnitSeconds: 30, scheduledUnitSeconds: 60, cost: 60, utilization: 0.5 });
  });
  it('honors 2→0→2, keeps service nonpreemptive and prices overtime separately', () => {
    const m = fixture([0, 0, 6], 10, 20); (m.nodes[2] as ServiceNode).servers = 2;
    (m.nodes[2] as ServiceNode).resources = [{ poolId: 'team', units: 1 }];
    m.resources = [{ id: 'team', label: 'Team', capacity: 2, installedCapacity: 2, calendar: [{ start: 5, end: 12, capacity: 0 }], costPerHour: 3600, overtimeCostPerHour: 7200 }];
    const r = simulate(m); expect(starts(r).map(e => e[2])).toEqual([0, 0, 12]);
    expect(r.summary).toMatchObject({ completed: 2, inSystem: 1 });
    expect(r.pools[0]).toMatchObject({ scheduledUnitSeconds: 26, busyUnitSeconds: 28, overtimeUnitSeconds: 10, cost: 46, utilization: 18 / 26 });
  });
  it('closing shift beats same-time dispatch after releasing completed work', () => {
    const m = fixture([0, 10], 10, 25); (m.nodes[2] as ServiceNode).resources = [{ poolId: 'team', units: 1 }];
    m.resources = [{ id: 'team', label: 'Team', capacity: 0, installedCapacity: 1, calendar: [{ start: 0, end: 10, capacity: 1 }], costPerHour: 3600, overtimeCostPerHour: 0 }];
    const r = simulate(m); expect(starts(r).map(e => e[2])).toEqual([0]); expect(r.stations[0].queueAtEnd).toBe(1); expect(r.pools[0].cost).toBe(10);
  });
  it('processes completion at T without dispatch, then patience expiration', () => {
    const m = fixture([0, 5], 10, 10); (m.nodes[1] as QueueNode).patience = { kind: 'constant', value: 5 };
    const r = simulate(m); expect(starts(r)).toHaveLength(1); expect(r.summary).toMatchObject({ completed: 1, reneged: 1, inSystem: 0 });
    expect(r.entities[0].endedAt).toBe(10); expect(r.entities[1].endedAt).toBe(10);
  });
  it('separates warm-up area, external-arrival cohort and censored WIP', () => {
    const m = fixture([0, 5, 10], 10, 25); m.warmup = 5;
    const r = simulate(m); expect(r.summary).toMatchObject({ arrivals: 2, completed: 1, inSystem: 1, meanWait: 5, waitSampleSize: 1, meanSojourn: 15, slaRate: 0.5, measurementStart: 5, measurementEnd: 25 });
    expect(r.stations[0]).toMatchObject({ averageQueue: 15 / 20, busySeconds: 20, finished: 1, averageWait: 5 });
    expect(r.diagnostics).toMatchObject({ totalArrivals: 3, activeService: 1, activeWaiting: 0, activeTransfer: 0 });
    expect(r.classes[0]).toMatchObject({ arrivals: 2, completed: 1, inSystem: 1, waitSampleSize: 1 });
  });
  it('reports N/A utilization for a never scheduled pool', () => {
    const m = fixture([]); m.resources = [{ id: 'off', label: 'Off', capacity: 0, installedCapacity: 1, calendar: [], costPerHour: 1, overtimeCostPerHour: 2 }];
    expect(simulate(m).pools[0].utilization).toBeNull();
  });
});

describe('keyed randomness and exact numeric semantics', () => {
  it('makes fixed source arrivals [0,T), with exact floating point event ordering', () => {
    const m = fixture([], 0.01, 1); (m.nodes[0] as SourceNode).arrival = { kind: 'fixed', perHour: 14400 };
    expect(simulate(m).entities.map(e => e.arrivedAt)).toEqual([0, 0.25, 0.5, 0.75]);
    (m.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0.3, 0.1 + 0.2] };
    const r = simulate(m); expect(r.events.filter(e => e.kind === 'arrival').map(e => e.time)).toEqual([0.3, 0.30000000000000004]);
  });
  it('uses integrated hazard across changing rates and zero-rate gaps', () => {
    const m = fixture([], 0.01, 100);
    (m.nodes[0] as SourceNode).arrival = { kind: 'poisson', segments: [{ start: 0, end: 2, perHour: 1 }, { start: 10, end: 100, perHour: 3600 }] };
    const hazard = -Math.log1p(-uniform(42, 'src', 0, 'arrival'));
    const r = simulate(m); expect(r.entities[0].arrivedAt).toBeCloseTo(10 + hazard - 2 / 3600, 12);
    expect(r.entities.every(e => e.arrivedAt >= 10 && e.arrivedAt < 100)).toBe(true);
  });
  it('is reproducible under model array reordering, labels and capacity changes', () => {
    const m = createExample('factory').model; const a = simulate(m);
    const reordered = structuredClone(m); reordered.nodes.reverse(); reordered.resources.reverse(); reordered.name = 'Renamed';
    reordered.nodes.forEach(n => { n.label = 'Renamed'; if (n.kind === 'service') n.resources.reverse(); });
    const b = simulate(reordered); expect(a.summary).toEqual(b.summary); expect(a.events).toEqual(b.events); expect(a.modelHash).toBe(b.modelHash);
    const more = structuredClone(m); more.resources[0].capacity = 2;
    const c = simulate(more); expect(c.demandHash).toBe(a.demandHash);
    expect(c.entities.map(e => [e.id, e.arrivedAt, e.classId])).toEqual(a.entities.map(e => [e.id, e.arrivedAt, e.classId]));
    const durations = (r: typeof a, node: string) => new Map(r.entities.flatMap(e => e.visits.filter(v => v.nodeId === node && v.end !== undefined && v.start !== undefined).map(v => [e.id, v.end! - v.start!])));
    const x = durations(a, 'station-a'); const y = durations(c, 'station-a');
    for (const [id, value] of x) if (y.has(id)) expect(y.get(id)).toBeCloseTo(value, 10);
  });
  it('does not change any full metric or draw when trace storage is disabled', () => {
    const m = createExample('service').model; const a = simulate(m); const b = simulate(m, { maxTraceEntities: 0, maxTraceEvents: 0 });
    expect(b.summary).toEqual(a.summary); expect(b.stations).toEqual(a.stations); expect(b.pools).toEqual(a.pools); expect(b.processedEvents).toBe(a.processedEvents); expect(b.entities).toEqual([]);
    const direct = fixture([0, 3], 10, 20); direct.nodes = direct.nodes.filter(n => n.kind !== 'queue'); (direct.nodes[0] as SourceNode).next = 's'; (direct.nodes[1] as ServiceNode).duration = { kind: 'exponential', mean: 3 };
    expect(simulate(direct, { maxTraceEntities: 0 }).summary).toEqual(simulate(direct).summary);
  });
  it('keeps class and route draws stable when unordered input lists are reversed', () => {
    const m = fixture(Array.from({ length: 100 }, (_, i) => i), 1, 200);
    const src = m.nodes[0] as SourceNode; src.next = 'route'; src.classes = [{ id: 'a', label: 'A', priority: 0, probability: 0.4 }, { id: 'b', label: 'B', priority: -1, probability: 0.6 }];
    m.nodes.push({ id: 'route', samplingId: 'route', label: 'Branch', kind: 'route', branches: [{ to: 'q', probability: 0.4 }, { to: 'q2', probability: 0.6 }] }, queue('s2', 'q2'), service(2, 'out', 's2'));
    const a = simulate(m); src.classes.reverse(); const route = m.nodes.find(n => n.kind === 'route')!;
    if (route.kind === 'route') route.branches.reverse(); m.nodes.reverse();
    const b = simulate(m); expect(b.events).toEqual(a.events); expect(b.summary).toEqual(a.summary); expect(b.demandHash).toBe(a.demandHash); expect(b.modelHash).toBe(a.modelHash);
  });
  it('reports a truthful prefix after trace saturation while computing full statistics', () => {
    const a = simulate(fixture(), { maxTraceEvents: 5 }); const b = simulate(fixture());
    expect(a.status).toBe('completed'); expect(a.summary).toEqual(b.summary); expect(a.trace).toMatchObject({ complete: false, until: 5 }); expect(a.events).toHaveLength(5);
  });
  it('fails explicitly when a positive service duration cannot advance Number time', () => {
    const r = simulate(fixture([1], Number.MIN_VALUE, 2)); expect(r.status).toBe('failed'); expect(r.reason).toContain('numeric-precision');
    expect(r.simulatedUntil).toBe(1); expect(r.summary.completed).toBe(0);
    const m = fixture([1], 1, 3); (m.nodes[0] as SourceNode).next = 'd'; m.nodes.push({ id: 'd', samplingId: 'd', label: 'D', kind: 'delay', next: 'q', duration: { kind: 'constant', value: Number.MIN_VALUE } });
    expect(simulate(m).reason).toContain('numeric-precision');
  });
  it('rejects invalid models before starting execution', () => {
    const m = fixture(); (m.nodes[2] as ServiceNode).duration = { kind: 'constant', value: NaN }; expect(() => simulate(m)).toThrow('Time must');
    const cycle = fixture(); (cycle.nodes[2] as ServiceNode).next = 'd'; cycle.nodes.push({ id: 'd', samplingId: 'd', label: 'D', kind: 'delay', next: 'd', duration: { kind: 'constant', value: 0 } });
    expect(() => simulate(cycle)).toThrow('zero-time loop');
  });
});

describe('bounded execution and asynchronous cancellation', () => {
  it('returns limited results for entity, work and same-time transition budgets', () => {
    expect(simulate(fixture(), { maxEntities: 1 })).toMatchObject({ status: 'limited', summary: { arrivals: 1, completed: 0, inSystem: 1 } });
    expect(simulate(fixture(), { maxEvents: 3 }).status).toBe('limited');
    const m = fixture(); (m.nodes[0] as SourceNode).next = 'r'; m.nodes.push({ id: 'r', samplingId: 'r', label: 'R', kind: 'route', branches: [{ to: 'q', probability: 1 }] });
    expect(simulate(m, { maxMicrosteps: 1 }).status).toBe('limited');
  });
  it('produces the same result synchronously and with chunked execution', async () => {
    const m = fixture(); expect(deterministic(await simulateAsync(m))).toEqual(deterministic(simulate(m)));
  });
  it('yields inside a huge simultaneous arrival transaction so cancellation is read', async () => {
    const m = fixture(Array.from({ length: 10_000 }, () => 0), 10, 100); let cancelled = false;
    const promise = simulateAsync(m, { shouldCancel: () => cancelled, maxMicrosteps: 50_000 });
    setTimeout(() => { cancelled = true; }, 0);
    const result = await promise;
    expect(result.status).toBe('cancelled'); expect(result.summary.arrivals).toBeLessThan(10_000); expect(result.trace.complete).toBe(false);
    expect(result.summary.arrivals).toBe(result.summary.completed + result.summary.balked + result.summary.reneged + result.summary.inSystem);
  });
});
