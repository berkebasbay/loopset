import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine';
import type { Project, SourceNode } from '../src/model/types';
import { frameAt } from '../src/playback';

function calendarProject(warmup = 0): Project {
  const source = (id: string, times: number[], priority = 0): SourceNode => ({
    id, samplingId: id, label: id, kind: 'source',
    arrival: { kind: 'schedule', times }, next: 'q',
    classes: [{ id: `c${id}`, label: id, priority, probability: 1 }],
  });
  return {
    schemaVersion: 1, id: 'calendar-reference', name: 'Calendar reference',
    world: 'service', layout: {}, revision: 0, description: 'Synthetic hand-calculated case',
    model: {
      id: 'calendar-reference', name: 'Calendar reference', horizon: 6.25,
      warmup, seed: 17, slaSeconds: 1, currency: 'USD',
      resources: [{
        id: 'team', label: 'Team', capacity: 1, installedCapacity: 1,
        calendar: [{ start: 3, end: 4, capacity: 0 }], costPerHour: 0, overtimeCostPerHour: 0,
      }],
      nodes: [
        source('low', [0, .5, 1, 1.5, 2, 2.25, 3, 4]), source('high', [2], -10),
        {
          id: 'q', samplingId: 'q', label: 'Wait', kind: 'queue', capacity: 2,
          discipline: 'priority', patience: { kind: 'constant', value: 1.5 }, next: 'svc',
        },
        {
          id: 'svc', samplingId: 'svc', label: 'Service', kind: 'service',
          duration: { kind: 'constant', value: 2 }, servers: 1,
          resources: [{ poolId: 'team', units: 1 }], next: 'delay',
        },
        {
          id: 'delay', samplingId: 'delay', label: 'Delay', kind: 'delay',
          duration: { kind: 'constant', value: .25 }, next: 'out',
        },
        { id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' },
      ],
    },
  };
}

type Actor = [id: string, node: string, state: 'waiting' | 'working' | 'moving', priority: number];
type Observation = [time: number, arrivals: number, completed: number, abandoned: number, actors: Actor[]];

// Promoted from the separate 21 October replay review. These are hand-derived
// transactions, not values generated from frameAt or an engine trace snapshot.
// At t=2 the high-priority arrival wins the freed server; the calendar closes
// at t=3 without preempting it. At t=4 the server reopens and serves low:6.
const observations: Observation[] = [
  [0, 1, 0, 0, [['low:0', 'svc', 'working', 0]]],
  [.5, 2, 0, 0, [['low:0', 'svc', 'working', 0], ['low:1', 'q', 'waiting', 0]]],
  [1, 3, 0, 0, [['low:0', 'svc', 'working', 0], ['low:1', 'q', 'waiting', 0], ['low:2', 'q', 'waiting', 0]]],
  [1.5, 4, 0, 1, [['low:0', 'svc', 'working', 0], ['low:1', 'q', 'waiting', 0], ['low:2', 'q', 'waiting', 0]]],
  [2, 6, 0, 3, [['low:0', 'delay', 'moving', 0], ['low:2', 'q', 'waiting', 0], ['high:0', 'svc', 'working', -10]]],
  [2.25, 7, 1, 3, [['low:2', 'q', 'waiting', 0], ['high:0', 'svc', 'working', -10], ['low:5', 'q', 'waiting', 0]]],
  [2.5, 7, 1, 4, [['high:0', 'svc', 'working', -10], ['low:5', 'q', 'waiting', 0]]],
  [3, 8, 1, 4, [['high:0', 'svc', 'working', -10], ['low:5', 'q', 'waiting', 0], ['low:6', 'q', 'waiting', 0]]],
  [3.75, 8, 1, 5, [['high:0', 'svc', 'working', -10], ['low:6', 'q', 'waiting', 0]]],
  [4, 9, 1, 5, [['high:0', 'delay', 'moving', -10], ['low:6', 'svc', 'working', 0], ['low:7', 'q', 'waiting', 0]]],
  [4.25, 9, 2, 5, [['low:6', 'svc', 'working', 0], ['low:7', 'q', 'waiting', 0]]],
  [5.5, 9, 2, 6, [['low:6', 'svc', 'working', 0]]],
  [6, 9, 2, 6, [['low:6', 'delay', 'moving', 0]]],
  [6.25, 9, 3, 6, []],
];

describe('hand-calculated calendar, priority and patience replay', () => {
  it('seeks before, on and after each transaction in both directions without changing the result', () => {
    const project = calendarProject();
    const result = simulate(project.model);
    const original = JSON.stringify(result);
    expect(result.status).toBe('completed');
    expect([
      result.summary.arrivals, result.summary.completed, result.summary.balked,
      result.summary.reneged, result.summary.inSystem,
    ]).toEqual([9, 3, 2, 4, 0]);

    const times = observations.flatMap(([time]) => [Math.max(0, time - 1e-7), time, Math.min(6.25, time + 1e-7)]);
    for (const time of [...times, ...[...times].reverse(), 6.25, 0, 6.25, 2, 2]) {
      const expected = [...observations].reverse().find(([at]) => at <= time)!;
      const frame = frameAt(project, result, time);
      expect([frame.arrivals, frame.completed, frame.abandoned, frame.inSystem], `counts at ${time}`)
        .toEqual([expected[1], expected[2], expected[3], expected[4].length]);
      const actors = frame.actors.map(({ id, nodeId, state, priority }): Actor => [id, nodeId, state, priority]);
      expect(actors.sort(), `actors at ${time}`).toEqual([...expected[4]].sort());
    }
    expect(JSON.stringify(result)).toBe(original);
  });

  it('keeps physical replay totals separate from the post-warm-up arrival cohort', () => {
    const project = calendarProject(2.25);
    const result = simulate(project.model);
    expect(result.status).toBe('completed');
    expect([
      result.summary.arrivals, result.summary.completed, result.summary.balked,
      result.summary.reneged, result.summary.inSystem,
    ]).toEqual([3, 1, 0, 2, 0]);
    for (const time of [6.25, 4, 0, 6.25]) {
      const expected = observations.find(([at]) => at === time)!;
      const frame = frameAt(project, result, time);
      expect([frame.arrivals, frame.completed, frame.abandoned, frame.inSystem])
        .toEqual([expected[1], expected[2], expected[3], expected[4].length]);
    }
  });
});
