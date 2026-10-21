import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { emptySelection, pruneSelection, reconcileSelection, remapSelection, selectStep, type EditorSelection } from '../src/features/editorSelection';
import { addNode, removeNode, renameNode } from '../src/features/modelEdits';

describe('one world/DOM selection contract', () => {
  it('plain click replaces; modified clicks and explicit checkboxes toggle without losing a coherent primary', () => {
    let selection = selectStep(emptySelection(), 'station-a');
    selection = selectStep(selection, 'station-b', 'toggle');
    expect(selection).toEqual({ ids: ['station-a', 'station-b'], primary: 'station-b' });
    selection = selectStep(selection, 'station-a', 'inspect');
    expect(selection.ids).toEqual(['station-a', 'station-b']); expect(selection.primary).toBe('station-a');
    selection = selectStep(selection, 'station-c', 'inspect');
    expect(selection).toEqual({ ids: ['station-c'], primary: 'station-c' });
    selection = selectStep(selection, 'station-b', 'toggle');
    selection = selectStep(selection, 'station-b', 'toggle');
    expect(selection).toEqual({ ids: ['station-c'], primary: 'station-c' });
    expect(selectStep(selection, 'station-a')).toEqual({ ids: ['station-a'], primary: 'station-a' });
    expect(selectStep(selection, null)).toEqual(emptySelection());
  });
  it('removes only the toggled member; removing primary chooses the last retained member', () => {
    let selection: EditorSelection = { ids: ['a', 'b', 'c'], primary: 'b' };
    selection = selectStep(selection, 'a', 'toggle'); expect(selection.primary).toBe('b');
    expect(selectStep(selection, 'b', 'toggle')).toEqual({ ids: ['c'], primary: 'c' });
    expect(selectStep({ ids: ['a'], primary: 'a' }, 'a', 'toggle')).toEqual(emptySelection());
  });
  it('prunes missing/duplicate IDs against the bounded actual model, including legal prototype-like IDs', () => {
    let project = createExample('factory');
    project = renameNode(project, 'station-a', 'toString');
    project = renameNode(project, 'station-b', 'valueOf');
    const selected = pruneSelection({ ids: ['toString', 'missing', 'valueOf', 'toString'], primary: 'missing' }, project.model.nodes);
    expect(selected).toEqual({ ids: ['toString', 'valueOf'], primary: 'valueOf' });
    expect(pruneSelection(selected, project.model.nodes)).toBe(selected);
    expect(pruneSelection(selected, [])).toEqual(emptySelection());
  });
  it('remaps identity edits and their Undo without growing selection; deletion and document changes prune cleanly', () => {
    const before = createExample('festival');
    const selection = { ids: ['station-a', 'station-b'], primary: 'station-a' };
    const renamed = renameNode(before, 'station-a', 'hasOwnProperty');
    const afterRename = reconcileSelection(selection, before.model.nodes, renamed.model.nodes);
    expect(afterRename).toEqual({ ids: ['hasOwnProperty', 'station-b'], primary: 'hasOwnProperty' });
    expect(reconcileSelection(afterRename, renamed.model.nodes, before.model.nodes)).toEqual(selection);
    const removed = removeNode(before, 'station-a', 'station-c');
    const afterDelete = reconcileSelection(selection, before.model.nodes, removed.model.nodes);
    expect(afterDelete).toEqual({ ids: ['station-b'], primary: 'station-b' });
    expect(reconcileSelection(afterDelete, removed.model.nodes, before.model.nodes)).toEqual(afterDelete);
    const added = addNode(before, 'delay');
    expect(reconcileSelection(selection, before.model.nodes, added.project.model.nodes)).toEqual(selection);
    // A new document explicitly starts from an empty selection, even if its node IDs match.
    expect(pruneSelection(emptySelection(), createExample('service').model.nodes)).toEqual(emptySelection());
    expect(remapSelection(selection, 'station-a', 'station-b')).toEqual({ ids: ['station-b'], primary: 'station-b' });
  });
});
