import { describe, expect, it } from 'vitest';
import { createBlankProject, isLayoutOnly, startWorkspaceProcess } from '../src/model/workspace';
import { validateModel, validateProject } from '../src/model/validate';
import { mutateProject } from '../src/model/commands';
import { createNewProject } from '../src/model/newProject';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { modelHash } from '../src/model/identity';
import { capturePresentation, restoreScenario, saveScenario } from '../src/model/scenarios';
import { placeFacilityObject } from '../src/features/facilityCommands';
import { commitEdit, emptyHistory, redoEdit, undoEdit } from '../src/features/editorHistory';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';
import { createTemplateRecord, instantiateTemplate, readTemplate } from '../src/storage/templateFormat';

const errors = (value: unknown) => validateProject(value).filter(issue => issue.severity === 'error');
const asset = 'furniture_workbench_standard_e01';

describe('blank facility workspaces', () => {
  it('accepts explicit zero-object layouts without making empty numerical models executable', () => {
    const blank = createBlankProject();
    expect(blank.model.nodes).toEqual([]); expect(blank.model.resources).toEqual([]);
    expect(blank.facility).toEqual({ version: 1, objects: [], nodeAssets: {}, scenery: false });
    expect(blank.layout).toEqual({}); expect(errors(blank)).toEqual([]);
    expect(validateModel(blank.model).some(issue => issue.severity === 'error')).toBe(true);
    expect(() => simulate(blank.model)).toThrow();
    expect(openProjectJSON(serializeProject(blank))).toEqual(blank);
    delete blank.workspaceMode;
    expect(errors(blank).length).toBeGreaterThan(0);
  });
  it('still rejects invalid scalar, resource, facility and mode data in a layout', () => {
    const blank = createBlankProject();
    for (const invalid of [
      { ...blank, workspaceMode: 'anything' },
      { ...blank, model: { ...blank.model, horizon: -1 } },
      { ...blank, model: { ...blank.model, resources: [{}] } },
      { ...blank, facility: { ...blank.facility, objects: [{}] } },
      { ...createNewProject(), workspaceMode: 'layout' },
    ]) expect(errors(invalid).length).toBeGreaterThan(0);
  });
  it('keeps placements, resource pools and run settings when explicitly starting a process, with one Undo', () => {
    const blank = placeFacilityObject(createBlankProject(), asset, { x: 18, z: -12 }).project;
    blank.model.resources = createNewProject().model.resources;
    blank.model.horizon = 1800; blank.model.seed = 123; blank.model.currency = 'EUR';
    const before = structuredClone(blank), started = startWorkspaceProcess(blank);
    expect(blank).toEqual(before); expect(errors(started)).toEqual([]); expect(isLayoutOnly(started)).toBe(false);
    expect(started.model.nodes.map(node => node.kind)).toEqual(['source', 'queue', 'service', 'sink']);
    expect(started.facility).toEqual(blank.facility); expect(started.model.resources).toEqual(blank.model.resources);
    expect(started.model.horizon).toBe(1800); expect(started.model.seed).toBe(123); expect(started.model.currency).toBe('EUR');
    const edit = commitEdit(emptyHistory(), blank, started), undone = undoEdit(edit.history, edit.project);
    expect(undone.project.model).toEqual(blank.model); expect(isLayoutOnly(undone.project)).toBe(true);
    expect(redoEdit(undone.history, undone.project).project.model).toEqual(started.model);
    expect(simulate(started.model).status).toBe('completed');
    expect(() => startWorkspaceProcess(started)).toThrow();
  });
  it('leaves layout mode when a process step is added, preserving invalid draft validation', () => {
    const next = mutateProject(createBlankProject(), p => { p.model.nodes.push(createNewProject().model.nodes[0]); });
    expect(next.workspaceMode).toBeUndefined(); expect(errors(next).length).toBeGreaterThan(0);
  });
  it('captures and restores blank and numerical scenarios without leaking the mode between them', () => {
    const blank = saveScenario(createBlankProject(), 'Empty layout');
    const process = saveScenario(startWorkspaceProcess(blank), 'Working flow');
    const reopened = openProjectJSON(serializeProject(process));
    const restored = restoreScenario(reopened, reopened.scenarios![0].id);
    expect(isLayoutOnly(restored)).toBe(true); expect(errors(restored)).toEqual([]);
    expect(isLayoutOnly(restoreScenario(restored, reopened.scenarios![1].id))).toBe(false);
    const numerical = createExample('factory');
    const baseline = saveScenario(blank, 'Factory snapshot', numerical.model, capturePresentation(numerical));
    expect(baseline.scenarios![1].workspaceMode).toBeUndefined(); expect(errors(baseline)).toEqual([]);
  });
});

describe('portable immutable templates', () => {
  it('gives each instance a new identity while preserving all settings, scenarios and sampling identities', () => {
    const source = saveScenario(placeFacilityObject(createExample('factory'), asset).project, 'Original');
    source.savedAt = '2026-01-01T00:00:00.000Z';
    const before = structuredClone(source), record = createTemplateRecord(source, '  My factory  ');
    const first = instantiateTemplate(record), second = instantiateTemplate(record);
    expect(source).toEqual(before); expect(record.name).toBe('My factory');
    expect(new Set([source.id, first.id, second.id]).size).toBe(3);
    expect(first.revision).toBe(0); expect(first.savedAt).toBeUndefined();
    expect(first.model).toEqual(source.model); expect(first.scenarios).toEqual(source.scenarios);
    expect(first.layout).toEqual(source.layout); expect(first.facility).toEqual(source.facility);
    expect(modelHash(first.model)).toBe(modelHash(source.model));
    expect(simulate(first.model).summary).toEqual(simulate(source.model).summary);
    first.facility!.objects[0].x = 99; first.model.nodes[0].label = 'Changed';
    expect(readTemplate(record).model).toEqual(source.model); expect(second.facility).toEqual(source.facility);
  });
  it('round-trips a layout-only template through ordinary project JSON', () => {
    const source = placeFacilityObject(createBlankProject('service'), asset).project;
    const record = createTemplateRecord(source, 'Room');
    const reopened = openProjectJSON(serializeProject(instantiateTemplate(record)));
    expect(isLayoutOnly(reopened)).toBe(true); expect(reopened.facility).toEqual(source.facility);
    expect(reopened.model.nodes).toEqual([]); expect(record.objects).toBe(1); expect(record.steps).toBe(0);
  });
  it('rejects corrupt, mismatched, oversized and unsafe template records without changing originals', () => {
    const record = createTemplateRecord(createBlankProject(), 'Safe');
    const before = structuredClone(record);
    for (const patch of [{ payload: '{}' }, { name: 'Other' }, { steps: 1 }, { objects: 2 }, { world: 'unknown' }, { bytes: 5_000_001 }, { id: 'bad' }]) {
      expect(() => readTemplate({ ...record, ...patch })).toThrow();
    }
    const payload = record.payload.replace('"schemaVersion": 1', '"schemaVersion": 1, "__proto__": {}');
    expect(() => readTemplate({ ...record, payload, bytes: new TextEncoder().encode(payload).length })).toThrow();
    expect(() => createTemplateRecord(createBlankProject(), ' ')).toThrow();
    expect(record).toEqual(before);
  });
});
