import { expect, it } from 'vitest';
import { simulate } from '../src/engine';
import type { SimulationModel } from '../src/model/types';

it('checks E1: 10 stations, 10,000 arrivals, full metrics with bounded trace', () => {
  const model: SimulationModel = { id: 'e1', name: 'E1 deterministic pipeline', seed: 27, horizon: 10_010, warmup: 0, slaSeconds: 1, currency: 'USD', resources: [], nodes: [
    { id: 'in', samplingId: 'in', label: 'In', kind: 'source', next: 'q0', arrival: { kind: 'schedule', times: Array.from({ length: 10_000 }, (_, i) => i) }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] },
    { id: 'out', samplingId: 'out', label: 'Out', kind: 'sink' },
  ] };
  for (let i = 0; i < 10; i++) {
    model.resources.push({ id: `r${i}`, label: `Team ${i}`, capacity: 1, installedCapacity: 1, calendar: [], costPerHour: 24, overtimeCostPerHour: 36 });
    model.nodes.push({ id: `q${i}`, samplingId: `q${i}`, label: `Queue ${i}`, kind: 'queue', next: `s${i}`, capacity: null, discipline: 'fifo', patience: null },
      { id: `s${i}`, samplingId: `s${i}`, label: `Station ${i}`, kind: 'service', next: i === 9 ? 'out' : `q${i + 1}`, servers: 1, resources: [{ poolId: `r${i}`, units: 1 }], duration: { kind: 'constant', value: 1 } });
  }
  const durations: number[] = [];
  for (let replication = 0; replication < 11; replication++) {
    const r = simulate(model); if (replication) durations.push(r.elapsedMs);
    expect(r.status).toBe('completed'); expect(r.summary).toMatchObject({ arrivals: 10_000, completed: 10_000, inSystem: 0, meanWait: 0, meanSojourn: 10 });
    expect(r.stations.every(s => s.finished === 10_000 && s.busySeconds === 10_000 && s.queueAtEnd === 0)).toBe(true);
    expect(r.diagnostics.maxActiveEntities).toBe(10);
  }
  console.info('E1 headless milliseconds (one warm-up excluded):', JSON.stringify({ samples: durations, mean: durations.reduce((a, b) => a + b, 0) / durations.length, p95: [...durations].sort((a, b) => a - b).at(-1) }));
}, 30_000);
