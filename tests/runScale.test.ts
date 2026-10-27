import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { validateModel } from '../src/model/validate';
import { MAX_ARRIVALS_PER_HOUR, MAX_RUN_SECONDS, MAX_WAITING_PLACES } from '../src/model/limits';
import { arrivalExpectation, calculationBudget } from '../src/model/workBudget';
import { parseSampleCSV } from '../src/storage/csv';
import { normalizeRunLimits } from '../src/engine/provenance';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';

describe('long and high-demand models', () => {
  it('accepts a 30-day high-demand project and preserves it through file transfer', () => {
    const project = createExample('factory');
    project.model.horizon = 30 * 86400;
    const source = project.model.nodes.find(n => n.kind === 'source')!;
    source.arrival = { kind: 'fixed', perHour: 12_000 };
    const queue = project.model.nodes.find(n => n.kind === 'queue')!;
    queue.capacity = 2_000_000;
    expect(validateModel(project.model)).toEqual([]);
    expect(arrivalExpectation(project.model)).toEqual({ count: 8_640_000, stochastic: false });
    expect(openProjectJSON(serializeProject(project)).model).toEqual(project.model);
    const budget = calculationBudget([{ label: '30 days', model: project.model, runs: 1 }]);
    expect(budget.limits).toEqual(normalizeRunLimits());
    expect(budget.limits.maxEntities).toBeGreaterThan(budget.groups[0].arrivalsPerRun);
    expect(budget.limits.maxEvents).toBe(1_000_000_000);
  });
  it('imports late arrivals in a long run while retaining service-duration and exclusive-horizon checks', () => {
    expect(parseSampleCSV('arrival_seconds\n0\n691200\n2505600', 'arrival', 30 * 86400)).toEqual([0, 691200, 2505600]);
    expect(() => parseSampleCSV('arrival_seconds\n2592000', 'arrival', 30 * 86400)).toThrow('before the run');
    expect(() => parseSampleCSV('service_seconds\n691200', 'service')).toThrow('604,800');
  });
  it('accepts the expanded boundaries for both fixed and variable arrivals, and rejects values beyond them', () => {
    const model = createExample('factory').model;
    const source = model.nodes.find(n => n.kind === 'source')!;
    const queue = model.nodes.find(n => n.kind === 'queue')!;
    model.horizon = MAX_RUN_SECONDS;
    source.arrival = { kind: 'fixed', perHour: MAX_ARRIVALS_PER_HOUR };
    queue.capacity = MAX_WAITING_PLACES;
    expect(validateModel(model)).toEqual([]);
    model.horizon++;
    expect(validateModel(model).some(i => i.path === 'horizon')).toBe(true);
    model.horizon = MAX_RUN_SECONDS;
    source.arrival.perHour++;
    expect(validateModel(model).some(i => i.path.endsWith('.arrival'))).toBe(true);
    source.arrival = { kind: 'poisson', segments: [{ start: 0, end: model.horizon, perHour: MAX_ARRIVALS_PER_HOUR }] };
    expect(validateModel(model)).toEqual([]);
    source.arrival.segments[0].perHour++;
    expect(validateModel(model).some(i => i.path.includes('segments'))).toBe(true);
    queue.capacity++;
    expect(validateModel(model).some(i => i.path.endsWith('.capacity'))).toBe(true);
  });
});
