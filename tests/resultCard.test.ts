import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine';
import type { RunOptions, ServiceNode, SimulationModel, SourceNode } from '../src/model/types';
import { resultCardContent } from '../src/storage/resultCard';

function fixture(): SimulationModel {
  return {
    id: 'card-model', name: 'Packing study', horizon: 40, warmup: 0, seed: 42, slaSeconds: 5, currency: 'USD',
    resources: [{ id: 'team', label: 'Team', installedCapacity: 1, capacity: 1, calendar: [], costPerHour: 1800, overtimeCostPerHour: 2700 }],
    nodes: [
      { id: 'source', samplingId: 'source', label: 'Arrivals', kind: 'source', next: 'queue', arrival: { kind: 'schedule', times: [0, 5, 10] }, classes: [{ id: 'standard', label: 'Standard', priority: 0, probability: 1 }] },
      { id: 'queue', samplingId: 'queue', label: 'Queue', kind: 'queue', next: 'service', capacity: null, discipline: 'fifo', patience: null },
      { id: 'service', samplingId: 'service', label: 'Packing', kind: 'service', next: 'exit', servers: 1, duration: { kind: 'constant', value: 10 }, resources: [{ poolId: 'team', units: 1 }] },
      { id: 'exit', samplingId: 'exit', label: 'Exit', kind: 'sink' },
    ],
  };
}

