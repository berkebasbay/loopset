import { describe, expect, it } from 'vitest';
import { simulate, simulateAsync } from '../src/engine';
import { RequestQueue } from '../src/engine/requestQueue';
import type { QueueNode, ServiceNode, SimulationModel, SourceNode } from '../src/model/types';

const source = (id: string, times: number[], next: string, priority = 0): SourceNode => ({
  id, samplingId: id, label: id, kind: 'source', next, arrival: { kind: 'schedule', times },
  classes: [{ id: `${id}-class`, label: id, priority, probability: 1 }],
});
const queue = (id: string, next: string): QueueNode => ({ id, samplingId: id, label: id, kind: 'queue', next, capacity: null, discipline: 'fifo', patience: null });
const service = (id: string, duration: number): ServiceNode => ({ id, samplingId: id, label: id, kind: 'service', next: 'out', duration: { kind: 'constant', value: duration }, servers: 1, resources: [] });
function model(horizon: number): SimulationModel {
  return { id: 'volume', name: 'Volume reference', horizon, warmup: 0, seed: 42, slaSeconds: 5, currency: 'USD', resources: [], nodes: [{ id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' }] };
}

describe('ordered request backlog', () => {
  it('keeps rank/head/removal equal to an independently sorted set without quadratic work', () => {
    let comparisons = 0;
    const waiting = new RequestQueue<number>((a, b) => { comparisons++; return a - b; });
    const reference = new Set<number>();
    // Coprime stride exercises both rotations and removal from either side.
    for (let i = 0; i < 4096; i++) { const n = i * 1597 % 4096; waiting.push(n); reference.add(n); }
    for (let i = 0; i < 4096; i++) {
      const n = i * 2371 % 4096;
      const sorted = [...reference].sort((a, b) => a - b);
      expect(waiting.size).toBe(sorted.length); expect(waiting.peek()).toBe(sorted[0]);
      expect(waiting.countBefore(n)).toBe(sorted.filter(value => value < n).length);
      waiting.remove(n); reference.delete(n);
    }
    expect(waiting.size).toBe(0); expect(waiting.peek()).toBeUndefined();
    // An algorithmic bound, not a machine-dependent duration assertion.
    expect(comparisons).toBeLessThan(4096 * 60);
  });
});

describe('exact high-volume dispatch', () => {
  it('completes 150,000 overloaded arrivals with hand-calculated FIFO totals and exact quantiles', () => {
    const m = model(1500);
    const input = source('input', [], 'waiting'); input.arrival = { kind: 'fixed', perHour: 360000 };
    m.nodes.push(input, queue('waiting', 'machine'), service('machine', 1));
    const result = simulate(m, { maxEvents: 10_000_000, maxEntities: 200_000, maxTraceEntities: 0, maxTraceEvents: 0 });
    expect(result.status).toBe('completed');
    expect(result.summary).toMatchObject({ arrivals: 150_000, completed: 1500, inSystem: 148_500, balked: 0, reneged: 0, waitSampleSize: 1500 });
    expect(result.summary.meanWait).toBeCloseTo(.99 * 1499 / 2, 9);
    expect(result.summary.meanSojourn).toBeCloseTo(.99 * 1499 / 2 + 1, 9);
    expect(result.summary.p50Wait).toBeCloseTo(.99 * 749, 9);
    expect(result.summary.p95Wait).toBeCloseTo(.99 * 1424, 9);
    expect(result.stations[0]).toMatchObject({ started: 1500, finished: 1500, queueAtEnd: 148500, busyAtEnd: 0, busySeconds: 1500 });
    expect(result.diagnostics).toMatchObject({ totalArrivals: 150000, activeWaiting: 148500, activeService: 0, bypassedRequests: 0 });
    expect(result.processedEvents).toBeLessThan(5 * result.summary.arrivals);
    expect(result.trace.complete).toBe(false);
  }, 15000);

  it('counts each blocked prefix once when several later stations can allocate a shared pool', () => {
    const m = model(15);
    const a = service('machine-a', 2); a.resources = [{ poolId: 'team', units: 2 }, { poolId: 'tool', units: 1 }];
    const b = service('machine-b', 4); b.servers = 2; b.resources = [{ poolId: 'team', units: 1 }];
    const c = service('machine-c', 8); c.resources = [{ poolId: 'team', units: 1 }];
    m.resources = [
      { id: 'team', label: 'Team', installedCapacity: 3, capacity: 3, costPerHour: 3600, overtimeCostPerHour: 0, calendar: [] },
      { id: 'tool', label: 'Tool', installedCapacity: 1, capacity: 0, costPerHour: 0, overtimeCostPerHour: 0, calendar: [{ start: 5, end: 15, capacity: 1 }] },
    ];
    m.nodes.push(source('a', [0, 0, 0], 'qa'), queue('qa', a.id), a, source('b', [0, 0], 'qb'), queue('qb', b.id), b, source('c', [0], 'qc'), queue('qc', c.id), c);
    const result = simulate(m);
    expect(result.events.filter(event => event.kind === 'start').map(event => [event.entityId, event.time])).toEqual([
      ['b:0', 0], ['b:1', 0], ['c:0', 0], ['a:0', 5], ['a:1', 7], ['a:2', 9],
    ]);
    expect(result.diagnostics.bypassedRequests).toBe(3);
    expect(result.summary).toMatchObject({ arrivals: 6, completed: 6, meanWait: 3.5, meanSojourn: 43 / 6 });
    expect(result.pools.find(pool => pool.poolId === 'team')).toMatchObject({ busyUnitSeconds: 28, scheduledUnitSeconds: 45 });
  });

  it('removes expired priority requests while preserving finite admission and deadline service order', async () => {
    const m = model(30); const q = queue('waiting', 'machine'); q.discipline = 'priority'; q.capacity = 2; q.patience = { kind: 'constant', value: 5 };
    m.nodes.push(source('ordinary', [0, 0, 0, 0], q.id), source('urgent', [1, 10], q.id, -1), q, service('machine', 10));
    const result = simulate(m);
    expect(result.summary).toMatchObject({ arrivals: 6, completed: 2, reneged: 2, balked: 2, inSystem: 0 });
    expect(result.events.filter(event => event.kind === 'start').map(event => [event.entityId, event.time])).toEqual([['ordinary:0', 0], ['urgent:1', 10]]);
    const asyncResult = await simulateAsync(m);
    const { elapsedMs: _a, ...a } = result; const { elapsedMs: _b, ...b } = asyncResult;
    expect(b).toEqual(a);
  });
});
