import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { frameAt } from '../src/playback';

describe('bounded, honest replay representation', () => {
  it.each(['toString', 'valueOf', 'hasOwnProperty'])('counts legal prototype-like ID %s numerically', id => {
    const p = createExample('factory');
    const source = p.model.nodes.find(n => n.kind === 'source')!;
    const queue = p.model.nodes.find(n => n.id === 'queue-a')!;
    const service = p.model.nodes.find(n => n.id === 'station-a')!;
    queue.id = id; source.next = id; source.arrival = { kind: 'schedule', times: [0, 1] };
    if (service.kind === 'service') service.duration = { kind: 'constant', value: 100 };
    const frame = frameAt(p, simulate(p.model), 9);
    expect(frame.queues[id]).toBe(1);
    expect(frame.busy['station-a']).toBe(1);
  });
  it('preserves all queue totals while representing a crowded queue and another node', () => {
    const p = createExample('factory');
    const source = p.model.nodes.find(n => n.kind === 'source')!;
    source.arrival = { kind: 'schedule', times: Array(550).fill(0) };
    p.model.resources[0].capacity = 0;
    const r = simulate(p.model);
    const frame = frameAt(p, r, 1);
    expect(frame.inSystem).toBe(550);
    expect(frame.queues['queue-a']).toBe(550);
    expect(frame.actors).toHaveLength(24);
    expect(frame.aggregated).toBe(true);
    expect(new Set(frame.actors.map(a => a.id)).size).toBe(24);
  });

  it('uses all 500 actor slots across a dense graph without replacing exact counts', () => {
    const p = createExample('factory');
    p.model.resources = [{ ...p.model.resources[0], id: 'closed', capacity: 0 }];
    const original = p.model.nodes.find(n => n.kind === 'source')!;
    p.model.nodes = [{ id: 'exit', samplingId: 'exit', label: 'Exit', kind: 'sink' }];
    for (let i = 0; i < 30; i++) {
      p.model.nodes.push(
        { ...original, id: `source-${i}`, samplingId: `source-${i}`, next: `q-${i}`, arrival: { kind: 'schedule', times: Array(20).fill(0) } },
        { id: `q-${i}`, samplingId: `q-${i}`, label: `Queue ${i}`, kind: 'queue', next: `s-${i}`, capacity: null, discipline: 'fifo', patience: null },
        { id: `s-${i}`, samplingId: `s-${i}`, label: `Station ${i}`, kind: 'service', next: 'exit', servers: 1, duration: { kind: 'constant', value: 1 }, resources: [{ poolId: 'closed', units: 1 }] },
      );
    }
    const frame = frameAt(p, simulate(p.model), 1);
    expect(frame.inSystem).toBe(600);
    expect(frame.actors).toHaveLength(500);
    expect(new Set(frame.actors.map(a => a.nodeId)).size).toBe(30);
    expect(Object.values(frame.queues).reduce((a, b) => a + b, 0)).toBe(600);
  });
});
