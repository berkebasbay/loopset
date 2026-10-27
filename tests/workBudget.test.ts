import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { capacitySearch, capacitySearchPlan } from '../src/experiments';
import { arrivalExpectation, calculationBudget } from '../src/model/workBudget';

describe('pre-run workload estimates', () => {
  it('counts scheduled warm-up arrivals before numerical caps instead of final-cohort completions', () => {
    const model = createExample('factory').model; model.warmup = 2;
    const source = model.nodes.find(node => node.kind === 'source')!;
    source.arrival = { kind: 'schedule', times: [0, 1, 2, 3] };
    expect(arrivalExpectation(model)).toEqual({ count: 4, stochastic: false });
    const run = simulate(model, { maxEntities: 2 });
    expect(run.status).toBe('limited'); expect(run.diagnostics.totalArrivals).toBe(2); expect(run.summary.arrivals).toBe(0);
  });
  it('integrates separated Poisson periods as an expectation, including a zero-rate gap', () => {
    const model = createExample('factory').model;
    model.nodes.find(node => node.kind === 'source')!.arrival = { kind: 'poisson', segments: [{ start: 0, end: 900, perHour: 40 }, { start: 900, end: 1800, perHour: 0 }, { start: 2700, end: 3600, perHour: 80 }] };
    expect(arrivalExpectation(model)).toEqual({ count: 30, stochastic: true });
  });
  it.each([0.3, 0.30000000000000004, 0.3000000000000001])('honors the half-open floating-point fixed-arrival boundary at %s', horizon => {
    const model = createExample('factory').model; model.horizon = horizon;
    model.nodes.find(node => node.kind === 'source')!.arrival = { kind: 'fixed', perHour: 36000 };
    expect(arrivalExpectation(model).count).toBe(simulate(model).diagnostics.totalArrivals);
  });
  it.each([
    [1, Number.MIN_VALUE], [1, 1e-307], [1, 1e-300], [Number.MIN_VALUE, 3600], [Number.MIN_VALUE, 1e-307],
  ])('counts one first fixed arrival with horizon %s and rate %s despite overflow/underflow', (horizon, perHour) => {
    const model = createExample('factory').model; model.horizon = horizon;
    model.nodes.find(node => node.kind === 'source')!.arrival = { kind: 'fixed', perHour };
    expect(arrivalExpectation(model)).toEqual({ count: 1, stochastic: false });
    const run = simulate(model); expect(run.status).toBe('completed'); expect(run.diagnostics.totalArrivals).toBe(1);
  });
  it('combines all external sources and allows a zero-demand source', () => {
    const model = createExample('factory').model;
    const source = model.nodes.find(node => node.kind === 'source')!; source.arrival = { kind: 'fixed', perHour: 2 };
    model.nodes.push({ ...source, id: 'other', samplingId: 'other', arrival: { kind: 'schedule', times: [0, 7, 8] } });
    model.nodes.push({ ...source, id: 'empty', samplingId: 'empty', arrival: { kind: 'fixed', perHour: 0 } });
    expect(arrivalExpectation(model)).toEqual({ count: 5, stochastic: false });
  });
  it('counts paired and conditional search work without running models or inflating trace retention', () => {
    const model = createExample('factory').model;
    const paired = calculationBudget([{ label: 'Baseline', model, runs: 30 }, { label: 'Candidate', model, runs: 30 }], { maxTraceEntities: 0, maxTraceEvents: 0 });
    expect([paired.minimumRuns, paired.maximumRuns, paired.maximumWorkUnits]).toEqual([60, 60, 60_000_000_000]);
    expect(paired.limits.maxTraceEntities).toBe(0); expect(paired.limits.maxTraceEvents).toBe(0);
    const search = calculationBudget([{ label: 'Training', model, runs: 40 }, { label: 'Held out', model, runs: 10 }], {}, 10);
    expect([search.minimumRuns, search.maximumRuns]).toEqual([40, 50]);
    expect(search.limits).toEqual(simulate(model).provenance.limits);
  });
  it('rejects invalid drafts, unbounded plans and invalid caps rather than claiming an estimate', () => {
    const model = createExample('factory').model;
    expect(() => calculationBudget([{ label: 'Run', model, runs: 1001 }])).toThrow();
    expect(() => calculationBudget([{ label: 'Run', model, runs: 1 }], {}, 1)).toThrow();
    expect(() => calculationBudget([{ label: 'Run', model, runs: 1 }], { maxEvents: -1 })).toThrow();
    model.horizon = NaN; expect(() => arrivalExpectation(model)).toThrow();
  });
  it('shares the actual search count and validation before any candidate is evaluated', () => {
    const model = createExample('factory').model;
    const spec = { poolId: model.resources[0].id, capacities: [1, 2], trainingSeeds: [7, 8], verificationSeeds: [9, 10], maxRuns: 6, targetCompleted: 0 };
    const plan = capacitySearchPlan(model, spec);
    expect(plan).toEqual({ minimumRuns: 4, maximumRuns: 6, runBudget: 6 });
    expect(capacitySearch(model, spec).totalRuns).toBe(plan.maximumRuns);
    expect(capacitySearch(model, { ...spec, targetCompleted: 100000 }).totalRuns).toBe(plan.minimumRuns);
    for (const invalid of [{ ...spec, capacities: [1, 1] }, { ...spec, maxRuns: 5 }, { ...spec, verificationSeeds: [7] }, { ...spec, capacities: [1001] }]) {
      expect(() => capacitySearchPlan(model, invalid)).toThrow();
      expect(() => capacitySearch(model, invalid)).toThrow();
    }
  });
});
