import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine';
import { createExample } from '../src/examples';
import type { Project, RunResult, SimulationModel, SourceNode } from '../src/model/types';
import { frameAt, replayManifest, REPLAY_LIMITS, type Actor, type WorldFrame } from '../src/playback';

function projectFor(model: SimulationModel): Project { return { ...createExample('factory'), name: 'Replay fixture', model, layout: {} }; }
function scheduled(): Project {
  return projectFor({ id: 'scheduled', name: 'Scheduled reference', seed: 19, horizon: 12, warmup: 0, slaSeconds: 1, currency: 'USD', resources: [], nodes: [
    { id: 'src', samplingId: 'src', label: 'Arrivals', kind: 'source', next: 'q', arrival: { kind: 'schedule', times: [0, 1, 2, 4, 5, 6] }, classes: [{ id: 'all', label: 'All', priority: -2, probability: 1 }] },
    { id: 'q', samplingId: 'q', label: 'Waiting', kind: 'queue', next: 's', capacity: 1, discipline: 'fifo', patience: { kind: 'constant', value: 2 } },
    { id: 's', samplingId: 's', label: 'Service', kind: 'service', next: 'd', servers: 1, duration: { kind: 'constant', value: 4 }, resources: [] },
    { id: 'd', samplingId: 'd', label: 'Modeled delay', kind: 'delay', next: 'out', duration: { kind: 'constant', value: 2 } },
    { id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' },
  ] });
}
/** Explicit sequential reference: start empty for each request, with no production index/helpers. */
function fromStart(project: Project, result: RunResult, requested: number): WorldFrame {
  const time = Number.isFinite(requested) ? Math.max(0, Math.min(requested, result.trace.until)) : 0;
  const frame: WorldFrame = { time, actors: [], queues: Object.create(null), busy: Object.create(null), arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
  if (!result.trace.complete && result.trace.until === 0) return frame;
  const active = new Map<string, Actor>();
  for (const event of result.events) {
    if (event.time > time || event.time > result.trace.until) break;
    if (event.kind === 'arrival') frame.arrivals++;
    if (event.kind === 'complete') { frame.completed++; active.delete(event.entityId); }
    else if (event.kind === 'balk' || event.kind === 'renege') { frame.abandoned++; active.delete(event.entityId); }
    else active.set(event.entityId, { id: event.entityId, nodeId: event.nodeId, state: event.kind === 'queue' ? 'waiting' : event.kind === 'start' ? 'working' : 'moving', priority: result.entities.find(entity => entity.id === event.entityId)?.priority ?? 0 });
  }
  const groups: Actor[][] = [];
  for (const actor of active.values()) {
    if (actor.state === 'waiting') frame.queues[actor.nodeId] = (frame.queues[actor.nodeId] ?? 0) + 1;
    if (actor.state === 'working') frame.busy[actor.nodeId] = (frame.busy[actor.nodeId] ?? 0) + 1;
    let group = groups.find(values => values[0].nodeId === actor.nodeId && values[0].state === actor.state);
    if (!group) { group = []; groups.push(group); }
    if (group.length < 24) group.push(actor);
  }
  for (let rank = 0; rank < 24; rank++) for (const group of groups) if (group[rank] && frame.actors.length < 500) frame.actors.push(group[rank]);
  frame.inSystem = active.size; frame.aggregated = frame.actors.length < active.size || !result.trace.complete;
  // The project is deliberately irrelevant to result state.
  void project;
  return frame;
}
function dense(): Project {
  const project = scheduled(); const source = project.model.nodes[0] as SourceNode;
  project.model.horizon = 2_501;
  project.model.resources = [{ id: 'closed', label: 'Closed team', capacity: 0, installedCapacity: 1, costPerHour: 0, overtimeCostPerHour: 0, calendar: [] }];
  project.model.nodes = [{ id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' }];
  for (let i = 0; i < 30; i++) project.model.nodes.push(
    { ...source, id: `src${i}`, samplingId: `src${i}`, next: `q${i}`, arrival: { kind: 'schedule', times: Array(20).fill(0) } },
    { id: `q${i}`, samplingId: `q${i}`, label: 'Queue', kind: 'queue', next: `s${i}`, capacity: null, patience: null, discipline: 'fifo' },
    { id: `s${i}`, samplingId: `s${i}`, label: 'Station', kind: 'service', next: 'out', servers: 1, duration: { kind: 'constant', value: 1 }, resources: [{ poolId: 'closed', units: 1 }] },
  );
  project.model.nodes.push({ ...source, id: 'pulse', samplingId: 'pulse', next: 'out', arrival: { kind: 'schedule', times: Array.from({ length: 2_500 }, (_, i) => i + 0.5) } });
  return project;
}
const denseRun = (project: Project) => {
  const run = simulate(project.model, { maxTraceEntities: 10_000, maxMicrosteps: 50_000, maxEvents: 10_000_000 });
  expect(run.status).toBe('completed'); expect(run.trace.complete).toBe(true); return run;
};
const counts = (frame: WorldFrame) => [frame.arrivals, frame.completed, frame.abandoned, frame.inSystem, frame.queues.q ?? 0, frame.busy.s ?? 0, frame.actors.filter(actor => actor.state === 'moving').length];

describe('presentation checkpoint/segment replay', () => {
  it('matches hand-reasoned before/on/after queue, service, delay and abandonment boundaries', () => {
    const project = scheduled(); const run = simulate(project.model);
    expect(run.status).toBe('completed'); expect(run.trace.complete).toBe(true);
    // arrival, completed, abandoned, WIP, queue, busy, modeled-delay actors.
    const table = [
      [0, [1, 0, 0, 1, 0, 1, 0]], [1, [2, 0, 0, 2, 1, 1, 0]],
      [2, [3, 0, 1, 2, 1, 1, 0]], [3, [3, 0, 2, 1, 0, 1, 0]],
      [4, [4, 0, 2, 2, 0, 1, 1]], [5, [5, 0, 2, 3, 1, 1, 1]],
      [6, [6, 1, 3, 2, 1, 1, 0]], [7, [6, 1, 4, 1, 0, 1, 0]],
      [8, [6, 1, 4, 1, 0, 0, 1]], [10, [6, 2, 4, 0, 0, 0, 0]],
    ] as const;
    for (let i = 0; i < table.length; i++) {
      const [time, expected] = table[i];
      if (time > 0) expect(counts(frameAt(project, run, time - 0.001))).toEqual(table[i - 1][1]);
      expect(counts(frameAt(project, run, time))).toEqual(expected);
      expect(counts(frameAt(project, run, time + 0.001))).toEqual(expected);
      expect(frameAt(project, run, time)).toEqual(fromStart(project, run, time));
    }
    expect(frameAt(project, run, 4).actors).toEqual([
      { id: 'src:0', nodeId: 'd', state: 'moving', priority: -2 },
      { id: 'src:3', nodeId: 's', state: 'working', priority: -2 },
    ]);
  });

  it('uses real indexed segments and equals sequential reference under direct, random, reverse and repeated seeks', () => {
    const project = dense(); const run = denseRun(project); const before = JSON.stringify(run);
    let reads = 0;
    run.events = new Proxy(run.events, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    const manifest = replayManifest(run);
    expect(manifest.coverage).toEqual([{ start: 0, end: 2_501 }]);
    expect(manifest.checkpoints.length).toBeGreaterThan(2); expect(manifest.segments).toHaveLength(manifest.checkpoints.length);
    expect(manifest.checkpoints[0]).toMatchObject({ kind: 'origin', eventOffset: 0, activeActors: 0 });
    manifest.checkpoints.slice(1).forEach(checkpoint => {
      expect(checkpoint.kind).toBe('sealed-timestamp');
      expect(run.events[checkpoint.eventOffset - 1].time).toBe(checkpoint.time);
      expect(run.events[checkpoint.eventOffset]?.time).not.toBe(checkpoint.time);
    });
    manifest.segments.forEach((segment, i) => {
      expect(segment.eventStart).toBe(manifest.checkpoints[i].eventOffset);
      expect(segment.eventEnd).toBe(manifest.checkpoints[i + 1]?.eventOffset ?? manifest.coveredEvents);
    });
    reads = 0;
    const late = frameAt(project, run, 2_400);
    expect(reads).toBeLessThan(REPLAY_LIMITS.targetEventsPerCheckpoint + 32);
    reads = 0; expect(frameAt(project, run, 2_400)).toEqual(late); expect(reads).toBeLessThan(32);
    expect(late.actors).toHaveLength(500); expect(late.inSystem).toBe(600);
    expect(new Set(late.actors.map(actor => actor.nodeId)).size).toBe(30);
    expect(late.actors.slice(0, 30).every(actor => actor.id.endsWith(':0'))).toBe(true);
    const forward = [0, 1, 18, 800.5, 1_500, 2_501];
    const boundaries = manifest.checkpoints.flatMap(checkpoint => [checkpoint.time - 0.001, checkpoint.time, checkpoint.time + 0.001]);
    // Fixed coprime permutation gives reproducible arbitrary seek order.
    const arbitrary = Array.from({ length: 20 }, (_, i) => (i * 977 % 2_500) + 0.25);
    const order = [...forward, ...[...forward].reverse(), ...arbitrary, ...boundaries, 2_400, 42, 2_499.5, 42, 2_400, 2_400];
    for (const time of order) expect(frameAt(project, run, time)).toEqual(fromStart(project, run, time));
    const expected = frameAt(project, run, 2_000);
    project.name = 'Renamed'; project.model.name = 'Draft name'; project.layout = { q0: { x: 99, z: -99 } };
    expect(frameAt(project, run, 2_000)).toEqual(expected); expect(replayManifest(run)).toBe(manifest);
    // The input calculation, full trace and numerical results are untouched.
    expect(JSON.stringify(run)).toBe(before);
  });

  it('does not allow returned frames or metadata to poison cached checkpoints or cursor', () => {
    const project = dense(); const run = denseRun(project); const expected = fromStart(project, run, 1_500);
    const frame = frameAt(project, run, 1_500); const manifest = replayManifest(run);
    frame.actors[0].nodeId = 'poison'; frame.actors[0].priority = 999; frame.actors.reverse(); frame.queues.q0 = 999; frame.busy.s0 = 999;
    expect(Object.isFrozen(manifest)).toBe(true); expect(Object.isFrozen(manifest.coverage[0])).toBe(true);
    expect(Object.isFrozen(manifest.checkpoints[1])).toBe(true); expect(Object.isFrozen(manifest.segments[0])).toBe(true);
    expect(Object.isFrozen(manifest.accounting)).toBe(true); expect(Object.isFrozen(manifest.limits)).toBe(true);
    expect(() => { (manifest.coverage[0] as { end: number }).end = 99; }).toThrow(TypeError);
    expect(frameAt(project, run, 1_500)).toEqual(expected);
    frameAt(project, run, 0); expect(frameAt(project, run, 1_500)).toEqual(expected);
  });

  it('keeps only safe complete timestamps after real trace truncation and preserves complete numerical metrics', () => {
    const project = scheduled(); const full = simulate(project.model);
    const cases = Array.from({ length: full.events.length }, (_, cap) => simulate(project.model, { maxTraceEvents: cap }));
    expect(cases.some(run => run.events.some(event => event.time > run.trace.until))).toBe(true);
    for (const run of cases) {
      expect(run.status).toBe('completed'); expect(run.summary).toEqual(full.summary);
      const manifest = replayManifest(run);
      expect(manifest.coverage).toEqual(run.trace.until === 0 ? [] : [{ start: 0, end: run.trace.until }]);
      expect(manifest.coveredEvents).toBe(run.trace.until === 0 ? 0 : run.events.filter(event => event.time <= run.trace.until).length);
      for (const time of [0, 1, 4, 7, 12, 100]) expect(frameAt(project, run, time)).toEqual(fromStart(project, run, time));
      for (const checkpoint of manifest.checkpoints) expect(checkpoint.time).toBeLessThanOrEqual(run.trace.until);
    }
  });

  it('handles actual limited and cancelled partial runs without claiming the unsafe tail', () => {
    const project = scheduled(); let ticks = 0;
    const limited = simulate(project.model, { maxEvents: 30 });
    const cancelled = simulate(project.model, { shouldCancel: () => ++ticks > 30 });
    expect(limited.status).toBe('limited'); expect(cancelled.status).toBe('cancelled');
    for (const run of [limited, cancelled]) {
      expect(run.trace.complete).toBe(false); expect(run.trace.until).toBeGreaterThan(0);
      expect(run.events.some(event => event.time > run.trace.until)).toBe(true);
      expect(replayManifest(run).coverage).toEqual([{ start: 0, end: run.trace.until }]);
      for (const time of [0, 1, 3, 5, 12, 3, 0]) expect(frameAt(project, run, time)).toEqual(fromStart(project, run, time));
      expect(frameAt(project, run, 12).aggregated).toBe(true);
    }
  });

  it('has no seekable interval for zero trace and preserves nonfinite/negative-time behavior', () => {
    const project = scheduled(); const run = simulate(project.model);
    const disabled = simulate(project.model, { maxTraceEvents: 0 });
    const interrupted = simulate(project.model, { maxEvents: 2 });
    for (const empty of [disabled, interrupted]) {
      expect(empty.trace.until).toBe(0); expect(replayManifest(empty).coverage).toEqual([]);
      expect(replayManifest(empty).checkpoints).toEqual([]); expect(replayManifest(empty).segments).toEqual([]);
      expect(frameAt(project, empty, 10)).toMatchObject({ time: 0, arrivals: 0, inSystem: 0, actors: [], aggregated: false });
    }
    for (const time of [-1, -Infinity, Infinity, NaN]) expect(frameAt(project, run, time)).toEqual(frameAt(project, run, 0));
    expect(frameAt(project, run, 100)).toEqual(frameAt(project, run, 12));
    expect(frameAt(project, null, 100)).toMatchObject({ time: 12, actors: [], arrivals: 0 });
    const source = project.model.nodes[0] as SourceNode; source.arrival = { kind: 'schedule', times: [] };
    const noArrivals = simulate(project.model);
    expect(noArrivals.trace.complete).toBe(true); expect(replayManifest(noArrivals).coverage).toEqual([{ start: 0, end: 12 }]);
    expect(frameAt(project, noArrivals, 12).inSystem).toBe(0);
  });

  it('keys caches by result object identity even when RunID is shared, and invalidates replaced evidence cheaply', () => {
    const project = scheduled(); const full = simulate(project.model);
    const capped = simulate(project.model, { maxTraceEvents: 8 }); const limited = simulate(project.model, { maxEvents: 30 });
    expect(full.id).toBe(capped.id); expect(full.id).toBe(limited.id);
    expect(replayManifest(full)).not.toBe(replayManifest(capped)); expect(replayManifest(full)).not.toBe(replayManifest(limited));
    for (const run of [full, capped, limited, full, capped]) expect(frameAt(project, run, 12)).toEqual(fromStart(project, run, 12));
    const previous = replayManifest(full);
    full.events = capped.events; full.entities = capped.entities; full.trace = { ...capped.trace };
    expect(replayManifest(full)).not.toBe(previous); expect(frameAt(project, full, 12)).toEqual(fromStart(project, capped, 12));
  });

  it.each(['records', 'estimated bytes'] as const)('bounds checkpoint %s independently of the raw trace, cursor and priority lookup', bound => {
    const project = scheduled(); const longId = bound === 'records' ? 'hold' : 's'.repeat(64); const delayId = bound === 'records' ? 'd' : 'd'.repeat(64);
    const source = project.model.nodes[0] as SourceNode;
    project.model.horizon = 40_001;
    project.model.nodes = [
      { ...source, id: longId, samplingId: longId, next: delayId, arrival: { kind: 'schedule', times: Array.from({ length: 3_000 }, (_, i) => i) } },
      { id: delayId, samplingId: delayId, label: 'Long delay', kind: 'delay', next: 'out', duration: { kind: 'constant', value: 100_000 } },
      { ...source, id: 'pulse', samplingId: 'pulse', next: 'out', arrival: { kind: 'schedule', times: Array.from({ length: 40_000 }, (_, i) => i + 0.5) } },
      { id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' },
    ];
    const run = simulate(project.model, { maxTraceEntities: 50_000 }); expect(run.trace.complete).toBe(true);
    const manifest = replayManifest(run); const accounting = manifest.accounting;
    expect(manifest.checkpoints.length).toBeGreaterThan(2); expect(manifest.checkpoints.length).toBeLessThan(REPLAY_LIMITS.maxCheckpoints);
    expect(accounting.checkpointActorRecords).toBeLessThanOrEqual(REPLAY_LIMITS.maxCheckpointActorRecords);
    expect(accounting.checkpointEstimatedBytes).toBeLessThanOrEqual(REPLAY_LIMITS.maxCheckpointEstimatedBytes);
    if (bound === 'records') expect(accounting.checkpointActorRecords + accounting.peakActiveActors).toBeGreaterThan(REPLAY_LIMITS.maxCheckpointActorRecords);
    else expect(accounting.checkpointEstimatedBytes + accounting.peakActiveEstimatedBytes).toBeGreaterThan(REPLAY_LIMITS.maxCheckpointEstimatedBytes);
    expect(accounting.peakActiveActors).toBe(3_001); expect(accounting.cursorActorLimit).toBe(50_000);
    expect(accounting.priorityRecords).toBe(43_000); expect(accounting.priorityEstimatedBytes).toBeGreaterThan(0);
    expect(frameAt(project, run, 40_001)).toMatchObject({ arrivals: 43_000, completed: 40_000, inSystem: 3_000 });
    expect(frameAt(project, run, 2_000).inSystem).toBe(2_001);
  }, 15_000);

  it('caps the number of checkpoints for a long low-WIP actual trace', () => {
    const project = scheduled(); const source = project.model.nodes[0] as SourceNode;
    project.model.horizon = 40_001;
    project.model.nodes = [{ ...source, next: 'out', arrival: { kind: 'schedule', times: Array.from({ length: 40_000 }, (_, i) => i) } }, { id: 'out', samplingId: 'out', label: 'Exit', kind: 'sink' }];
    const run = simulate(project.model, { maxTraceEntities: 50_000 }); const manifest = replayManifest(run);
    expect(manifest.checkpoints.length).toBeGreaterThan(20); expect(manifest.checkpoints.length).toBeLessThanOrEqual(REPLAY_LIMITS.maxCheckpoints);
    expect(manifest.coveredEvents).toBe(80_000); expect(frameAt(project, run, 39_000).completed).toBe(39_001);
  }, 15_000);

  it('measures indexed playback of 500 represented actors without a native-input or GPU claim', () => {
    const project = dense(); const run = denseRun(project);
    const started = performance.now(); const manifest = replayManifest(run); const buildMs = performance.now() - started;
    for (let i = 0; i < 30; i++) frameAt(project, run, i * 80);
    const measure = (times: number[]) => {
      const samples: number[] = [];
      for (const time of times) {
        const start = performance.now(); const frame = frameAt(project, run, time); samples.push(performance.now() - start);
        expect(frame.actors).toHaveLength(500); expect(frame.inSystem).toBe(600);
      }
      samples.sort((a, b) => a - b);
      return { frames: samples.length, p50Ms: samples[Math.floor(samples.length * 0.5)], p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1) };
    };
    const forward = measure(Array.from({ length: 600 }, (_, i) => i * 2_500 / 600));
    const arbitrary = measure(Array.from({ length: 120 }, (_, i) => (i * 977 % 2_500) + 0.25));
    console.info('R25 Node presentation-only milliseconds:', JSON.stringify({ events: run.events.length, actors: 500, active: 600, buildMs, forward, arbitrary, checkpoints: manifest.checkpoints.length, accounting: manifest.accounting }));
  }, 15_000);
});
