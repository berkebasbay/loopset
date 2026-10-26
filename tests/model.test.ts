import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { modelHash } from '../src/model/identity';
import type { SimulationModel } from '../src/model/types';
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
  it.each<[string, (model: SimulationModel) => void]>([
    ['arrival schedule', model => { const source = model.nodes.find(node => node.kind === 'source')!; source.arrival = { kind: 'schedule', times: new Array(1) }; }],
    ['arrival periods', model => { const source = model.nodes.find(node => node.kind === 'source')!; source.arrival = { kind: 'poisson', segments: new Array(1) }; }],
    ['classes', model => { model.nodes.find(node => node.kind === 'source')!.classes.length++; }],
    ['empirical service samples', model => { model.nodes.find(node => node.kind === 'service')!.duration = { kind: 'empirical', values: new Array(1) }; }],
    ['empirical patience samples', model => { model.nodes.find(node => node.kind === 'queue')!.patience = { kind: 'empirical', values: new Array(1) }; }],
    ['resource calendar', model => { model.resources[0].calendar = new Array(1); }],
    ['service requirements', model => { model.nodes.find(node => node.kind === 'service')!.resources.length++; }],
    ['route branches', model => { const sink = model.nodes.find(node => node.kind === 'sink')!; const branches = [{ to: sink.id, probability: 1 }]; branches.length++;
      model.nodes.push({ id: 'route', samplingId: 'route', label: 'Route', kind: 'route', branches }); }],
    ['model nodes', model => { model.nodes.length++; }],
    ['resource pools', model => { model.resources.length++; }],
  ])('rejects sparse %s before simulation can silently skip or read a missing item', (_name, edit) => {
    const model = createExample('factory').model; edit(model);
    expect(validateModel(model).some(issue => issue.severity === 'error')).toBe(true);
    expect(() => simulate(model)).toThrow();
  });
  it('rejects holes in saved scenario arrays', () => {
    const project = createExample('factory'); project.scenarios = new Array(1);
    expect(validateProject(project).some(issue => issue.path === 'scenarios')).toBe(true);
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
