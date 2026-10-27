import { describe, expect, it } from 'vitest';
import { PeopleMotion, type PersonTarget } from '../src/scene/peopleMotion';
import { operatorTargets } from '../src/scene/operatorLayout';
import { createExample } from '../src/examples';
import type { WorldFrame } from '../src/playback';

const visitor = (id = 'visitor-a', x = 10): PersonTarget => ({
  id, variant: 0, nodeId: 'queue-a', role: 'visitor', heading: 0,
  position: { x, y: 0, z: 0 }, spawn: { x: 0, y: 0, z: 0 },
});
const options = (now: number, animate = true, reset = false) => ({
  now, animate, reset, speed: 4, retire: () => null,
});

describe('visual people movement, separate from simulation', () => {
  it('walks from the source at a bounded speed and keeps identity when actor order changes', () => {
    const motion = new PeopleMotion(), a = visitor(), b = visitor('visitor-b', 8);
    Object.freeze(a.position); Object.freeze(a.spawn); Object.freeze(a);
    motion.step([a, b], options(0));
    const frame = motion.step([b, a], options(50));
    const drawn = frame.people.find(person => person.id === a.id)!;
    expect(drawn.position.x).toBeCloseTo(.2);
    expect(drawn.distance).toBeCloseTo(.2);
    expect(drawn.heading).toBeCloseTo(Math.PI / 2);
    expect(frame.moving).toBe(true);
    expect(a.position.x).toBe(10);
  });

  it('freezes position and stride on pause and avoids a jump after a long inactive interval', () => {
    const motion = new PeopleMotion(), target = visitor();
    motion.step([target], options(0));
    const moving = motion.step([target], options(50)).people[0];
    const paused = motion.step([target], options(100_000, false)).people[0];
    expect(paused.position).toEqual(moving.position);
    expect(paused.distance).toBe(moving.distance);
    const resumed = motion.step([target], options(200_000)).people[0];
    expect(resumed.position.x - paused.position.x).toBeCloseTo(.2);
  });

  it('an explicit seek replaces old locations and removes departing visitors immediately', () => {
    const motion = new PeopleMotion();
    motion.step([visitor('old')], options(0));
    const sought = motion.step([visitor('new', 25)], options(50, false, true));
    expect(sought.people.map(person => person.id)).toEqual(['new']);
    expect(sought.people[0].position.x).toBe(25);
    expect(sought.people[0].distance).toBe(0);
    expect(sought.moving).toBe(false);
  });

  it('walks departing visitors to their exit and does not expire them while paused', () => {
    const motion = new PeopleMotion(), target = visitor('departing', 0);
    motion.step([target], options(0, false, true));
    const exit = { ...target, nodeId: 'exit', position: { x: 2, y: 0, z: 0 } };
    const departing = { ...options(50), retire: () => exit };
    expect(motion.step([], departing).people[0].position.x).toBeCloseTo(.2);
    const paused = motion.step([], { ...departing, now: 10_000, animate: false });
    expect(paused.people).toHaveLength(1);
    for (let now = 10_050; now <= 10_600; now += 50) motion.step([], { ...departing, now });
    expect(motion.step([], { ...departing, now: 10_650 }).people).toHaveLength(0);
  });

  it('copies work phases to a stationary worker, freezes them on pause and clears finished activity', () => {
    const motion = new PeopleMotion();
    const worker: PersonTarget = { ...visitor('worker', 0), role: 'operator', activity: 'work', activityPhase: .1 };
    const first = motion.step([worker], options(0, true, true));
    expect(first.moving).toBe(false);
    expect(first.working).toBe(true);
    const working = motion.step([{ ...worker, activityPhase: .6 }], options(50)).people[0];
    expect(working.activityPhase).toBe(.6);
    const paused = motion.step([{ ...worker, activityPhase: .6 }], options(50_000, false));
    expect(paused.people[0]).toEqual(working);
    const finished = motion.step([{ ...worker, activity: undefined, activityPhase: undefined }], options(50_050));
    expect(finished.people[0].activity).toBeUndefined();
    expect(finished.people[0].activityPhase).toBeUndefined();
    expect(finished.working).toBe(false);
    expect(worker.activityPhase).toBe(.1);
  });
});

