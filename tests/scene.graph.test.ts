import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { modelLinks, sceneExtent, sceneLayout } from '../src/scene/graph';

describe('visual graph contract', () => {
  it('preserves explicit buffers and route branches, independent of node array order', () => {
    const p = createExample('factory');
    p.model.nodes.push({ id: 'split', label: 'Split', samplingId: 'split', kind: 'route', branches: [{ to: 'queue-a', probability: .4 }, { to: 'station-c', probability: .6 }] });
    const links = modelLinks(p.model.nodes.reverse());
    expect(links).toContainEqual({ from: 'arrivals', to: 'queue-a' });
    expect(links).toContainEqual({ from: 'queue-a', to: 'station-a' });
    expect(links).toContainEqual({ from: 'split', to: 'station-c', probability: .6 });
    expect(links).not.toContainEqual({ from: 'arrivals', to: 'station-a' });
  });
  it('contains 100 placed nodes and remains finite during an invalid layout draft', () => {
    const p = createExample('festival');
    p.model.nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, samplingId: `n${i}`, label: `Node ${i}`, kind: 'sink' as const }));
    p.layout = Object.fromEntries(p.model.nodes.map((node, i) => [node.id, { x: (i % 10) * 5, z: Math.floor(i / 10) * 4 }]));
    p.layout.n0.x = NaN; p.layout.n1.z = Infinity;
    const layout = sceneLayout(p), extent = sceneExtent(layout);
    expect(Object.values(layout).every(p => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
    expect(extent.maxX).toBeGreaterThan(45); expect(extent.maxZ).toBeGreaterThan(36);
  });
});
