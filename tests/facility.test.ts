import { describe, expect, it } from 'vitest';
import { createStudioExample } from '../src/examples/studio';
import { createNewProject } from '../src/model/newProject';
import { modelHash } from '../src/model/identity';
import { parseProject, validateProject } from '../src/model/validate';
import { capturePresentation, restoreScenario, saveScenario } from '../src/model/scenarios';
import { commitEdit, emptyHistory, redoEdit, undoEdit } from '../src/features/editorHistory';
import { duplicateFacilityObject, placeFacilityObject, changeFacilityObject, removeFacilityObject, replaceFacilityAsset, setNodeAsset, insertProcessCell, insertEquipment, alignInsertedProcess, nextQuarterTurn, setFacilityScenery } from '../src/features/facilityCommands';
import { capacityLayout } from '../src/scene/capacityFootprint';
import { sceneLayout } from '../src/scene/graph';
import { createWorkshopFacility } from '../src/examples/facility';
import { createExample } from '../src/examples';
import { renameNode, removeNode } from '../src/features/modelEdits';
import { duplicateStep } from '../src/features/processCommands';
import { simulate } from '../src/engine';

const asset = 'furniture_workbench_standard_e01';
const valid = (p: unknown) => validateProject(p).filter(issue => issue.severity === 'error');

