import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch stationary opaque artwork within one semantic, movable node. */
export function batchStaticMeshes(group: THREE.Group, dynamic: ReadonlySet<THREE.Object3D>, own: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry) {
  // Reparenting must not change Three's inherited Group render ordering.
  if (group.renderOrder !== 0) return;
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map<string, { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; matrix: THREE.Matrix4 }[]>();
  const visit = (object: THREE.Object3D) => {
    // A moving or hidden parent also excludes its descendants.
    if (dynamic.has(object) || !object.visible || (object instanceof THREE.Group && object.renderOrder !== 0)) return;
    if (object instanceof THREE.Mesh && object.type === 'Mesh' && !object.children.length && object.material instanceof THREE.MeshStandardMaterial && !object.material.transparent) {
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, geometry = mesh.geometry;
      const matrix = inverse.clone().multiply(mesh.matrixWorld);
      // Mirrored artwork needs winding repair; keep its original mesh instead.
      if (matrix.determinant() > 0 && geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity && !Object.keys(geometry.morphAttributes).length && Object.values(geometry.attributes).every(attribute => attribute instanceof THREE.BufferAttribute)) {
        const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).sort();
        const key = JSON.stringify([mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, mesh.layers.mask, Boolean(geometry.index), attributes]);
        const bucket = buckets.get(key) ?? []; bucket.push({ mesh, matrix }); buckets.set(key, bucket);
      }
    }
    object.children.forEach(visit);
  };
  group.children.forEach(visit);
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const copies: THREE.BufferGeometry[] = [];
    try {
      for (const { mesh, matrix } of bucket) copies.push(mesh.geometry.clone().applyMatrix4(matrix));
      const geometry = mergeGeometries(copies);
      if (!geometry) continue;
      const first = bucket[0].mesh, batch = new THREE.Mesh(own(geometry), first.material);
      batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder; batch.layers.mask = first.layers.mask;
      group.add(batch);
      for (const { mesh } of bucket) mesh.removeFromParent();
    } finally { copies.forEach(geometry => geometry.dispose()); }
  }
}
