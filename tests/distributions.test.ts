import { expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { resultRows, resultReportHTML } from '../src/storage/report';

it('aggregates every completed waiting sample, including exact bin boundaries, independently of detail retention', () => {
  const p = createExample('factory');
  p.model.nodes = [
    { id: 'in', samplingId: 'in', label: 'In', kind: 'source', arrival: { kind: 'schedule', times: [0, 0, 0, 0] }, classes: [{ id: 'one', label: 'One', priority: 0, probability: 1 }], next: 'q' },
    { id: 'q', samplingId: 'q', label: 'Queue', kind: 'queue', next: 'work', capacity: null, patience: null, discipline: 'fifo' },
    { id: 'work', samplingId: 'work', label: 'Work', kind: 'service', duration: { kind: 'constant', value: 30 }, servers: 1, resources: [], next: 'out' },
    { id: 'out', samplingId: 'out', label: 'Out', kind: 'sink' },
  ];
  p.model.resources = []; p.model.horizon = 200;
  const full = simulate(p.model); const noTrace = simulate(p.model, { maxTraceEntities: 0, maxTraceEvents: 0 });
  expect(full.summary.completed).toBe(4);
  expect(full.waitDistribution.sampleSize).toBe(4);
  expect(full.waitDistribution.bins.slice(0, 3).map(b => b.count)).toEqual([1, 1, 2]); // waits 0,30,60,90
  expect(full.waitDistribution.bins.reduce((sum, b) => sum + b.count, 0)).toBe(4);
  expect(noTrace.waitDistribution).toEqual(full.waitDistribution);
  expect(resultRows(full).filter(row => row[0] === 'wait_distribution' && row[1] === 'bin_count').reduce((sum, row) => sum + Number(row[2]), 0)).toBe(4);
  expect(resultReportHTML(full)).toContain('Waiting distribution');
});

it('does not export a zero waiting average when no jobs completed', () => {
  const model = createExample('factory').model;
  model.horizon = 1;
  for (const node of model.nodes) if (node.kind === 'source') node.arrival = { kind: 'schedule', times: [0] };
  const run = simulate(model);
  expect(run.summary.waitSampleSize).toBe(0);
  expect(resultRows(run).find(row => row[0] === 'summary' && row[1] === 'meanWait')?.[2]).toBeNull();
  expect(resultReportHTML(run)).toContain('Mean wait and percentiles are unavailable');
});
