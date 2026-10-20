import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { modelHash } from '../src/model/identity';
import { parseProject, validateModel, validateProject } from '../src/model/validate';

describe('model safety and reproducibility', () => {
  it('accepts all three portable example worlds', () => {
    for (const world of ['factory', 'festival', 'service'] as const) {
      const p = createExample(world); expect(validateProject(p)).toEqual([]);
      expect(parseProject(JSON.stringify(p))).toEqual(p);
    }
  });
  it('rejects dangling links and invalid worker allocation', () => {
    const m = createExample('factory').model;
    m.nodes[0] = { ...m.nodes[0], next: 'missing' } as typeof m.nodes[number];
    m.resources[0].capacity = 13;
    expect(validateModel(m).map(i => i.path)).toContain('nodes.arrivals.next');
    expect(validateModel(m).some(i => i.path.endsWith('.capacity'))).toBe(true);
  });
  it('rejects possible zero-time cycles before a run', () => {
    const m = createExample('factory').model;
    m.nodes.push({ id: 'loop', samplingId: 'loop', label: 'Loop', kind: 'delay', duration: { kind: 'constant', value: 0 }, next: 'loop' });
    expect(validateModel(m).some(i => i.message.includes('zero-time'))).toBe(true);
  });
  it('keeps layout, labels, array order and seed outside semantic model identity', () => {
    const p = createExample('factory'); const hash = modelHash(p.model);
    p.layout['station-a'].x += 1; p.model.name = 'A new name'; p.model.nodes[0].label = 'Renamed';
    p.model.nodes.reverse(); p.model.resources.reverse(); p.model.seed++;
    expect(modelHash(p.model)).toBe(hash);
    const service = p.model.nodes.find(n => n.kind === 'service');
    if (service?.kind === 'service') service.servers++;
    expect(modelHash(p.model)).not.toBe(hash);
  });
  it('leaves unsupported project versions unaccepted', () => {
    const p = createExample('factory');
    expect(() => parseProject(JSON.stringify({ ...p, schemaVersion: 99 }))).toThrow('not supported');
  });
});