describe('facility presentation and process boundaries', () => {
  it('keeps all old world projects valid without introducing presentation fields', () => {
    for (const world of ['factory', 'festival', 'service'] as const) {
      const before = createStudioExample(world);
      expect(valid(before)).toEqual([]);
      expect(parseProject(JSON.stringify(before))).toEqual(before);
      expect(before.facility).toBeUndefined();
    }
  });
  it('opens a complete synthetic workshop layout without changing the reference Factory calculation', () => {
    const project = createWorkshopFacility(), reference = createExample('factory');
    expect(valid(project)).toEqual([]); expect(project.facility!.objects.length).toBeGreaterThan(40);
    expect(project.facility!.scenery).toBe(false); expect(project.id).not.toBe(reference.id);
    expect(project.model).toEqual(reference.model);
    expect(simulate(project.model).summary).toEqual(simulate(reference.model).summary);
    expect(parseProject(JSON.stringify(project)).facility).toEqual(project.facility);
  });
  it('preserves the numerical fingerprint and independently executed results through visual edits', () => {
    const before = createStudioExample('factory');
    const placed = placeFacilityObject(before, asset, { x: 16, z: -12 });
    const moved = changeFacilityObject(placed.project, placed.id, { x: -8, y: 12, z: 19, rotation: 137, scale: 2.4 });
    const decorated = setNodeAsset(moved, before.model.nodes.find(node => node.kind === 'service')!.id, asset);
    expect(modelHash(decorated.model)).toBe(modelHash(before.model));
    expect(simulate(decorated.model).summary).toEqual(simulate(before.model).summary);
    expect(before.facility).toBeUndefined();
  });
  it('round-trips a rotated/scaled facility and restores complete immutable scenario state', () => {
    const placed = placeFacilityObject(createNewProject(), asset);
    const original = changeFacilityObject(placed.project, placed.id, { rotation: -45, scale: .8, name: 'Inspection bench', x: -13, y: 3, z: 8 });
    const saved = saveScenario(original, 'Facility A');
    const changed = changeFacilityObject(saved, placed.id, { rotation: 90, scale: 3 });
    expect(restoreScenario(parseProject(JSON.stringify(changed)), saved.scenarios![0].id).facility).toEqual(original.facility);
    expect(saved.scenarios![0].facility).toEqual(original.facility);
  });
  it('uses captured baseline presentation instead of later draft art', () => {
    const before = placeFacilityObject(createNewProject(), asset).project;
    const baseline = capturePresentation(before);
    const later = changeFacilityObject(before, before.facility!.objects[0].id, { x: 44, rotation: 180 });
    const saved = saveScenario(later, 'Original facility', before.model, baseline);
    expect(saved.scenarios![0].facility).toEqual(before.facility);
    expect(saved.facility).toEqual(later.facility);
  });
  it('clears new presentation when restoring an old scenario', () => {
    const old = saveScenario(createNewProject(), 'Before objects');
    const placed = placeFacilityObject(old, asset).project;
    expect(restoreScenario(placed, old.scenarios![0].id).facility).toBeUndefined();
  });
  it('records a placement or transform as one undoable edit with monotonic revisions', () => {
    const before = createNewProject();
    const placed = placeFacilityObject(before, asset);
    const added = commitEdit(emptyHistory(), before, placed.project, 'Place bench');
    const changed = commitEdit(added.history, added.project, changeFacilityObject(added.project, placed.id, { x: 12, rotation: 90 }), 'Move bench');
    expect(changed.history.past).toHaveLength(2);
    const undone = undoEdit(changed.history, changed.project);
    expect(undone.project.facility).toEqual(added.project.facility);
    const redone = redoEdit(undone.history, undone.project);
    expect(redone.project.facility).toEqual(changed.project.facility);
    expect(redone.project.revision).toBeGreaterThan(changed.project.revision);
  });
  it('copies independent placement identity and removes only the chosen object', () => {
    const placed = placeFacilityObject(createNewProject(), asset);
    const copied = duplicateFacilityObject(placed.project, placed.id);
    expect(copied.id).not.toBe(placed.id);
    const remaining = removeFacilityObject(copied.project, placed.id);
    expect(remaining.facility!.objects.map(object => object.id)).toEqual([copied.id]);
    expect(remaining.model).toEqual(placed.project.model);
  });
  it('keeps node appearance references coherent through rename, copy and removal', () => {
    const original = createStudioExample('factory');
    const queue = original.model.nodes.find(node => node.kind === 'queue')!;
    const decorated = setNodeAsset(original, queue.id, asset);
    const renamed = renameNode(decorated, queue.id, 'buffer-renamed');
    expect(renamed.facility!.nodeAssets[queue.id]).toBeUndefined();
    const duplicate = duplicateStep(renamed, 'buffer-renamed', 'detached');
    expect(duplicate.project.facility!.nodeAssets[duplicate.id]).toEqual(renamed.facility!.nodeAssets['buffer-renamed']);
    const removed = removeNode(renamed, 'buffer-renamed', 'next' in queue ? queue.next : '');
    expect(removed.facility!.nodeAssets['buffer-renamed']).toBeUndefined();
  });
  it('adds a valid cell while preserving prior sampling identities and explicit shared resources', () => {
    const before = createStudioExample('factory');
    const anchor = before.model.nodes.find(node => node.kind === 'source')!;
    const added = insertProcessCell(before, 'inspection', anchor.id, { seconds: 35, team: before.model.resources[0].id });
    expect(valid(added.project)).toEqual([]);
    expect(added.project.model.nodes).toHaveLength(before.model.nodes.length + 2);
    expect(added.project.model.resources).toEqual(before.model.resources);
    for (const old of before.model.nodes) expect(added.project.model.nodes.find(node => node.id === old.id)!.samplingId).toBe(old.samplingId);
    const service = added.project.model.nodes.find(node => node.id === added.id)!;
    expect(service.kind === 'service' && service.resources).toEqual([{ poolId: before.model.resources[0].id, units: 1 }]);
    const committed = commitEdit(emptyHistory(), before, added.project);
    expect(undoEdit(committed.history, committed.project).project.model).toEqual(before.model);
  });
  it('rejects invalid transforms/identities while preserving safe unavailable asset references', () => {
    const placed = placeFacilityObject(createNewProject(), asset).project;
    const original = JSON.stringify(placed);
    expect(() => changeFacilityObject(placed, placed.facility!.objects[0].id, { scale: Infinity })).toThrow();
    expect(JSON.stringify(placed)).toBe(original);
    const bad = structuredClone(placed); bad.facility!.objects[0].assetId = '../../remote';
    expect(valid(bad).length).toBeGreaterThan(0);
    const missing = structuredClone(placed); missing.facility!.objects[0].assetId = 'unavailable-equipment';
    expect(valid(missing)).toEqual([]);
    expect(validateProject(missing)).toEqual([]);
    expect(parseProject(JSON.stringify(missing)).facility).toEqual(missing.facility);
  });
  it('rejects sparse/duplicate placements and dangling node appearance references', () => {
    const placed = placeFacilityObject(createNewProject(), asset).project;
    const duplicate = structuredClone(placed); duplicate.facility!.objects.push({ ...duplicate.facility!.objects[0] });
    expect(valid(duplicate).length).toBeGreaterThan(0);
    const sparse = structuredClone(placed); sparse.facility!.objects.length = 3;
    expect(valid(sparse).length).toBeGreaterThan(0);
    const dangling = structuredClone(placed); dangling.facility!.nodeAssets.missing = { ...dangling.facility!.objects[0] };
    expect(valid(dangling).length).toBeGreaterThan(0);
  });
  it('replaces an unavailable object without losing its identity, transform or custom name', () => {
    const placed = placeFacilityObject(createNewProject(), asset);
    const missing = changeFacilityObject(placed.project, placed.id, { name: 'My workstation', x: 44, z: -21, rotation: 135, scale: 1.4 });
    missing.facility!.objects[0].assetId = 'unavailable-equipment';
    const replaced = replaceFacilityAsset(missing, placed.id, asset);
    expect(replaced.facility!.objects[0]).toMatchObject({ id: placed.id, name: 'My workstation', x: 44, z: -21, rotation: 135, scale: 1.4, assetId: asset });
    expect(replaced.model).toEqual(missing.model);
  });
  it('can explicitly share a resource whose identity is a special control word', () => {
    const project = createStudioExample('factory');
    project.model.resources.push({ id: 'new', label: 'Existing team', capacity: 1, installedCapacity: 1, calendar: [], costPerHour: 0, overtimeCostPerHour: 0 });
    const anchor = project.model.nodes.find(node => node.kind === 'source')!;
    const next = insertProcessCell(project, 'inspection', anchor.id, { seconds: 30, team: 'pool:new' });
    expect(next.project.model.resources).toEqual(project.model.resources);
    const service = next.project.model.nodes.find(node => node.id === next.id)!;
    expect(service.kind === 'service' && service.resources).toEqual([{ poolId: 'new', units: 1 }]);
  });
  it('preserves an equipment reference when applying an unchanged node ID', () => {
    const project = createStudioExample('factory'), id = project.model.nodes[0].id;
    const decorated = setNodeAsset(project, id, asset, { rotation: 315, scale: 1.2 });
    const same = renameNode(decorated, id, id);
    expect(same.facility).toEqual(decorated.facility);
    expect(commitEdit(emptyHistory(), decorated, same).entry).toBeUndefined();
  });
  it('preserves the angular remainder when rotating by a quarter turn', () => {
    expect(nextQuarterTurn(315)).toBe(45); expect(nextQuarterTurn(300)).toBe(30); expect(nextQuarterTurn(-45)).toBe(45);
    expect(nextQuarterTurn(270)).toBe(0); expect(nextQuarterTurn(-360)).toBe(90);
  });
  it('anchors a dropped process in the candidate layout rather than the old inverse map', () => {
    const project = createNewProject();
    const service = project.model.nodes.find(node => node.kind === 'service')!;
    if (service.kind !== 'service') throw new Error('Synthetic service missing'); service.servers = 2;
    for (const node of project.model.nodes) project.layout[node.id] = { x: node.kind === 'sink' ? 10 : 0, z: node.kind === 'source' ? -8 : node.kind === 'queue' ? -4 : 0 };
    const before = structuredClone(project);
    const inserted = insertEquipment(project, asset, service.id, { seconds: 30, team: 'none' });
    const aligned = alignInsertedProcess(project, inserted, { x: 5, z: 3 });
    const actual = capacityLayout(aligned.project.model.nodes, sceneLayout(aligned.project)).positions[aligned.id];
    expect(actual.x).toBeCloseTo(5, 7); expect(actual.z).toBeCloseTo(3, 7);
    expect(project).toEqual(before);
    for (const node of project.model.nodes) expect(aligned.project.layout[node.id]).toEqual(project.layout[node.id]);
    expect(() => alignInsertedProcess(project, inserted, { x: 5000, z: 5000 })).toThrow();
    expect(project).toEqual(before);
  });
  it('keeps elevation and scenery in presentation while filling the bounded placement grid', () => {
    const original = createNewProject(); let project = setFacilityScenery(original, false);
    for (let i = 0; i < 500; i++) project = placeFacilityObject(project, asset).project;
    const points = project.facility!.objects.map(object => `${object.x}:${object.z}`);
    expect(new Set(points).size).toBe(500); expect(valid(project)).toEqual([]);
    expect(modelHash(project.model)).toBe(modelHash(original.model)); expect(project.facility!.scenery).toBe(false);
    expect(() => placeFacilityObject(project, asset)).toThrow();
  });
});
