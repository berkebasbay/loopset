import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { scaleDistribution, setNodeMean, scaleDemand, horizonImpact, changeHorizon, arrivalProfile } from '../src/model/easeCommands';
import { meanDuration } from '../src/model/commands';
import { arrivalExpectation } from '../src/model/workBudget';
import { modelHash } from '../src/model/identity';
import { commitEdit, emptyHistory, undoEdit, redoEdit } from '../src/features/editorHistory';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';

function fixture() {
  const p = createExample('factory');
  p.model.nodes.find(n => n.kind === 'source')!.arrival = { kind: 'poisson', segments: [{ start: 0, end: 900, perHour: 40 }, { start: 1800, end: 3600, perHour: 0 }] };
  p.model.resources[0].calendar = [{ start: 1200, end: 2400, capacity: 0 }];
  return p;
}
describe('explicit shape-preserving edits', () => {
  it('scales each supported distribution without changing type or the source values', () => {
    expect(scaleDistribution({ kind: 'constant', value: 0 }, 60)).toEqual({ kind: 'constant', value: 60 });
    expect(scaleDistribution({ kind: 'constant', value: 30 }, 60)).toEqual({ kind: 'constant', value: 60 });
    expect(scaleDistribution({ kind: 'exponential', mean: 30 }, 60)).toEqual({ kind: 'exponential', mean: 60 });
    const triangular = { kind: 'triangular' as const, min: 15, mode: 30, max: 45 };
    expect(scaleDistribution(triangular, 60)).toEqual({ kind: 'triangular', min: 30, mode: 60, max: 90 });
    const empirical = { kind: 'empirical' as const, values: [10, 20, 30] };
    expect(scaleDistribution(empirical, 40)).toEqual({ kind: 'empirical', values: [20, 40, 60] });
    expect(triangular.min).toBe(15); expect(empirical.values).toEqual([10, 20, 30]);
    expect(() => scaleDistribution(triangular, 604800)).toThrow('range');
    expect(() => scaleDistribution({ kind: 'empirical', values: [0, 0] }, 1)).toThrow('zero-average');
    expect(() => scaleDistribution(triangular, NaN)).toThrow('finite');
  });
  it('commits one average edit, keeps sampling identities and restores exact shape with Undo/Redo and file transfer', () => {
    const p = fixture(), node = p.model.nodes.find(n => n.kind === 'service')!;
    node.duration = { kind: 'triangular', min: 15, mode: 30, max: 45 };
    const before = structuredClone(p); const next = setNodeMean(p, node.id, 60);
    const scaledNode = next.model.nodes.find(n => n.id === node.id);
    if (scaledNode?.kind !== 'service') throw new Error('Expected the same processing step.');
    expect(meanDuration(scaledNode.duration)).toBe(60);
    expect(next.model.nodes.map(n => n.samplingId)).toEqual(before.model.nodes.map(n => n.samplingId));
    const committed = commitEdit(emptyHistory(), p, next);
    expect(committed.history.past).toHaveLength(1); expect(committed.project.revision).toBe(p.revision + 1);
    const undone = undoEdit(committed.history, committed.project);
    expect(undone.project.model).toEqual(before.model);
    expect(redoEdit(undone.history, undone.project).project.model).toEqual(next.model);
    expect(openProjectJSON(serializeProject(next)).model).toEqual(next.model);
    expect(p).toEqual(before);
  });
  it('multiplies only rates while preserving zero periods, gaps, classes and sampling identity', () => {
    const p = fixture(), source = p.model.nodes.find(n => n.kind === 'source')!;
    const next = scaleDemand(p, source.id, 2), n = next.model.nodes.find(n => n.kind === 'source')!;
    expect(n.arrival).toEqual({ kind: 'poisson', segments: [{ start: 0, end: 900, perHour: 80 }, { start: 1800, end: 3600, perHour: 0 }] });
    expect(n.samplingId).toBe(source.samplingId); expect(n.classes).toEqual(source.classes);
    expect(arrivalExpectation(next.model)).toEqual({ count: 20, stochastic: true });
    source.arrival = { kind: 'schedule', times: [0, 900] };
    expect(() => scaleDemand(p, source.id, 2)).toThrow('Exact arrival');
    expect(() => scaleDemand(p, source.id, NaN)).toThrow('finite');
  });
});
describe('horizon changes require explicit time-plan choices', () => {
  it('keeps schedules unchanged on extension and refuses destructive shrink by default', () => {
    const p = fixture(); p.model.warmup = 2000;
    const impact = horizonImpact(p, 1500);
    expect(impact).toMatchObject({ clippedArrivalPeriods: 1, clippedCalendarPeriods: 1, warmupOutside: true });
    expect(() => changeHorizon(p, 1500, 'keep')).toThrow('outside');
    const extended = changeHorizon(p, 7200, 'keep');
    expect(extended.model.nodes).toEqual(p.model.nodes); expect(extended.model.resources).toEqual(p.model.resources);
    expect(extended.model.warmup).toBe(2000);
    expect(changeHorizon(p, p.model.horizon, 'keep').model).toEqual(p.model);
  });
  it('crops only with explicit choice and repeats calendars/profiles within checked bounds', () => {
    const p = fixture();p.model.warmup = 2000;
    const cropped = changeHorizon(p, 1500, 'crop');
    expect(cropped.model.warmup).toBe(0);
    expect(cropped.model.resources[0].calendar).toEqual([{ start: 1200, end: 1500, capacity: 0 }]);
    expect(cropped.model.nodes.find(n => n.kind === 'source')!.arrival).toEqual({ kind: 'poisson', segments: [{ start: 0, end: 900, perHour: 40 }] });
    const repeated = changeHorizon(p, 7200, 'repeat');
    expect(repeated.model.nodes.find(n => n.kind === 'source')!.arrival).toEqual({ kind: 'poisson', segments: [{ start: 0, end: 900, perHour: 40 }, { start: 1800, end: 3600, perHour: 0 }, { start: 3600, end: 4500, perHour: 40 }, { start: 5400, end: 7200, perHour: 0 }] });
    expect(repeated.model.resources[0].calendar).toEqual([{ start: 1200, end: 2400, capacity: 0 }, { start: 4800, end: 6000, capacity: 0 }]);
    expect(() => changeHorizon(p, 365 * 86400, 'repeat')).toThrow('limit');
    expect(() => changeHorizon(p, 1000, 'repeat')).toThrow('extending');
  });
  it('keeps exact duplicate timestamps and refuses row-limit overflow before allocating', () => {
    const p = createExample('factory'); const source = p.model.nodes.find(n => n.kind === 'source')!;
    source.arrival = { kind: 'schedule', times: [0, 0, 3599] };
    expect(changeHorizon(p, 7200, 'repeat').model.nodes.find(n => n.kind === 'source')!.arrival).toEqual({ kind: 'schedule', times: [0, 0, 3599, 3600, 3600, 7199] });
    expect(horizonImpact(p, 3000).removedArrivals).toBe(1);
    expect(changeHorizon(p, 3000, 'crop').model.nodes.find(n => n.kind === 'source')!.arrival).toEqual({ kind: 'schedule', times: [0, 0] });
    source.arrival.times = Array(60000).fill(0);
    expect(() => changeHorizon(p, 7200, 'repeat')).toThrow('limit');
  });
  it('previews profile replacement without mutation, preserves integrated demand, and applies as one command', () => {
    const p = fixture(), source = p.model.nodes.find(n => n.kind === 'source')!, hash = modelHash(p.model);
    for (const profile of ['regular', 'peak', 'waves'] as const) {
      const candidate = arrivalProfile(p, source.id, profile);
      expect(arrivalExpectation(candidate.model)).toEqual({ count: 10, stochastic: true });
      expect(modelHash(p.model)).toBe(hash);
      expect(candidate.model.nodes.find(n => n.kind === 'source')!.samplingId).toBe(source.samplingId);
    }
    p.model.horizon = .3; p.model.resources.forEach(pool => { pool.calendar = []; });
    source.arrival = { kind: 'fixed', perHour: 3600 };
    expect(arrivalExpectation(arrivalProfile(p, source.id, 'regular').model).count).toBe(1);
    source.arrival = { kind: 'poisson', segments: [] };
    expect(arrivalExpectation(arrivalProfile(p, source.id, 'peak').model).count).toBe(0);
  });
});
