import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { modelHash } from '../src/model/identity';
import { validateProject } from '../src/model/validate';
import { beginMoveGesture, previewTranslation, translateSelection } from '../src/features/layoutCommands';
import { renameNode } from '../src/features/modelEdits';
import { commitEdit, emptyHistory, undoEdit } from '../src/features/editorHistory';
import { sceneLayout } from '../src/scene/graph';

describe('atomic presentation-only group movement', () => {
  it.each(['factory', 'festival', 'service'] as const)('moves a real %s group without changing model, demand or numerical results', world => {
    const before = createExample(world), serialized = JSON.stringify(before), initial = simulate(before.model);
    const next = translateSelection(before, ['station-a', 'queue-b', 'station-c'], { x: 1.5, z: -2 });
    expect(next.model).toBe(before.model); expect(next.scenarios).toBe(before.scenarios);
    expect(modelHash(next.model)).toBe(initial.modelHash); expect(next.model.seed).toBe(before.model.seed);
    const after = simulate(next.model);
    expect(after.demandHash).toBe(initial.demandHash); expect(after.summary).toEqual(initial.summary);
    expect(after.events).toEqual(initial.events); expect(after.stations).toEqual(initial.stations); expect(after.pools).toEqual(initial.pools);
    expect(next.layout['station-c'].x - next.layout['station-a'].x).toBe(before.layout['station-c'].x - before.layout['station-a'].x);
    expect(next.layout['station-c'].z - next.layout['station-a'].z).toBe(before.layout['station-c'].z - before.layout['station-a'].z);
    expect(next.layout.arrivals).toBe(before.layout.arrivals); expect(JSON.stringify(before)).toBe(serialized);
    expect(validateProject(next)).toEqual([]);
  });
  it('clamps the common delta once, preserving fractional offsets and all coordinate bounds', () => {
    const project = createExample('factory'); project.layout['station-a'] = { x: 98.3, z: -99.8 }; project.layout['station-b'] = { x: 99.1, z: -98.7 };
    const preview = previewTranslation(project, ['station-a', 'station-b'], { x: 90, z: -80 });
    expect(preview.delta.x).toBeCloseTo(.9); expect(preview.delta.z).toBeCloseTo(-.2);
    expect(preview.points['station-b'].x - preview.points['station-a'].x).toBeCloseTo(.8);
    expect(preview.points['station-b'].z - preview.points['station-a'].z).toBeCloseTo(1.1);
    expect(Object.values(preview.points).every(point => point.x >= -100 && point.x <= 100 && point.z >= -100 && point.z <= 100)).toBe(true);
  });
  it('uses an anchor grid and deterministically snaps alignment to unselected targets, including coincident nodes', () => {
    const project = createExample('festival');
    project.layout['station-a'] = { x: .13, z: .22 }; project.layout['station-b'] = { x: 1.13, z: 2.22 };
    for (const node of project.model.nodes.filter(node => !['station-a', 'station-b'].includes(node.id))) project.layout[node.id] = { x: 10, z: 10 };
    const all = project.model.nodes.map(node => node.id);
    const grid = previewTranslation(project, all, { x: .28, z: .1 }, { anchor: 'station-a', snap: true, align: true });
    expect(grid.points['station-a']).toEqual({ x: .5, z: .5 }); expect(grid.guides).toEqual([]);
    project.layout.arrivals = { x: 1, z: 1 }; project.layout.exit = { x: 1, z: 1 };
    const aligned = previewTranslation(project, ['station-a', 'station-b'], { x: .82, z: .76 }, { anchor: 'station-a', snap: true, align: true });
    expect(aligned.points['station-a']).toEqual({ x: 1, z: 1 });
    expect(aligned.guides).toHaveLength(2); expect(aligned.guides.every(guide => guide.targetId === 'arrivals')).toBe(true);
    expect(aligned.guides.every(guide => [guide.value, guide.from, guide.to].every(Number.isFinite))).toBe(true);
    expect(previewTranslation(project, ['station-a', 'station-b'], { x: .82, z: .76 }, { anchor: 'station-a', snap: true, align: true })).toEqual(aligned);
  });
  it('handles missing/nonfinite visual positions and legal prototype-like IDs without leaking model changes', () => {
    let project = renameNode(createExample('factory'), 'station-a', 'toString');
    project = renameNode(project, 'station-b', 'valueOf'); const first: string = 'toString', second: string = 'valueOf'; delete project.layout[first]; project.layout[second] = { x: NaN, z: Infinity };
    const fallback = sceneLayout(project), moved = translateSelection(project, ['toString', 'valueOf', 'missing', 'toString'], { x: .5, z: -.5 });
    expect(moved.layout[first]).toEqual({ x: fallback[first].x + .5, z: fallback[first].z - .5 });
    expect(moved.layout[second]).toEqual({ x: fallback[second].x + .5, z: fallback[second].z - .5 });
    expect(moved.model).toBe(project.model); expect(Object.hasOwn(moved.layout, 'missing')).toBe(false);
  });
  it('does not squash an impossible/out-of-bounds group or accept nonfinite translations', () => {
    const project = createExample('service'); project.layout['station-a'].x = -150; project.layout['station-b'].x = 150;
    const exact = structuredClone(project);
    expect(() => translateSelection(project, ['station-a', 'station-b'], { x: 1, z: 0 })).toThrow('Repair individual');
    expect(project).toEqual(exact); expect(() => translateSelection(project, ['station-c'], { x: NaN, z: 0 })).toThrow('finite');
    expect(() => translateSelection(project, ['missing'], { x: 1, z: 0 })).toThrow('existing');
    expect(translateSelection(createExample('factory'), ['station-a'], { x: 0, z: 0 }).revision).toBe(0);
  });
  it('cancels a real preview transaction without an edit; pointer-up yields one atomic history command at most', () => {
    const project = createExample('factory'), exact = structuredClone(project);
    const cancelled = beginMoveGesture(project, ['station-a', 'station-b'], 'station-a');
    cancelled.preview({ x: 2, z: 2 }); cancelled.preview({ x: 3, z: 2 }); cancelled.cancel();
    expect(cancelled.finish()).toBeNull(); expect(cancelled.preview({ x: 9, z: 9 })).toBeNull(); expect(project).toEqual(exact);
    const completed = beginMoveGesture(project, ['station-a', 'station-b'], 'station-b');
    completed.preview({ x: 1, z: 1 }); completed.preview({ x: 2, z: 3 });
    const command = completed.finish()!; expect(completed.finish()).toBeNull();
    const committed = commitEdit(emptyHistory(), project, translateSelection(project, command.ids, command.delta));
    expect(committed.history.past).toHaveLength(1); expect(committed.entry?.label).toBe('Move 2 steps'); expect(committed.entry?.kind).toBe('layout');
    expect(undoEdit(committed.history, committed.project).project.layout).toEqual(project.layout);
  });
});
