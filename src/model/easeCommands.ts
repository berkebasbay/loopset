import { meanDuration, mutateProject } from './commands';
import { arrivalExpectation } from './workBudget';
import { MAX_ARRIVALS_PER_HOUR, MAX_RUN_SECONDS } from './limits';
import type { Distribution, Project } from './types';
import { validateProject } from './validate';
import { easeCommandMessages as m } from '../ui/messages/easeCommands';

function checked(project: Project): Project {
  const issue = validateProject(project).find(issue => issue.severity === 'error');
  if (issue) throw new Error(issue.message);
  return project;
}

/** Shape-preserving scaling; choosing a fixed distribution is a separate UI action. */
export function scaleDistribution(distribution: Distribution, targetMean: number): Distribution {
  if (!Number.isFinite(targetMean) || targetMean < 0) throw new Error(m.invalidMean);
  const oldMean = meanDuration(distribution);
  if (!Number.isFinite(oldMean) || oldMean < 0 || distribution.kind !== 'constant' && oldMean === 0 && targetMean > 0) throw new Error(m.zeroMean);
  const factor = oldMean === 0 ? 1 : targetMean / oldMean;
  let next: Distribution;
  switch (distribution.kind) {
    case 'constant': next = { kind: 'constant', value: targetMean }; break;
    case 'exponential': next = { kind: 'exponential', mean: targetMean }; break;
    case 'triangular': next = { kind: 'triangular', min: distribution.min * factor, mode: distribution.mode * factor, max: distribution.max * factor }; break;
    case 'empirical': next = { kind: 'empirical', values: distribution.values.map(value => value * factor) }; break;
  }
  const values = next.kind === 'constant' ? [next.value] : next.kind === 'exponential' ? [next.mean] : next.kind === 'triangular' ? [next.min, next.mode, next.max] : next.values;
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 604800) || next.kind === 'exponential' && next.mean <= 0) throw new Error(m.distributionRange);
  return next;
}

export function setNodeMean(project: Project, nodeId: string, targetMean: number): Project {
  return checked(mutateProject(project, copy => {
    const node = copy.model.nodes.find(node => node.id === nodeId);
    if (!node || node.kind !== 'service' && node.kind !== 'delay') throw new Error(m.missingTimeStep);
    node.duration = scaleDistribution(node.duration, targetMean);
  }));
}

export function scaleDemand(project: Project, sourceId: string, factor: number): Project {
  if (!Number.isFinite(factor) || factor < 0) throw new Error(m.invalidFactor);
  return checked(mutateProject(project, copy => {
    const node = copy.model.nodes.find(node => node.id === sourceId);
    if (!node || node.kind !== 'source') throw new Error(m.missingSource);
    const rate = (value: number) => {
      const next = value * factor;
      if (!Number.isFinite(next) || next > MAX_ARRIVALS_PER_HOUR) throw new Error(m.demandRange);
      return next;
    };
    if (node.arrival.kind === 'fixed') node.arrival.perHour = rate(node.arrival.perHour);
    else if (node.arrival.kind === 'poisson') node.arrival.segments = node.arrival.segments.map(segment => ({ ...segment, perHour: rate(segment.perHour) }));
    else throw new Error(m.exactSchedule);
  }));
}

export interface HorizonImpact {
  from: number; to: number; removedArrivals: number; clippedArrivalPeriods: number;
  clippedCalendarPeriods: number; warmupOutside: boolean; extended: boolean; notes: string[];
}
export function horizonImpact(project: Project, nextHorizon: number): HorizonImpact {
  if (!Number.isFinite(nextHorizon) || nextHorizon <= 0 || nextHorizon > MAX_RUN_SECONDS) throw new Error(m.invalidHorizon);
  let removedArrivals = 0, clippedArrivalPeriods = 0, clippedCalendarPeriods = 0;
  for (const node of project.model.nodes) if (node.kind === 'source') {
    if (node.arrival.kind === 'schedule') removedArrivals += node.arrival.times.filter(time => time >= nextHorizon).length;
    if (node.arrival.kind === 'poisson') clippedArrivalPeriods += node.arrival.segments.filter(segment => segment.end > nextHorizon).length;
  }
  for (const pool of project.model.resources) clippedCalendarPeriods += pool.calendar.filter(period => period.end > nextHorizon).length;
  const warmupOutside = project.model.warmup >= nextHorizon;
  const notes: string[] = [m.unchangedLists];
  if (nextHorizon > project.model.horizon) notes.push(m.extendedRun);
  if (removedArrivals) notes.push(m.outsideArrivals(removedArrivals));
  if (clippedArrivalPeriods) notes.push(m.outsideRates(clippedArrivalPeriods));
  if (clippedCalendarPeriods) notes.push(m.outsideCalendar(clippedCalendarPeriods));
  if (warmupOutside) notes.push(m.warmupOutside);
  return { from: project.model.horizon, to: nextHorizon, removedArrivals, clippedArrivalPeriods, clippedCalendarPeriods, warmupOutside, extended: nextHorizon > project.model.horizon, notes };
}

