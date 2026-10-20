import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { duplicateProject, setCapacity } from '../src/model/commands';
import { modelHash } from '../src/model/identity';
import { removeScenario, restoreScenario, saveScenario } from '../src/model/scenarios';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';
import { validateProject } from '../src/model/validate';

describe('portable immutable scenario branches', () => {
  it('forks a local document without changing the modeled process or original saved copy', () => {
    const original = saveScenario(createExample('factory'), 'First');
    const copy = duplicateProject(original);
    expect(copy.id).not.toBe(original.id); expect(copy.revision).toBe(0);
    expect(modelHash(copy.model)).toBe(modelHash(original.model));
    copy.scenarios![0].name = 'A different note';
    expect(original.scenarios![0].name).toBe('First');
    expect(validateProject(copy)).toEqual([]);
  });
  it('keeps the original model intact while an alternative is edited and saved', () => {
    let p = createExample('factory'); const original = modelHash(p.model);
    p = saveScenario(p, 'Original'); p = setCapacity(p, 'station-c', 2); const alternative = modelHash(p.model);
    p = saveScenario(p, 'Two packing stations');
    expect(original).not.toBe(alternative);
    expect(modelHash(p.scenarios![0].model)).toBe(original);
    expect(modelHash(p.scenarios![1].model)).toBe(alternative);
    p = openProjectJSON(serializeProject(p));
    const revision = p.revision; p = restoreScenario(p, p.scenarios![0].id);
    expect(p.revision).toBe(revision + 1); expect(modelHash(p.model)).toBe(original);
    expect(p.scenarios).toHaveLength(2);
  });
  it('does not mutate either the source or saved snapshot on restore', () => {
    const original = createExample('factory'); const p = saveScenario(original, 'First');
    const restored = restoreScenario(p, p.scenarios![0].id);
    restored.model.nodes[0].label = 'Different'; restored.layout['station-a'].x = 50;
    expect(original.model.nodes[0].label).not.toBe('Different');
    expect(p.scenarios![0].layout['station-a'].x).toBe(-4);
    expect(removeScenario(p, p.scenarios![0].id).scenarios).toEqual([]);
    expect(p.scenarios).toHaveLength(1);
  });
  it('rejects invalid or unbounded saved data in imports', () => {
    const p = saveScenario(createExample('factory'), 'First');
    p.scenarios![0].model.horizon = Number.NaN;
    expect(validateProject(p).some(i => i.path.startsWith('scenarios.0.'))).toBe(true);
    expect(() => serializeProject(p)).toThrow('Repair');
  });
});
