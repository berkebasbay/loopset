import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { beginMoveGesture } from '../src/features/layoutCommands';
import { modelHash } from '../src/model/identity';
import { connectionFraming, connectionShape, connectionShapes, flowTopology, ribbonPositions, sharedPositionLinks } from '../src/scene/flowPresentation';
import { placeLabel } from '../src/scene/WorldScene';
import { sceneLayout } from '../src/scene/graph';

describe('finite directional connections and deliberate framing', () => {
  it.each([[0, 0, 0, 0], [2, -3, 2.001, -3.001], [-100, -100, 100, 100], [5, 0, -5, 0], [0, -8, 0, 9]])('keeps curve, ribbon and nondegenerate arrow finite for %j', (x, z, bx, bz) => {
    const a = { x, z }, b = { x: bx, z: bz }, shape = connectionShape(a, b), positions = ribbonPositions(shape.points, .17);
    expect([...shape.points, ...shape.arrow].every(p => [p.x, p.y, p.z].every(Number.isFinite))).toBe(true);
    expect(positions.every(Number.isFinite)).toBe(true); expect(positions.length).toBeGreaterThan(0); expect(positions.length % 9).toBe(0);
    expect(shape).toEqual(connectionShape(a, b));
    expect(shape.points[0].x).toBeCloseTo(a.x); expect(shape.points[0].z).toBeCloseTo(a.z);
    expect(shape.points.at(-1)!.x).toBeCloseTo(b.x); expect(shape.points.at(-1)!.z).toBeCloseTo(b.z);
    const [tip, left, right] = shape.arrow;
    expect(Math.abs((left.x - tip.x) * (right.z - tip.z) - (right.x - tip.x) * (left.z - tip.z))).toBeGreaterThan(1e-8);
    if (!shape.coincident) {
      const tail = { x: (left.x + right.x) / 2, z: (left.z + right.z) / 2 };
      expect((tip.x - tail.x) * (b.x - a.x) + (tip.z - tail.z) * (b.z - a.z)).toBeGreaterThan(0);
    }
  });
  it('renders a bounded raised return at the unchanged shared position, even with many lanes', () => {
    const a = { x: 7, z: -4 };
    for (let lane = 0; lane < 40; lane++) {
      const shape = connectionShape(a, a, lane);
      expect(shape.coincident).toBe(true); expect(shape.points).toHaveLength(33);
      expect(Math.max(...shape.points.map(p => p.z)) - a.z).toBeGreaterThan(2);
      expect(Math.max(...shape.points.map(p => p.z)) - a.z).toBeLessThanOrEqual(3.2);
      expect(Math.max(...shape.points.map(p => p.y))).toBeLessThan(4.1);
    }
    expect(a).toEqual({ x: 7, z: -4 });
  });
  it('assigns deterministic bounded lanes to repeated and opposite legal-ID edges', () => {
    const project = createExample('factory');
    const topology = flowTopology([
      { id: 'toString', samplingId: 'toString', label: 'A', kind: 'route', branches: [{ to: 'valueOf', probability: .4 }, { to: 'valueOf', probability: .6 }] },
      { id: 'valueOf', samplingId: 'valueOf', label: 'B', kind: 'delay', next: 'toString', duration: { kind: 'constant', value: 1 } },
    ]);
    project.model.nodes = [...topology.nodes.values()]; project.layout = Object.fromEntries(project.model.nodes.map(node => [node.id, { x: 0, z: 0 }]));
    const layout = sceneLayout(project), exact = structuredClone(layout), first = connectionShapes(topology, layout), second = connectionShapes(topology, layout);
    expect(first).toEqual(second); expect(first.size).toBe(3); expect(new Set([...first.values()].map(shape => shape.points[8].z)).size).toBe(3);
    expect(layout).toEqual(exact); expect(Object.hasOwn(layout, 'toString')).toBe(true); expect(Object.hasOwn(layout, 'valueOf')).toBe(true);
  });
  it('keeps a real self-loop distinct from a connection between colocated steps', () => {
    const topology = flowTopology([
      { id: 'loop', samplingId: 'loop', label: 'Loop', kind: 'delay', next: 'loop', duration: { kind: 'constant', value: 1 } },
      { id: 'other', samplingId: 'other', label: 'Other', kind: 'delay', next: 'loop', duration: { kind: 'constant', value: 1 } },
    ]);
    const layout = { loop: { x: 0, z: 0 }, other: { x: 0, z: 0 } };
    expect(sharedPositionLinks(topology, layout).map(link => [link.from, link.to])).toEqual([['other', 'loop']]);
    expect(topology.links.map(link => [link.from, link.to])).toEqual([['loop', 'loop'], ['other', 'loop']]);
    expect([...connectionShapes(topology, layout).values()].every(shape => shape.coincident)).toBe(true);
  });
  it.each([{ width: 348, height: 360, safeTop: 54, safeBottom: 138 }, { width: 965, height: 324, safeTop: 54, safeBottom: 138 }, { width: 680, height: 250, safeTop: 54, safeBottom: 138 }])('fits off-screen endpoints and full shared curve above paper at $width × $height', viewport => {
    for (const [a, b] of [[{ x: -100, z: -100 }, { x: 100, z: 100 }], [{ x: 90, z: -90 }, { x: 90, z: -90 }]]) {
      const shape = connectionShape(a, b, 7);
      // An independent orthographic view-plane transform; include equipment extents.
      const points = [...shape.points, ...[a, b].flatMap(p => [-1.7, 1.7].flatMap(x => [-1.7, 1.7].flatMap(z => [0, 3.8].map(y => ({ x: p.x + x, y, z: p.z + z })))))]
        .map(p => ({ x: p.x * .8 - p.z * .6, y: p.y * .8 - p.x * .36 - p.z * .48 }));
      const framing = connectionFraming(points, viewport)!;
      expect(framing.zoom).toBe(1); expect(Object.values(framing).every(Number.isFinite)).toBe(true);
      for (const point of points) {
        const px = (point.x - framing.left) / (framing.right - framing.left) * viewport.width;
        const py = (framing.top - point.y) / (framing.top - framing.bottom) * viewport.height;
        expect(px).toBeGreaterThan(0); expect(px).toBeLessThan(viewport.width);
        expect(py).toBeGreaterThan(viewport.safeTop); expect(py).toBeLessThan(viewport.safeBottom);
      }
    }
  });
  it('declines empty/invalid framing rather than emitting NaN', () => {
    expect(connectionFraming([], { width: 348, height: 360, safeTop: 54, safeBottom: 138 })).toBeNull();
    expect(connectionFraming([{ x: NaN, y: 0 }], { width: 348, height: 360, safeTop: 54, safeBottom: 138 })).toBeNull();
    expect(connectionFraming([{ x: 0, y: 0 }], { width: 0, height: 360, safeTop: 54, safeBottom: 138 })).toBeNull();
  });
  it('keeps two current callouts disjoint above a mobile paper, with bounded long-label rectangles', () => {
    const viewport = { width: 348, height: 198 }, occupied: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const placed = placeLabel({ x: 140, y: 47, width: 240, height: 32 }, viewport, occupied, [])!;
      expect(placed).not.toBeNull(); expect(placed.x).toBeGreaterThanOrEqual(10); expect(placed.x + placed.width).toBeLessThanOrEqual(338);
      expect(placed.y + placed.height).toBeLessThanOrEqual(142);
      for (const other of occupied) expect(placed.y >= other.y + other.height + 8 || other.y >= placed.y + placed.height + 8).toBe(true);
      occupied.push(placed);
    }
  });
  it('does not convert a cancelled shared-position move preview into model or layout edits', () => {
    const project = createExample('factory'); project.layout['queue-a'] = { ...project.layout['station-a'] };
    const exact = structuredClone(project), hash = modelHash(project.model), gesture = beginMoveGesture(project, ['queue-a', 'station-a'], 'station-a');
    gesture.preview({ x: 1, z: 1 }); gesture.cancel();
    const shapes = connectionShapes(flowTopology(project.model.nodes), sceneLayout(project));
    expect([...shapes.values()].some(shape => shape.coincident)).toBe(true); expect(gesture.finish()).toBeNull(); expect(project).toEqual(exact); expect(modelHash(project.model)).toBe(hash);
  });
});
