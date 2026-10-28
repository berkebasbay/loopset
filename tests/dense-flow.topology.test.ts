import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { modelHash } from '../src/model/identity';
import type { ModelNode } from '../src/model/types';
import { validateProject } from '../src/model/validate';
import { frameAt } from '../src/playback';
import { connectionShapes, flowTopology, previewFlowTopology, possibleFlow } from '../src/scene/flowPresentation';
import { sceneLayout } from '../src/scene/graph';

const source = (id: string, next: string): ModelNode => ({ id, samplingId: id, label: id, kind: 'source', next, arrival: { kind: 'schedule', times: [0] }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] });
const delay = (id: string, next: string): ModelNode => ({ id, samplingId: id, label: id, kind: 'delay', next, duration: { kind: 'constant', value: 1 } });
const exit = (id: string): ModelNode => ({ id, samplingId: id, label: id, kind: 'sink' });
const route = (id: string, branches: { to: string; probability: number }[]): ModelNode => ({ id, samplingId: id, label: id, kind: 'route', branches });

describe('declared possible flow through the inspected primary', () => {
  it('renders a reviewed destination at the reused edge index without changing the actual model', () => {
    const project = createExample('factory'), original = structuredClone(project.model);
    const before = flowTopology(project.model.nodes), reviewed = previewFlowTopology(project.model.nodes, { from: 'station-a', to: 'station-c' });
    const old = before.links.find(link => link.from === 'station-a')!;
    expect(old.to).toBe('queue-b');
    expect(reviewed.links.find(link => link.index === old.index)?.to).toBe('station-c');
    expect(possibleFlow(reviewed, 'station-a')?.ids).toEqual(['arrivals', 'queue-a', 'station-a', 'station-c', 'exit']);
    expect(project.model).toEqual(original);
    expect(flowTopology(project.model.nodes).links.find(link => link.index === old.index)?.to).toBe('queue-b');
    expect(previewFlowTopology(project.model.nodes, { from: 'station-a', to: 'missing' }).links).toEqual(before.links);
    const loop = previewFlowTopology(project.model.nodes, { from: 'station-a', to: 'station-a' });
    expect(loop.links.find(link => link.from === 'station-a')?.to).toBe('station-a');
    expect(possibleFlow(loop, 'station-a')?.hasExit).toBe(false);
    expect(project.model).toEqual(original);
  });

  it('contains upstream context and downstream exit without inventing skipped buffers', () => {
    const project = createExample('factory'), topology = flowTopology(project.model.nodes), flow = possibleFlow(topology, 'station-b')!;
    expect(flow.ids).toEqual(['arrivals', 'queue-a', 'station-a', 'queue-b', 'station-b', 'queue-c', 'station-c', 'exit']);
    expect(flow.anchorIndex).toBe(4); expect(flow.hasSource).toBe(true); expect(flow.hasExit).toBe(true);
    expect(flow.links.map(link => [link.from, link.to])).toEqual(flow.ids.slice(1).map((id, index) => [flow.ids[index], id]));
    expect(flow.links.every(link => topology.links.includes(link))).toBe(true);
    expect(possibleFlow(flowTopology([...project.model.nodes].reverse()), 'station-b')!.ids).toEqual(flow.ids);
  });
  it('excludes a zero-probability shortcut and keeps its exact declared weight', () => {
    const nodes = [source('input', 'split'), route('split', [{ to: 'anchor', probability: 0 }, { to: 'via', probability: 1 }]), delay('via', 'anchor'), delay('anchor', 'out'), exit('out')];
    const topology = flowTopology(nodes), flow = possibleFlow(topology, 'anchor')!;
    expect(flow.ids).toEqual(['input', 'split', 'via', 'anchor', 'out']); expect(flow.excludedBranches).toBe(1);
    expect(topology.links.find(link => link.to === 'anchor' && link.from === 'split')?.probability).toBe(0);
  });
  it('chooses ASCII ties rather than a probability winner or array/locale order', () => {
    const nodes = [source('zSource', 'anchor'), exit('zExit'), route('anchor', [{ to: 'zExit', probability: .999 }, { to: 'AExit', probability: .001 }]), source('ASource', 'anchor'), exit('AExit')];
    for (const ordered of [nodes, [...nodes].reverse()]) {
      const flow = possibleFlow(flowTopology(ordered), 'anchor')!;
      expect(flow.ids).toEqual(['ASource', 'anchor', 'AExit']); expect(flow.links[1].probability).toBe(.001); expect(flow.otherBranches).toBe(1);
    }
  });
  it('keeps zero-only upstream reachability and missing exits explicitly partial', () => {
    const topology = flowTopology([source('input', 'split'), route('split', [{ to: 'anchor', probability: 0 }, { to: 'out', probability: 1 }]), delay('anchor', 'out'), exit('out'), delay('closed', 'closed')]);
    const partial = possibleFlow(topology, 'anchor')!;
    expect(partial.ids).toEqual(['anchor', 'out']); expect(partial.hasSource).toBe(false); expect(partial.hasExit).toBe(true);
    const isolated = possibleFlow(topology, 'closed')!;
    expect(isolated.ids).toEqual(['closed']); expect(isolated.links).toEqual([]); expect(isolated.hasSource).toBe(false); expect(isolated.hasExit).toBe(false);
    const noExit = possibleFlow(flowTopology([source('input', 'anchor'), delay('anchor', 'anchor'), exit('out')]), 'anchor')!;
    expect(noExit.ids).toEqual(['input', 'anchor']); expect(noExit.hasSource).toBe(true); expect(noExit.hasExit).toBe(false);
  });
  it('lists repeated steps honestly across a finite positive-delay cycle', () => {
    const nodes = [source('input', 'junction'), route('junction', [{ to: 'anchor', probability: .5 }, { to: 'out', probability: .5 }]), delay('anchor', 'junction'), exit('out')];
    const project = createExample('factory'); project.model.nodes = nodes; project.model.resources = []; project.layout = {};
    expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([]);
    const flow = possibleFlow(flowTopology(nodes), 'anchor')!;
    expect(flow.ids).toEqual(['input', 'junction', 'anchor', 'junction', 'out']); expect(flow.repeated).toBe(true); expect(flow.anchorIndex).toBe(2);
    expect(flow.ids.length).toBeLessThanOrEqual(nodes.length * 2 - 1);
  });
  it('handles empty, missing, terminal and legal prototype-like IDs without inherited properties', () => {
    expect(possibleFlow(flowTopology([]), null)).toBeNull(); expect(possibleFlow(flowTopology([]), 'toString')).toBeNull();
    const topology = flowTopology([source('toString', 'valueOf'), delay('valueOf', 'hasOwnProperty'), exit('hasOwnProperty')]);
    expect(possibleFlow(topology, 'valueOf')!.ids).toEqual(['toString', 'valueOf', 'hasOwnProperty']);
    expect(possibleFlow(topology, 'toString')!.hasSource).toBe(true); expect(possibleFlow(topology, 'hasOwnProperty')!.hasExit).toBe(true);
    expect(possibleFlow(topology, 'missing')).toBeNull();
    expect(possibleFlow(flowTopology([source('input', 'missing'), exit('out')]), 'input')!.hasExit).toBe(false);
  });
  it('bounds a 100-node chain and preserves long user-authored labels', () => {
    const nodes = [source('n0', 'n1'), ...Array.from({ length: 98 }, (_, i) => delay(`n${i + 1}`, `n${i + 2}`)), exit('n99')];
    nodes[50].label = 'A long user-authored step label '.repeat(5);
    const topology = flowTopology(nodes), flow = possibleFlow(topology, 'n50')!;
    expect(flow.ids).toHaveLength(100); expect(flow.links).toHaveLength(99); expect(flow.anchorIndex).toBe(50);
    expect(flow.ids[0]).toBe('n0'); expect(flow.ids.at(-1)).toBe('n99'); expect(topology.nodes.get('n50')!.label).toBe(nodes[50].label);
  });
  it.each(['factory', 'festival', 'service'] as const)('leaves actual %s model, layout, selection, replay and engine identities exact', world => {
    const project = createExample(world), exact = structuredClone(project), initial = simulate(project.model);
    const selection = { ids: ['station-a', 'station-c'], primary: 'station-c' }, exactSelection = structuredClone(selection);
    const frame = frameAt(project, initial, 300), beforeFrame = structuredClone(frame), hash = modelHash(project.model);
    const topology = flowTopology(project.model.nodes), shapes = connectionShapes(topology, sceneLayout(project));
    for (const node of project.model.nodes) { const walk = possibleFlow(topology, node.id)!; for (const link of walk.links) expect(shapes.has(link.index)).toBe(true); }
    expect(project).toEqual(exact); expect(selection).toEqual(exactSelection); expect(frame).toEqual(beforeFrame); expect(modelHash(project.model)).toBe(hash);
    const after = simulate(project.model);
    expect(after.modelHash).toBe(initial.modelHash); expect(after.demandHash).toBe(initial.demandHash); expect(after.seed).toBe(initial.seed);
    expect(after.summary).toEqual(initial.summary); expect(after.events).toEqual(initial.events); expect(after.stations).toEqual(initial.stations); expect(after.pools).toEqual(initial.pools);
  });
});
