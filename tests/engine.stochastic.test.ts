import { expect, it } from 'vitest';
import { simulate } from '../src/engine';
import { sample, uniform } from '../src/engine/random';
import type { SimulationModel } from '../src/model/types';

it('checks keyed uniforms and all nonconstant sampling families against independent moments', () => {
  const draws = Array.from({ length: 50_000 }, (_, i) => uniform(591, 'reference', i));
  const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
  expect(mean(draws)).toBeGreaterThan(0.495); expect(mean(draws)).toBeLessThan(0.505);
  expect(mean(draws.map(u => u * u))).toBeGreaterThan(0.328); expect(mean(draws.map(u => u * u))).toBeLessThan(0.339);
  const exponential = mean(draws.map(u => sample({ kind: 'exponential', mean: 6 }, u)));
  expect(exponential).toBeGreaterThan(5.90); expect(exponential).toBeLessThan(6.10);
  const triangle = mean(draws.map(u => sample({ kind: 'triangular', min: 1, mode: 3, max: 8 }, u)));
  expect(triangle).toBeGreaterThan(3.96); expect(triangle).toBeLessThan(4.04);
  const empirical = mean(draws.map(u => sample({ kind: 'empirical', values: [1, 3, 8] }, u)));
  expect(empirical).toBeGreaterThan(3.94); expect(empirical).toBeLessThan(4.06);
});

it('matches stable M/M/1 theory with independent replications and warm-up', () => {
  // Fixed before execution: λ=.1/s, μ=1/6/s, ρ=.6, Wq=9s, Lq=.9,
  // throughput=360/h. Twelve independent 200,000s runs discard 20,000s warm-up.
  // Predeclared broad numerical validation bands: Wq ±.8s, Lq ±.08,
  // utilization ±.02, throughput ±3/h. No per-run CI or single-seed claim.
  const model: SimulationModel = { id: 'mm1', name: 'Analytic M/M/1', horizon: 200_000, warmup: 20_000, seed: 1001, slaSeconds: 100, currency: 'USD', resources: [], nodes: [
    { id: 'source', samplingId: 'source', label: 'Poisson source', kind: 'source', next: 'q', arrival: { kind: 'poisson', segments: [{ start: 0, end: 200_000, perHour: 360 }] }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] },
    { id: 'q', samplingId: 'q', label: 'Unlimited FIFO', kind: 'queue', next: 's', capacity: null, discipline: 'fifo', patience: null },
    { id: 's', samplingId: 's', label: 'Exponential service', kind: 'service', next: 'sink', servers: 1, resources: [], duration: { kind: 'exponential', mean: 6 } },
    { id: 'sink', samplingId: 'sink', label: 'Sink', kind: 'sink' },
  ] };
  const results = Array.from({ length: 12 }, (_, i) => simulate(model, { seed: 1001 + i, maxTraceEntities: 0, maxTraceEvents: 0 }));
  expect(results.every(r => r.status === 'completed')).toBe(true);
  const avg = (get: (r: typeof results[number]) => number) => results.reduce((sum, r) => sum + get(r), 0) / results.length;
  expect(avg(r => r.summary.meanWait)).toBeGreaterThan(8.2); expect(avg(r => r.summary.meanWait)).toBeLessThan(9.8);
  expect(avg(r => r.stations[0].averageQueue)).toBeGreaterThan(0.82); expect(avg(r => r.stations[0].averageQueue)).toBeLessThan(0.98);
  expect(avg(r => r.stations[0].utilization!)).toBeGreaterThan(0.58); expect(avg(r => r.stations[0].utilization!)).toBeLessThan(0.62);
  expect(avg(r => r.summary.throughputPerHour)).toBeGreaterThan(357); expect(avg(r => r.summary.throughputPerHour)).toBeLessThan(363);
}, 15_000);
