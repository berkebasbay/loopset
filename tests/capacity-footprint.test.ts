import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { capacityCell, capacityLayout, stationCopies } from '../src/scene/capacityFootprint';
import * as THREE from 'three';
import { visiblePickPoint } from '../src/scene/WorldScene';
import { operatorTargets } from '../src/scene/operatorLayout';

describe('capacity presentation footprint', () => {
  it('adds all 1000 distinct stable cells instead of clamping the picture at three', () => {
    const cells = Array.from({ length: 1000 }, (_, i) => capacityCell(i));
    expect(new Set(cells.map(p => `${p.x},${p.z}`)).size).toBe(1000);
    expect(cells[0]).toEqual({ x: 0, z: 0 });
    const p = createExample('factory'), service = p.model.nodes.find(n => n.kind === 'service')!;
    if (service.kind !== 'service') throw new Error();
    for (const count of [1, 2, 3, 12, 16, 100, 1000]) { service.servers = count; expect(stationCopies(service)).toBe(count); }
  });

  it('preserves baseline coordinates and provides an exact inverse when capacity expands the scene', () => {
    const p = createExample('factory'), before = JSON.stringify(p);
    expect(capacityLayout(p.model.nodes, p.layout).positions).toEqual(p.layout);
    const service = p.model.nodes.find(n => n.id === 'station-a')!;
    if (service.kind !== 'service') throw new Error();
    service.servers = 1000;
    const modelBefore = JSON.stringify(p), view = capacityLayout(p.model.nodes, p.layout);
    expect(view.extent.width).toBeGreaterThan(100); expect(view.extent.depth).toBeGreaterThan(100);
    for (const point of [...Object.values(p.layout), { x: -.34, z: 1.25 }, { x: 70, z: -80 }]) {
      const restored = view.toModel(view.toVisual(point));
      expect(restored.x).toBeCloseTo(point.x, 10); expect(restored.z).toBeCloseTo(point.z, 10);
    }
    expect(JSON.stringify(p)).toBe(modelBefore); expect(modelBefore).not.toBe(before);
  });

  it('shows each normal staff unit up to 32, using the matching capacity cells', () => {
    for (const count of [13, 16, 32, 1000]) {
      const p = createExample('factory'), node = p.model.nodes.find(n => n.id === 'station-a')!, pool = p.model.resources.find(r => r.id === 'team-a')!;
      if (node.kind !== 'service') throw new Error();
      node.servers = count; pool.capacity = count; pool.installedCapacity = count;
      const frame = { time: 1, actors: [], queues: {}, busy: { 'station-a': count }, arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
      const before = JSON.stringify({ p, frame });
      const people = operatorTargets(p, frame, p.layout, new Map()).filter(person => person.id.startsWith('operator:team-a:'));
      expect(people).toHaveLength(Math.min(32, count));
      people.forEach((person, i) => {
        expect(person.position.x).toBeCloseTo(p.layout[node.id].x + capacityCell(i).x + .9);
        expect(person.position.z).toBeCloseTo(p.layout[node.id].z + capacityCell(i).z + 1.5);
      });
      expect(JSON.stringify({ p, frame })).toBe(before);
    }
  });

  it('finds the exposed equipment edge when another station occludes its proxy center', () => {
    const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
    const target = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), material); target.position.y = 1; target.name = 'target'; scene.add(target);
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 1), material); occluder.position.set(0, .85, 1); occluder.name = 'occluder'; scene.add(occluder);
    const camera = new THREE.OrthographicCamera(-2, 2, 3, -1, .1, 100); camera.position.set(0, 1, 8); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    const caster = new THREE.Raycaster();
    const hit = (x: number, y: number) => { caster.setFromCamera(new THREE.Vector2(x / 400 * 2 - 1, -y / 400 * 2 + 1), camera); return caster.intersectObjects(scene.children)[0]?.object.name; };
    const center = target.getWorldPosition(new THREE.Vector3()).project(camera);
    expect(hit((center.x * .5 + .5) * 400, (-center.y * .5 + .5) * 400)).toBe('occluder');
    const point = visiblePickPoint(new THREE.Box3().setFromObject(target), camera, { width: 400, height: 400 }, (x, y) => hit(x, y) === 'target');
    expect(point).not.toBeNull(); expect(hit(point!.x, point!.y)).toBe('target');
    expect(visiblePickPoint(new THREE.Box3().setFromObject(target), camera, { width: 400, height: 400 }, () => false)).toBeNull();
  });
});
