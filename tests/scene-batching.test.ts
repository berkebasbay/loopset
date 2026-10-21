import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { batchStaticMeshes } from '../src/scene/batchStaticMeshes';

function vertices(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const rows: string[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry, material = object.material as THREE.Material;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    for (let i = 0; i < (geometry.index?.count ?? geometry.attributes.position.count); i++) {
      const index = geometry.index?.getX(i) ?? i;
      const position = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(object.matrixWorld);
      const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, index).applyNormalMatrix(normalMatrix);
      rows.push(JSON.stringify([material.uuid, object.castShadow, object.receiveShadow,
        ...position.toArray().map(value => +value.toFixed(4)), ...normal.toArray().map(value => +value.toFixed(4)),
        geometry.attributes.uv.getX(index), geometry.attributes.uv.getY(index)]));
    }
  });
  return rows.sort();
}

describe('stationary node artwork batching', () => {
  it('preserves transformed triangles, normals, UVs, material and shadow flags', () => {
    const root = new THREE.Group(), child = new THREE.Group();
    root.position.set(7, -2, 4); root.scale.setScalar(1.12); root.rotation.y = .38;
    child.position.set(.8, .3, -2); child.scale.set(1.3, .7, 1.9); child.rotation.set(.2, .4, .7); root.add(child);
    const material = new THREE.MeshStandardMaterial();
    const box = new THREE.Mesh(new THREE.BoxGeometry(.7, .4, .2), material);
    box.position.set(.2, .3, 1); box.rotation.set(.1, .2, .3); box.castShadow = true; root.add(box);
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .7, 6), material);
    cylinder.position.set(-.4, .7, .2); cylinder.castShadow = true; child.add(cylinder);
    const before = vertices(root), owned: THREE.BufferGeometry[] = [];
    batchStaticMeshes(root, new Set(), geometry => { owned.push(geometry); return geometry; });
    expect(vertices(root)).toEqual(before);
    expect(owned).toHaveLength(1);
    let disposed = 0; owned[0].addEventListener('dispose', () => disposed++);
    owned[0].dispose(); expect(disposed).toBe(1);
    expect(box.geometry.attributes.position.count).toBe(24); // The shared source buffer is untouched.
  });

  it('retains nearest semantic ray hits after moving a batched node', () => {
    const scene = new THREE.Group(), material = new THREE.MeshStandardMaterial();
    for (const [id, x] of [['a', -1], ['b', 1]] as const) {
      const node = new THREE.Group(); node.userData.nodeId = id; node.position.x = x; scene.add(node);
      for (const y of [0, .7]) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, .6, 1), material); mesh.position.y = y; node.add(mesh); }
    }
    const original = scene.clone(true);
    for (const node of scene.children) batchStaticMeshes(node as THREE.Group, new Set(), geometry => geometry);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(2, 3, 8); camera.lookAt(0, .4, 0); camera.updateMatrixWorld(true);
    const hits = (root: THREE.Object3D) => {
      root.updateMatrixWorld(true);
      const caster = new THREE.Raycaster(), values: { id: string | null; distance: number | null }[] = [];
      for (let y = -.8; y <= .8; y += .08) for (let x = -.8; x <= .8; x += .08) {
        caster.setFromCamera(new THREE.Vector2(x, y), camera);
        const hit = caster.intersectObject(root, true)[0];
        let node: THREE.Object3D | undefined = hit?.object; while (node && !node.userData.nodeId) node = node.parent ?? undefined;
        values.push({ id: node?.userData.nodeId ?? null, distance: hit?.distance ?? null });
      }
      return values;
    };
    for (const offset of [0, .43]) {
      original.children[0].position.z = offset; scene.children[0].position.z = offset;
      const before = hits(original), after = hits(scene);
      expect(after.map(hit => hit.id)).toEqual(before.map(hit => hit.id));
      expect(before.some(hit => hit.id === 'a') && before.some(hit => hit.id === 'b')).toBe(true);
      after.forEach((hit, i) => { if (hit.distance !== null) expect(hit.distance).toBeCloseTo(before[i].distance!, 6); });
    }
  });

  it('leaves animated descendants, transparent, mirrored, partial-range and parent meshes intact', () => {
    const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
    const make = () => new THREE.Mesh(new THREE.BoxGeometry(), material);
    const moving = new THREE.Group(), child = make(); moving.add(child); root.add(moving);
    const mirrored = make(); mirrored.scale.x = -1; root.add(mirrored);
    const partial = make(); partial.geometry.setDrawRange(6, 12); root.add(partial);
    const transparent = make(); transparent.material = new THREE.MeshStandardMaterial({ transparent: true, opacity: .5 }); root.add(transparent);
    const parent = make(); parent.add(make()); root.add(parent);
    const differentShadow = make(); differentShadow.castShadow = true; root.add(differentShadow);
    const one = make(), two = make(); root.add(one, two);
    batchStaticMeshes(root, new Set([moving]), geometry => geometry);
    for (const object of [moving, child, mirrored, partial, transparent, parent, differentShadow]) expect(object.parent).not.toBeNull();
    expect(child.parent).toBe(moving); expect(partial.geometry.drawRange).toEqual({ start: 6, count: 12 });
    expect(one.parent).toBeNull(); expect(two.parent).toBeNull();
  });
});