describe('run-bound PNG content', () => {
  it('reports the independently calculated FIFO counts, completed-cohort wait and scheduled cost with run identity', () => {
    const result = simulate(fixture()); const card = resultCardContent(result);
    // Starts at 0, 10, 20; waits 0, 5, 10; all finish by 40. Paid capacity: 40/3600 × 1800 = 20 USD.
    expect(card.metrics.map(metric => [metric.label, metric.value])).toEqual([
      ['Arrivals', '3'], ['Completed', '3'], ['Still in process', '0'],
      ['Mean wait · completed cohort', '5 s'], ['Resource cost · USD', '20.00'], ['Balked / left queue', '0 / 0'],
    ]);
    expect(card.metrics[3].detail).toBe('n = 3 completed-cohort entities');
    expect(card.incomplete).toBe(false); expect(card.status).toBe('COMPLETED RUN');
    expect(card.observation).toBe('Processed 0–40 s / requested 0–40 s');
    expect(card.run).toBe(`Run ${result.id}`); expect(card.seed).toBe('Seed 42');
    expect(card.engine).toBe(`Engine ${result.engineVersion}`);
    expect(card.fingerprints).toBe(`Model ${result.modelHash} · Demand ${result.demandHash}`);
    expect(card.coverage).toContain('Window [0, 40] s · warm-up 0 s');
    expect(card.assumptions).toBe('Single run · uncertainty not estimated · model assumptions unvalidated.');
    expect(card.population).toContain('Cohort arrivals [0, 40) s');
    expect(card.population).toContain('No horizon drain.');
    expect(card.filename).toContain(`queuelab-completed-${result.id}-`);
    expect(card.filename).toMatch(/\.png$/);
  });

  it('shows unavailable wait for unfinished work instead of treating its censored wait as zero', () => {
    const model = fixture(); model.horizon = 5;
    (model.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0] };
    const result = simulate(model); const card = resultCardContent(result);
    expect(result.status).toBe('completed'); // Completed horizon does not mean every entity completed.
    expect(card.metrics.slice(0, 4).map(metric => metric.value)).toEqual(['1', '0', '1', 'Unavailable']);
    expect(card.metrics[3].detail).toBe('n = 0 · no completed-cohort observations');
    expect(card.scope).toContain('Unfinished waits are censored, not zero.');
  });

  it('preserves actual zero waiting and zero resource cost when a completed sample exists', () => {
    const model = fixture(); model.resources = [];
    (model.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0] };
    (model.nodes[2] as ServiceNode).resources = [];
    const card = resultCardContent(simulate(model));
    expect(card.metrics[3]).toMatchObject({ value: '0 s', detail: 'n = 1 completed-cohort entities' });
    expect(card.metrics[4]).toMatchObject({ label: 'Resource cost · USD', value: '0.00' });
  });

  it('does not round a tiny positive wait or cost into an apparent exact zero', () => {
    const model = fixture(); model.resources[0].costPerHour = 0.00001;
    (model.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0, 0] };
    (model.nodes[2] as ServiceNode).duration = { kind: 'constant', value: 0.00001 };
    const card = resultCardContent(simulate(model));
    expect(card.metrics[3].value).toBe('0.00000500 s');
    expect(Number(card.metrics[4].value)).toBeGreaterThan(0);
  });

  it.each<[string, RunOptions]>([
    ['limited', { maxEvents: 2 }], ['cancelled', { shouldCancel: () => true }],
    ['failed', { shouldCancel: () => { throw new Error('Synthetic callback failure'); } }],
  ])('labels an actual %s run and processed horizon, with a filename marker before a long name', (status, options) => {
    const model = fixture(); model.name = 'Long model name '.repeat(10);
    const result = simulate(model, options); const card = resultCardContent(result);
    expect(result.status).toBe(status); expect(card.incomplete).toBe(true);
    expect(card.status).toBe(`INCOMPLETE RUN · ${status.toUpperCase()}`);
    expect(card.observation).toBe(`Processed 0–${result.simulatedUntil} s / requested 0–40 s`);
    expect(card.reason).toBe(result.reason);
    expect(card.scope).toContain('Partial numerical results only.');
    expect(card.filename).toMatch(new RegExp(`^queuelab-incomplete-${status}-`));
    expect(card.filename.length).toBeLessThanOrEqual(84);
  });

  it('identifies a stop before warm-up without inventing an observed measurement interval', () => {
    const model = fixture(); model.warmup = 20;
    const card = resultCardContent(simulate(model, { maxEvents: 1 }));
    expect(card.coverage).toContain('Stopped before warm-up 20 s; no measurement interval');
    expect(card.population).toContain('Cohort arrivals [20, 40) s');
  });

  it('keeps completed numerical results separate from bounded replay coverage', () => {
    const result = simulate(fixture(), { maxTraceEntities: 1, maxTraceEvents: 2 });
    expect(result.status).toBe('completed'); expect(result.trace.complete).toBe(false);
    const card = resultCardContent(result);
    expect(card.status).toBe('COMPLETED RUN'); expect(card.coverage).toContain('replay prefix through');
    expect(card.metrics[1].value).toBe('3');
    expect(card.scope).toContain('Numerical results and replay coverage are separate.');
  });

  it('captures only primitive values from the sealed result and never observes subsequent draft or source changes', () => {
    const model = fixture(); const run = simulate(model); const card = resultCardContent(run);
    model.name = 'Changed draft'; model.seed = 999; model.horizon = 123;
    expect(card.name).toBe('Packing study'); expect(card.seed).toBe('Seed 42');
    // Content is also captured before asynchronous font work, without retaining mutable result subobjects.
    run.model.name = 'Later source mutation'; run.summary.completed = 999; run.modelHash = 'changed'; run.trace.until = 0;
    expect(card.name).toBe('Packing study'); expect(card.metrics[1].value).toBe('3');
    expect(card.fingerprints).not.toContain('changed'); expect(card.coverage).toContain('through 40 s');
    expect(Object.isFrozen(card)).toBe(true); expect(Object.isFrozen(card.metrics[1])).toBe(true);
  });

  it('keeps Unicode and markup as literal display content, with a filesystem-safe name', () => {
    const model = fixture(); model.name = '日本語 👩🏽‍💻 Üretim <img src=x onerror=alert(1)> & test';
    const card = resultCardContent(simulate(model));
    expect(card.name).toBe(model.name);
    expect(card.filename).toMatch(/^[a-zA-Z0-9_-]+\.png$/);
    expect(card.filename).not.toContain('<img');
  });
});
