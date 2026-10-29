import { describe, expect, it } from 'vitest';
import { buildStarter } from '../src/templates/definitions';
import { simulate } from '../src/engine';
import { createLearningSession, learningReturnMatches, learningModelMatches, learningRunMatches, learningStage, originalLearningProject, parseLearningSession } from '../src/features/learning';

function exercise() {
  const original = buildStarter('service'), session = createLearningSession(original, 'previous')!;
  const project = structuredClone(original);
  project.model.resources.find(pool => pool.id === 'specialists')!.capacity = 3;
  return { original, session, project, baseline: simulate(original.model), result: simulate(project.model), pending: false, running: false, valid: true, comparable: true };
}
describe('learn-by-doing progression', () => {
  it('requires selection, an applied change, a completed matching run and review', () => {
    const e = exercise();
    expect(learningStage({ ...e, project: e.original })).toBe('select');
    e.session.selected = true;
    expect(learningStage({ ...e, project: e.original })).toBe('edit');
    expect(learningStage({ ...e, pending: true })).toBe('edit');
    expect(learningStage(e)).toBe('run');
    e.session.ran = true;
    expect(learningStage(e)).toBe('review');
    e.session.reviewed = true;
    expect(learningStage(e)).toBe('save');
    expect(e.result.summary.completed).toBeGreaterThan(e.baseline.summary.completed);
    expect(e.result.summary.meanWait).toBeLessThan(e.baseline.summary.meanWait);
    expect(e.result.summary.cost).toBeGreaterThan(e.baseline.summary.cost);
  });
  it('cannot pass a missing, partial, stale, tampered or noncomparable run', () => {
    const e = exercise(); e.session.selected = true; e.session.ran = true;
    for (const result of [null, e.baseline, { ...e.result, status: 'cancelled' as const }, { ...e.result, seed: e.session.seed + 1 }, { ...e.result, model: e.original.model }]) expect(learningStage({ ...e, result })).toBe('run');
    expect(learningStage({ ...e, comparable: false })).toBe('run');
    expect(learningRunMatches(e.result, e.session.baseHash, e.session.seed)).toBe(false);
    expect(learningStage({ ...e, baseline: null })).toBe('baseline');
    expect(learningStage({ ...e, baseline: null, running: true })).toBe('preparing');
  });
  it('reconstructs the exact original without changing the working model or visual edits', () => {
    const e = exercise(); e.project.name = 'My own title'; e.project.layout['station-b'].x += 2;
    const before = structuredClone(e.project), restored = originalLearningProject(e.project, e.session)!;
    expect(restored.model).toEqual(e.original.model); expect(restored.layout).toEqual(e.project.layout);
    expect(e.project).toEqual(before);
    e.project.model.horizon += 1;
    expect(originalLearningProject(e.project, e.session)).toBeNull();
    expect(learningStage(e)).toBe('off-track');
  });
  it('does not apply an exercise to another project, seed or incompatible starter', () => {
    const e = exercise();
    expect(learningModelMatches({ ...e.project, id: 'different' }, e.session)).toBe(false);
    expect(learningModelMatches({ ...e.project, model: { ...e.project.model, seed: e.session.seed + 1 } }, e.session)).toBe(false);
    expect(createLearningSession(buildStarter('factory'), null)).toBeNull();
    expect(createLearningSession(e.project, null)).toBeNull();
    expect(learningStage({ ...e, valid: false })).toBe('off-track');
  });
  it('keeps completion separate from saving a template', () => {
    const e = exercise(); e.session.finished = true;
    expect(learningStage(e)).toBe('complete'); expect(e.session.savedName).toBeUndefined();
  });
});
describe('bounded lesson receipts', () => {
  it('retains only navigation and earned progress, never projects, results or saved claims', () => {
    const { session, project, result } = exercise(); session.selected = true;
    expect(parseLearningSession(JSON.stringify({ ...session, project, result }))).toBeNull();
    expect(parseLearningSession(JSON.stringify({ ...session, finished: true, savedName: 'Unverified', extra: 1 }))).toEqual(session);
  });
  it('rejects malformed, incompatible and unbounded receipts', () => {
    const { session } = exercise();
    for (const value of [null, '', '{', '[]', 'null', ' '.repeat(2049)]) expect(parseLearningSession(value)).toBeNull();
    for (const patch of [{ version: 2 }, { projectId: '' }, { returnProjectId: 4 }, { seed: 1.2 }, { baseHash: 'invalid' }, { changedHash: session.baseHash }, { selected: 'yes' }, { ran: null }, { reviewed: 1 }]) expect(parseLearningSession(JSON.stringify({ ...session, ...patch }))).toBeNull();
  });
});

describe('returning from practice', () => {
  it('preserves history for identical saved content despite storage key order and timestamp changes', () => {
    const original = buildStarter('service');
    const stored = Object.fromEntries(Object.keys(original).sort().map(key => [key, original[key as keyof typeof original]])) as unknown as typeof original;
    stored.savedAt = '2026-01-01T00:00:00.000Z';
    expect(learningReturnMatches(original, stored)).toBe(true);
    expect(learningReturnMatches(original, { ...stored, revision: stored.revision + 1 })).toBe(false);
    expect(learningReturnMatches(original, { ...stored, name: 'Newer saved work' })).toBe(false);
  });
});
