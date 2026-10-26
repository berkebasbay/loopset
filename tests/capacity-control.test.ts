import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { MAX_PARALLEL_STATIONS, setCapacity } from '../src/model/commands';
import { validateProject } from '../src/model/validate';

describe('capacity editing across the full model range', () => {
  it('grows beyond12 with dedicated installed resources and preserves the original', () => {
    const original = createExample('factory');
    const snapshot = structuredClone(original);
    let project = original;
    for (const capacity of [12, 13, 32, 100, MAX_PARALLEL_STATIONS]) {
      project = setCapacity(project, 'station-c', capacity);
      const station = project.model.nodes.find(n => n.id === 'station-c');
      expect(station?.kind).toBe('service');
      if (station?.kind !== 'service') throw new Error('Missing station');
      expect(station.servers).toBe(capacity);
      const pool = project.model.resources.find(p => p.id === station.resources[0].poolId)!;
      expect(pool.capacity).toBe(capacity); expect(pool.installedCapacity).toBeGreaterThanOrEqual(capacity);
      expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([]);
    }
    expect(original).toEqual(snapshot);
    const smaller = setCapacity(project, 'station-c', 3);
    const station = smaller.model.nodes.find(n => n.id === 'station-c');
    expect(station?.kind === 'service' && station.servers).toBe(3);
    expect(smaller.model.resources.find(p => p.id === 'team-c')?.installedCapacity).toBe(1000);
  });

  it('keeps shared resources and explicit calendar policies under model control', () => {
    const original = createExample('service');
    const project = setCapacity(original, 'station-c', 64);
    const shared = original.model.resources.filter(pool => original.model.nodes.filter(n => n.kind === 'service' && n.resources.some(r => r.poolId === pool.id)).length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const pool of shared) expect(project.model.resources.find(p => p.id === pool.id)).toEqual(pool);
    for (const pool of original.model.resources) expect(project.model.resources.find(p => p.id === pool.id)?.calendar).toEqual(pool.calendar);
    expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('retains the schema limit and rejects non-finite requests', () => {
    const project = createExample('factory');
    const maximum = setCapacity(project, 'station-c', 5000).model.nodes.find(n => n.id === 'station-c');
    expect(maximum?.kind === 'service' && maximum.servers).toBe(1000);
    expect(() => setCapacity(project, 'station-c', NaN)).toThrow(/finite/);
  });
});