export function changeHorizon(project: Project, seconds: number, policy: 'keep' | 'crop' | 'repeat'): Project {
  const impact = horizonImpact(project, seconds), oldHorizon = project.model.horizon;
  if (policy === 'keep' && (impact.removedArrivals || impact.clippedArrivalPeriods || impact.clippedCalendarPeriods || impact.warmupOutside)) throw new Error(m.keepOutside);
  if (policy === 'repeat' && seconds < oldHorizon) throw new Error(m.repeatShorter);
  const repeatCount = Math.ceil(seconds / oldHorizon);
  // Check lengths before allocating repeated inputs, even on very long runs.
  const repeatedSize = (starts: readonly number[]) => {
    if (!starts.length) return 0;
    if (!Number.isSafeInteger(repeatCount)) return Infinity;
    const complete = repeatCount - 1, offset = complete * oldHorizon;
    return complete * starts.length + starts.filter(start => start + offset < seconds).length;
  };
  if (policy === 'repeat') {
    for (const node of project.model.nodes) if (node.kind === 'source') {
      if (node.arrival.kind === 'schedule' && repeatedSize(node.arrival.times) > 100000 || node.arrival.kind === 'poisson' && repeatedSize(node.arrival.segments.map(segment => segment.start)) > 200) throw new Error(m.repeatLimit);
    }
    if (project.model.resources.some(pool => repeatedSize(pool.calendar.map(period => period.start)) > 200)) throw new Error(m.repeatLimit);
  }
  return checked(mutateProject(project, copy => {
    copy.model.horizon = seconds;
    if (policy === 'crop' && impact.warmupOutside) copy.model.warmup = 0;
    if (policy === 'keep') return;
    for (const node of copy.model.nodes) if (node.kind === 'source') {
      if (node.arrival.kind === 'schedule') {
        const times = node.arrival.times;
        node.arrival.times = !times.length ? [] : policy === 'crop' ? times.filter(time => time < seconds) : Array.from({ length: repeatCount }, (_, i) => times.map(time => time + i * oldHorizon)).flat().filter(time => time < seconds);
      } else if (node.arrival.kind === 'poisson') {
        const segments = node.arrival.segments;
        node.arrival.segments = (policy === 'crop' || !segments.length ? segments : Array.from({ length: repeatCount }, (_, i) => segments.map(segment => ({ ...segment, start: segment.start + i * oldHorizon, end: segment.end === oldHorizon ? (i + 1) * oldHorizon : segment.end + i * oldHorizon }))).flat()).filter(segment => segment.start < seconds).map(segment => ({ ...segment, end: Math.min(seconds, segment.end) }));
      }
    }
    for (const pool of copy.model.resources) {
      const periods = pool.calendar;
      pool.calendar = (policy === 'crop' || !periods.length ? periods : Array.from({ length: repeatCount }, (_, i) => periods.map(period => ({ ...period, start: period.start + i * oldHorizon, end: period.end === oldHorizon ? (i + 1) * oldHorizon : period.end + i * oldHorizon }))).flat()).filter(period => period.start < seconds).map(period => ({ ...period, end: Math.min(seconds, period.end) }));
    }
  }));
}

/** Explicit profile replacement preserves source, class and sampling identities. */
export function arrivalProfile(project: Project, sourceId: string, profile: 'regular' | 'peak' | 'waves'): Project {
  return checked(mutateProject(project, copy => {
    const node = copy.model.nodes.find(node => node.id === sourceId);
    if (!node || node.kind !== 'source') throw new Error(m.missingSource);
    const count = arrivalExpectation({ ...copy.model, nodes: copy.model.nodes.map(item => item.kind === 'source' && item.id !== sourceId ? { ...item, arrival: { kind: 'fixed', perHour: 0 } } : item) }).count;
    const mean = count / copy.model.horizon * 3600;
    const weights = profile === 'regular' ? [1] : profile === 'peak' ? [.5, .5, 2.5, .5] : profile === 'waves' ? [.5, 1.5, .5, 1.5] : null;
    if (!weights) throw new Error(m.unsupportedProfile);
    node.arrival = { kind: 'poisson', segments: weights.map((weight, i) => ({ start: copy.model.horizon * i / weights.length, end: copy.model.horizon * (i + 1) / weights.length, perHour: mean * weight })) };
  }));
}