describe('shared resource staff illustrations', () => {
  it('keeps shared specialist identities unique as demand moves between services', () => {
    const project = createExample('service'), previous = new Map<string, string>();
    const frame: WorldFrame = { time: 100, actors: [], queues: {}, busy: { 'station-b': 2 }, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
    const original = JSON.stringify(project);
    const first = operatorTargets(project, frame, project.layout, previous);
    expect(first.filter(person => person.id.startsWith('operator:specialists:'))).toHaveLength(2);
    const next = operatorTargets(project, { ...frame, busy: { 'station-c': 2 } }, project.layout, previous);
    expect(next.map(person => person.id)).toEqual(first.map(person => person.id));
    expect(next.filter(person => person.id.startsWith('operator:specialists:')).every(person => person.nodeId === 'station-c')).toBe(true);
    expect(new Set(next.map(person => person.id)).size).toBe(next.length);
    expect(JSON.stringify(project)).toBe(original);
    const reduced = operatorTargets(project, { ...frame, time: 1900, busy: {} }, project.layout, previous);
    expect(reduced.filter(person => person.id.startsWith('operator:specialists:'))).toHaveLength(1);
  });

  it('cycles busy factory units within their assigned cell while idle units remain stationary', () => {
    const project = createExample('factory'), previous = new Map<string, string>();
    project.model.resources.find(pool => pool.id === 'team-a')!.capacity = 2;
    const frame: WorldFrame = { time: 100, actors: [], queues: {}, busy: { 'station-a': 1 }, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
    const original = JSON.stringify({ project, frame });
    Object.freeze(frame.busy); Object.freeze(frame);
    Object.values(project.layout).forEach(Object.freeze);
    const baseline = operatorTargets(project, frame, project.layout, previous);
    const frames = Array.from({ length: 101 }, (_, index) => operatorTargets(project, frame, project.layout, previous, { seconds: index / 5 }));
    const busy = frames[0].filter(person => person.activity === 'work');
    expect(busy).toHaveLength(1);
    const busyId = busy[0].id, origin = baseline.find(person => person.id === busyId)!;
    const samples = frames.map(people => people.find(person => person.id === busyId)!);
    expect(new Set(samples.map(person => person.nodeId))).toEqual(new Set(['station-a']));
    expect(new Set(samples.map(person => person.activityPhase)).size).toBeGreaterThan(20);
    expect(samples.every(person => person.activityPhase! >= 0 && person.activityPhase! < 1)).toBe(true);
    const travel = samples.map(person => Math.hypot(person.position.x - origin.position.x, person.position.z - origin.position.z));
    expect(Math.max(...travel)).toBeGreaterThan(1.7);
    expect(Math.max(...travel)).toBeLessThan(1.82);
    expect(Math.min(...travel)).toBe(0);
    expect(samples.every(person => person.position.z >= origin.position.z)).toBe(true);
    for (const people of frames) {
      expect(new Set(people.map(person => person.id)).size).toBe(people.length);
      for (const idle of people.filter(person => person.id !== busyId)) {
        expect(idle.position).toEqual(baseline.find(person => person.id === idle.id)!.position);
        expect(idle.activity).toBeUndefined();
      }
    }
    expect(operatorTargets(project, frame, project.layout, previous, { seconds: 12.5, active: false })).toEqual(baseline);
    expect(JSON.stringify({ project, frame })).toBe(original);
  });

  it('keeps the same factory work target and pose phase when the visual clock is paused', () => {
    const project = createExample('factory'), previous = new Map<string, string>();
    const frame: WorldFrame = { time: 100, actors: [], queues: {}, busy: { 'station-a': 1 }, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
    const activity = { seconds: 7.25 };
    const first = operatorTargets(project, frame, project.layout, previous, activity);
    expect(first.some(person => person.activity === 'work')).toBe(true);
    expect(operatorTargets(project, frame, project.layout, previous, activity)).toEqual(first);
    const service = createExample('service');
    expect(operatorTargets(service, frame, service.layout, new Map(), { seconds: 10 })).toEqual(operatorTargets(service, frame, service.layout, new Map()));
  });

  it('uses distance-driven walking during short per-frame pickup steps, then reaches a stationary work pose', () => {
    const project = createExample('factory'), previous = new Map<string, string>(), motion = new PeopleMotion();
    const frame: WorldFrame = { time: 100, actors: [], queues: {}, busy: { 'station-a': 1 }, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
    let walked = 0, stationaryWork = 0, finalDistance = 0;
    for (let index = 0; index <= 660; index++) {
      const seconds = index / 60, targets = operatorTargets(project, frame, project.layout, previous, { seconds });
      const result = motion.step(targets, options(seconds * 1000, true, index === 0));
      const worker = result.people.find(person => person.activity === 'work')!;
      if (worker.moving) walked++; else stationaryWork++;
      finalDistance = worker.distance;
    }
    expect(walked).toBeGreaterThan(150);
    expect(stationaryWork).toBeGreaterThan(150);
    expect(finalDistance).toBeGreaterThan(3.5);
  });
});

describe('example staff identity', () => {
  it('keeps staff visible after a purely cosmetic pool-label rename', () => {
    const project = createExample('factory'), assignments = new Map<string, string>();
    const frame: WorldFrame = { time: 10, actors: [], queues: {}, busy: {}, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
    const before = operatorTargets(project, frame, project.layout, assignments).map(person => person.id);
    project.model.resources.forEach((pool, index) => { pool.label = `Ekip ${index + 1}`; });
    expect(operatorTargets(project, frame, project.layout, assignments).map(person => person.id)).toEqual(before);
  });
});
