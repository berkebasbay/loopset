import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { mutateProject, setCapacity } from '../src/model/commands';
import { saveScenario, restoreScenario, removeScenario } from '../src/model/scenarios';
import { modelHash } from '../src/model/identity';
import { parseProject } from '../src/model/validate';
import { commitEdit, describeProjectEdit, emptyHistory, HISTORY_ACTION_LIMIT, HISTORY_BYTE_LIMIT, redoEdit, undoEdit } from '../src/features/editorHistory';
import { translateSelection } from '../src/features/layoutCommands';
import { removeNode } from '../src/features/modelEdits';

describe('named bounded project history', () => {
  it('names commands, branches redo on a new edit and increases revisions through every restore', () => {
    const initial = createExample('factory'); initial.savedAt = '2026-10-21T00:00:00Z';
    let state = commitEdit(emptyHistory(), initial, setCapacity(initial, 'station-c', 2));
    expect(state.entry?.label).toBe('Change Packing parallel servers'); expect(state.project.revision).toBe(1); expect(state.project.savedAt).toBeUndefined();
    state = commitEdit(state.history, state.project, translateSelection(state.project, ['station-a', 'station-b'], { x: .5, z: 0 }));
    expect(state.project.revision).toBe(2); expect(state.entry?.label).toBe('Move 2 steps');
    state = undoEdit(state.history, state.project); expect(state.project.revision).toBe(3); expect(state.history.future[0].label).toBe('Move 2 steps');
    state = undoEdit(state.history, state.project); expect(state.project.revision).toBe(4); expect(state.project.model).toEqual(initial.model);
    state = redoEdit(state.history, state.project); expect(state.project.revision).toBe(5); expect(state.history.future).toHaveLength(1);
    state = commitEdit(state.history, state.project, mutateProject(state.project, project => { project.model.seed++; }));
    expect(state.project.revision).toBe(6); expect(state.history.future).toEqual([]); expect(state.entry?.label).toBe('Change random seed');
    expect(redoEdit(state.history, state.project).project).toBe(state.project);
    expect(initial.revision).toBe(0); expect(initial.savedAt).toBe('2026-10-21T00:00:00Z');
  });
  it('layout entries retain compact point patches, share model/scenarios and restore absent coordinates exactly', () => {
    const project = saveScenario(createExample('service'), 'Original'); delete project.layout['station-b'];
    const next = translateSelection(project, ['station-a', 'station-b'], { x: 3, z: 2 });
    const state = commitEdit(emptyHistory(), project, next);
    expect(state.entry?.kind).toBe('layout'); expect(state.project.model).toBe(project.model); expect(state.project.scenarios).toBe(project.scenarios);
    expect(state.history.estimatedBytes).toBeLessThan(1024);
    const undone = undoEdit(state.history, state.project);
    expect(Object.hasOwn(undone.project.layout, 'station-b')).toBe(false); expect(undone.project.layout).toEqual(project.layout);
    const redone = redoEdit(undone.history, undone.project); expect(redone.project.layout).toEqual(next.layout); expect(modelHash(redone.project.model)).toBe(modelHash(project.model));
  });
  it('keeps NaN, Infinity and repairable drafts exact without portable serialization, even if byte estimation fails', () => {
    const project = createExample('factory');
    const invalid = mutateProject(project, next => { next.model.horizon = NaN; next.model.resources[0].capacity = Infinity; next.layout['station-a'].x = NaN; });
    let state = commitEdit(emptyHistory(), project, invalid, 'Edit incomplete run settings');
    expect(Number.isNaN(state.project.model.horizon)).toBe(true); expect(state.project.model.resources[0].capacity).toBe(Infinity);
    state = undoEdit(state.history, state.project); expect(state.project.model.horizon).toBe(project.model.horizon);
    state = redoEdit(state.history, state.project); expect(Number.isNaN(state.project.model.horizon)).toBe(true); expect(Number.isNaN(state.project.layout['station-a'].x)).toBe(true);
    const badEstimate = createExample('festival'); Object.defineProperty(badEstimate, 'toJSON', { value: () => { throw new Error('Not serializable'); } });
    const accepted = commitEdit(emptyHistory(), badEstimate, { ...badEstimate, name: 'Still editable' });
    expect(accepted.project.name).toBe('Still editable'); expect(accepted.history.estimateUnavailable).toBe(true); expect(accepted.history.past).toHaveLength(1);
    expect(undoEdit(accepted.history, accepted.project).project.name).toBe(badEstimate.name);
  });
  it('restores deletion dependencies and saved scenarios; same-document file opening is a reversible named snapshot', () => {
    const project = saveScenario(createExample('festival'), 'Original gate');
    let state = commitEdit(emptyHistory(), project, removeNode(project, 'station-b', 'station-c'));
    expect(state.entry?.label).toBe('Delete Ticket check');
    state = undoEdit(state.history, state.project); expect(state.project.model).toEqual(project.model); expect(state.project.layout).toEqual(project.layout);
    const changed = setCapacity(state.project, 'station-c', 3);
    state = commitEdit(state.history, state.project, changed);
    state = commitEdit(state.history, state.project, restoreScenario(state.project, project.scenarios![0].id));
    expect(state.entry?.label).toBe('Restore scenario Original gate'); expect(state.project.scenarios).toEqual(project.scenarios);
    state = commitEdit(state.history, state.project, removeScenario(state.project, project.scenarios![0].id));
    expect(state.entry?.label).toBe('Remove scenario Original gate');
    state = undoEdit(state.history, state.project); expect(state.project.scenarios).toEqual(project.scenarios);
    const imported = parseProject(JSON.stringify({ ...project, name: 'Imported gate' }));
    state = commitEdit(state.history, state.project, imported, 'Open project file'); expect(state.entry?.label).toBe('Open project file');
    state = undoEdit(state.history, state.project); expect(state.project.name).toBe(project.name);
    // The App creates an empty history for a different document, never a cross-document Undo chain.
    expect(emptyHistory().past).toEqual([]);
  });
  it('discloses history-only count eviction and leaves the open project and saved scenarios intact', () => {
    const original = saveScenario(createExample('factory'), 'Keep me');
    let project = original, history = emptyHistory();
    for (let i = 0; i < 55; i++) { const result = commitEdit(history, project, translateSelection(project, ['station-a'], { x: .5, z: 0 })); project = result.project; history = result.history; }
    expect(history.past).toHaveLength(HISTORY_ACTION_LIMIT); expect(history.discarded).toBe(5); expect(history.estimatedBytes).toBeLessThan(HISTORY_BYTE_LIMIT);
    expect(project.layout['station-a'].x).toBe(original.layout['station-a'].x + 27.5); expect(project.scenarios).toBe(original.scenarios);
    for (let i = 0; i < 50; i++) { const result = undoEdit(history, project); project = result.project; history = result.history; }
    expect(history.future).toHaveLength(50); expect(project.layout['station-a'].x).toBe(original.layout['station-a'].x + 2.5); expect(project.revision).toBe(original.revision + 105);
    expect(history.estimatedBytes).toBeLessThan(HISTORY_BYTE_LIMIT);
  });
  it('bounds serialized snapshot payloads independently of action count without blocking an oversized current edit', () => {
    let project = createExample('factory');
    const source = project.model.nodes.find(node => node.kind === 'source')!;
    source.arrival = { kind: 'schedule', times: Array.from({ length: 100_000 }, (_, i) => i / 1000) };
    let history = emptyHistory();
    for (let i = 0; i < 35; i++) {
      const result = commitEdit(history, project, mutateProject(project, next => { next.model.seed++; })); project = result.project; history = result.history;
    }
    expect(history.estimatedBytes).toBeLessThanOrEqual(HISTORY_BYTE_LIMIT); expect(history.discarded).toBeGreaterThan(0); expect(history.past.length).toBeLessThan(35);
    expect(project.model.seed).toBe(4242); expect(project.model.nodes[0]).toEqual({ ...source });
    const oversized = { ...project, description: 'x'.repeat(HISTORY_BYTE_LIMIT + 1) };
    const result = commitEdit(history, project, oversized, 'Edit project description');
    expect(result.project.description).toBe(oversized.description); expect(result.history.estimatedBytes).toBeLessThanOrEqual(HISTORY_BYTE_LIMIT); expect(result.history.discarded).toBeGreaterThan(history.discarded);
  });
  it('does not create actions for revision-only writes; gives concrete names to run, model and resource edits', () => {
    const project = createExample('factory'), history = emptyHistory();
    expect(commitEdit(history, project, { ...project, revision: 900 }).history).toBe(history);
    expect(describeProjectEdit(project, mutateProject(project, next => { next.model.resources[0].calendar.push({ start: 0, end: 60, capacity: 0 }); }))).toBe('Change Machining team settings');
    expect(describeProjectEdit(project, mutateProject(project, next => { const node = next.model.nodes.find(node => node.id === 'queue-a')!; if (node.kind === 'queue') node.capacity = 10; }))).toBe('Change Before machining waiting capacity');
    expect(describeProjectEdit(project, mutateProject(project, next => { next.description = 'A useful note'; }))).toBe('Edit project description');
  });
});
