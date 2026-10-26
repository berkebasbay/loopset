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
});
