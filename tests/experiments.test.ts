import { describe, expect, it } from 'vitest';
import { capacitySearch, comparePaired, estimate, runExperiment, runExperimentAsync } from '../src/experiments';
import type { SimulationModel } from '../src/model/types';

function model(): SimulationModel {
  return { id: 'm', name: 'Experiment', horizon: 20, warmup: 0, seed: 1, slaSeconds: 10, currency: 'USD',
    resources: [{ id: 'team', label: 'Team', installedCapacity: 3, capacity: 1, calendar: [], costPerHour: 3600, overtimeCostPerHour: 0 }],
    nodes: [
      { id: 'src', samplingId: 'src', label: 'Source', kind: 'source', next: 'q', arrival: { kind: 'schedule', times: [0, 0, 0] }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] },
      { id: 'q', samplingId: 'q', label: 'Queue', kind: 'queue', next: 's', capacity: null, discipline: 'fifo', patience: null },
      { id: 's', samplingId: 's', label: 'Service', kind: 'service', next: 'out', servers: 3, duration: { kind: 'constant', value: 10 }, resources: [{ poolId: 'team', units: 1 }] },
      { id: 'out', samplingId: 'out', label: 'Out', kind: 'sink' },
    ] };
}

describe('replications and uncertainty', () => {
  it('uses sample variance and Student-t, with no interval for n<2', () => {
    expect(estimate([8])).toEqual({ mean: 8, samples: 1, standardError: null, lower95: null, upper95: null });
    const e = estimate([1, 2, 3]); expect(e.mean).toBe(2); expect(e.standardError).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(e.upper95).toBeCloseTo(2 + 4.30265273 / Math.sqrt(3), 8);
  });
  it('preserves independent seed provenance and drops unnecessary detailed traces', async () => {
    const r = runExperiment(model(), [11, 22, 33]); expect(r.runs.map(r => r.seed)).toEqual([11, 22, 33]); expect(r.completed.mean).toBe(2); expect(r.wait.mean).toBe(5);
    expect(r.runs.every(r => r.entities.length === 0 && r.events.length === 0)).toBe(true);
    expect((await runExperimentAsync(model(), [11, 22, 33])).wait).toEqual(r.wait);
    expect(() => runExperiment(model(), [1, 1])).toThrow('distinct');
  });
  it('shares a frozen snapshot across runs and isolates it from later input edits', async () => {
    const input = model(); const r = runExperiment(input, [1, 2, 3]);
    expect(r.runs[0].model).toBe(r.runs[2].model);
    expect(Object.isFrozen(r.runs[0].model.nodes)).toBe(true);
    input.name = 'Later draft'; expect(r.runs[0].model.name).toBe('Experiment');
    const copy = structuredClone(r); expect(copy.runs[0].model).toBe(copy.runs[2].model);
    const async = await runExperimentAsync(input, [1, 2]); expect(async.runs[0].model).toBe(async.runs[1].model);
  });
  it('excludes incomplete runs from all estimates', () => {
    expect(() => runExperiment(model(), [1, 2], { maxEvents: 1 })).toThrow('limited');
  });
  it('does not turn an empty completed cohort into a zero-wait observation', () => {
    const m = model(); m.resources[0].capacity = 0;
    const r = runExperiment(m, [1, 2]); expect(r.completed.samples).toBe(2); expect(r.wait.samples).toBe(0); expect(r.wait.lower95).toBeNull();
    expect(capacitySearch(m, { poolId: 'team', capacities: [0], trainingSeeds: [1], verificationSeeds: [2], maxMeanWait: 100 }).selectedCapacity).toBeNull();
  });
  it('computes paired candidate-minus-baseline deltas under matching demand', () => {
    const a = model(); const b = model(); b.resources[0].capacity = 2;
    const result = comparePaired(a, b, [1, 2, 3]); expect(result.paired).toBe(true); expect(result.delta.completed.mean).toBe(1); expect(result.delta.wait.mean).toBeCloseTo(-5 / 3, 12); expect(result.delta.cost.mean).toBe(20);
    expect(result.delta.completed.standardError).toBe(0);
  });
  it('does not label differing demand or windows as paired', () => {
    const a = model(); const b = model(); b.warmup = 1;
    const result = comparePaired(a, b, [1, 2]); expect(result.paired).toBe(false); expect(result.delta.wait.samples).toBe(0); expect(result.delta.wait.lower95).toBeNull();
    b.warmup = 0; b.nodes[0].samplingId = 'different'; expect(comparePaired(a, b, [1, 2]).paired).toBe(false);
  });
});

describe('bounded capacity candidates and held-out verification', () => {
  it('chooses the cheapest feasible candidate and checks independent seeds', () => {
    const result = capacitySearch(model(), { poolId: 'team', capacities: [3, 1, 2], trainingSeeds: [1, 2], verificationSeeds: [3, 4], targetCompleted: 3, maxRuns: 8 });
    expect(result.candidates.map(c => [c.capacity, c.feasible])).toEqual([[1, false], [2, true], [3, true]]);
    expect(result.selectedCapacity).toBe(2); expect(result.verification?.seeds).toEqual([3, 4]); expect(result.verified).toBe(true); expect(result.totalRuns).toBe(8);
  });
  it('rejects overlapping held-out seeds and over-budget searches before execution', () => {
    expect(() => capacitySearch(model(), { poolId: 'team', capacities: [1, 2], trainingSeeds: [1], verificationSeeds: [1] })).toThrow('disjoint');
    expect(() => capacitySearch(model(), { poolId: 'team', capacities: [1, 2], trainingSeeds: [1], verificationSeeds: [2], maxRuns: 2 })).toThrow('budget');
  });
  it('rejects oversized retained candidate snapshots before any simulation runs', () => {
    const m = model();
    const service = m.nodes.find(n => n.kind === 'service')!;
    const source = m.nodes.find(n => n.kind === 'source')!; source.arrival = { kind: 'schedule', times: [] };
    for (let i = 0; i < 85; i++) m.nodes.push({ ...service, id: `extra-${i}`, samplingId: `extra-${i}`, duration: { kind: 'empirical', values: Array(10_000).fill(1.12345678901234) } });
    expect(() => capacitySearch(m, { poolId: 'team', capacities: [0, 1, 2, 3], trainingSeeds: [1], verificationSeeds: [2] })).toThrow('32 MiB');
  });
  it('does not invent an optimal candidate when constraints are infeasible', () => {
    const r = capacitySearch(model(), { poolId: 'team', capacities: [1], trainingSeeds: [1], verificationSeeds: [2], targetCompleted: 100 });
    expect(r.selectedCapacity).toBeNull(); expect(r.verification).toBeNull(); expect(r.verified).toBe(false);
  });
});
