import * as THREE from 'three';
import type { FacilityObject, Point } from '../model/types';
import { findLibraryAsset, type LibraryAsset } from '../catalog/registry';
import { CatalogStore } from './CatalogStore';

type ObjectView = { object: FacilityObject; group: THREE.Group; proxy?: THREE.Mesh; outline?: THREE.LineSegments; file?: string; key: string };
type Batch = { asset: LibraryAsset; items: Set<string>; meshes: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[]; failed: boolean; dirty: boolean };
type Extent = { minX: number; maxX: number; minZ: number; maxZ: number; width: number; depth: number; x: number; z: number };

/** Source geometry is shared across instances. This layer never edits a model. */
export class FacilityLayer {
  private readonly objects = new Map<string, ObjectView>();
  private readonly batches = new Map<string, Batch>();
  private readonly preview = new Map<string, Point>();
  private readonly resources = new Set<{ dispose(): void }>();
  private disposed = false;
  private revision = 0;
  constructor(private scene: THREE.Scene, private store: CatalogStore, private render: () => void, private error: () => void) {}

  sync(objects: readonly FacilityObject[], selected: string | null) {
    const ids = new Set(objects.map(object => object.id));
    for (const [id, view] of this.objects) if (!ids.has(id)) this.remove(id, view);
    for (const object of objects) {
      let view = this.objects.get(object.id);
      if (view && (view.object.assetId !== object.assetId || view.object.assetVersion !== object.assetVersion)) { this.remove(object.id, view); view = undefined; }
      if (!view) {
        const group = new THREE.Group(); this.scene.add(group);
        view = { group, object, key: '' }; this.objects.set(object.id, view);
        const asset = findLibraryAsset(object.assetId);
        if (!asset || asset.version !== object.assetVersion) { this.error(); continue; }
        view.file = asset.file;
        const [width, height, depth] = asset.dimensions.map(value => Math.max(.05, value));
        const geometry = new THREE.BoxGeometry(width, height, depth), material = new THREE.MeshBasicMaterial({ visible: false });
        const proxy = new THREE.Mesh(geometry, material); proxy.position.y = height / 2; proxy.userData.facilityId = object.id;
        const edges = new THREE.EdgesGeometry(geometry), outlineMaterial = new THREE.LineBasicMaterial({ color: '#bddf84', transparent: true, opacity: .9, depthTest: false });
        const outline = new THREE.LineSegments(edges, outlineMaterial); outline.position.y = height / 2; outline.renderOrder = 3;
        group.add(proxy, outline); view.proxy = proxy; view.outline = outline;
        for (const resource of [geometry, material, edges, outlineMaterial]) this.resources.add(resource);
        let batch = this.batches.get(asset.file);
        if (!batch) {
          batch = { asset, items: new Set(), meshes: [], failed: false, dirty: true };
          this.batches.set(asset.file, batch);
          this.load(batch);
        }
        batch.items.add(object.id); batch.dirty = true;
      }
      view.object = object;
      const p = this.preview.get(object.id) ?? object;
      const key = `${p.x}:${p.z}:${object.y ?? 0}:${object.rotation}:${object.scale}`;
      if (key !== view.key) {
        view.group.position.set(p.x, (object.y ?? 0) + .012, p.z); view.group.rotation.y = object.rotation * Math.PI / 180; view.group.scale.setScalar(object.scale);
        view.group.updateMatrixWorld(true); view.key = key;
        this.revision++;
        if (view.file) { const batch = this.batches.get(view.file); if (batch) batch.dirty = true; }
      }
      if (view.outline) view.outline.visible = object.id === selected;
    }
    for (const batch of this.batches.values()) {
      if (!batch.dirty) continue;
      const items = [...batch.items].map(id => this.objects.get(id)!).filter(Boolean);
      for (const { mesh, local } of batch.meshes) {
        mesh.count = items.length;
        for (let i = 0; i < items.length; i++) mesh.setMatrixAt(i, items[i].group.matrixWorld.clone().multiply(local));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      }
      batch.dirty = false;
    }
  }
  private load(batch: Batch) {
    this.store.retain(batch.asset.file).then(template => {
      if (this.disposed || this.batches.get(batch.asset.file) !== batch) return;
      template.updateMatrixWorld(true);
      template.traverse(object => {
        if (!(object as THREE.Mesh).isMesh) return;
        for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
        const source = object as THREE.Mesh;
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, 500);
        mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        batch.meshes.push({ mesh, local: source.matrixWorld.clone() }); this.scene.add(mesh);
      });
      batch.dirty = true; this.revision++; this.render();
    }).catch(() => { if (!this.disposed && this.batches.get(batch.asset.file) === batch) { batch.failed = true; this.error(); this.render(); } });
  }
  setPreview(id: string, point: Point | null) {
    if (point) this.preview.set(id, point); else this.preview.delete(id);
  }
  pick(raycaster: THREE.Raycaster): { id: string; distance: number } | null {
    const proxies = [...this.objects.values()].flatMap(view => {
      const batch = view.file && this.batches.get(view.file);
      return view.proxy && batch && !batch.failed && batch.meshes.some(part => part.mesh.count > 0) ? [view.proxy] : [];
    });
    const hit = raycaster.intersectObjects(proxies, false)[0];
    return hit ? { id: hit.object.userData.facilityId as string, distance: hit.distance } : null;
  }
  retry() {
    for (const batch of this.batches.values()) if (batch.failed) { batch.failed = false; this.store.release(batch.asset.file); this.load(batch); }
  }
  private remove(id: string, view: ObjectView) {
    view.group.removeFromParent(); this.objects.delete(id); this.preview.delete(id); this.revision++;
    if (view.proxy) for (const resource of [view.proxy.geometry, view.proxy.material as THREE.Material, view.outline!.geometry, view.outline!.material as THREE.Material]) { resource.dispose(); this.resources.delete(resource); }
    const batch = view.file && this.batches.get(view.file);
    if (batch) {
      batch.items.delete(id); batch.dirty = true;
      if (!batch.items.size) {
        for (const { mesh } of batch.meshes) { mesh.removeFromParent(); mesh.dispose(); }
        this.batches.delete(batch.asset.file); this.store.release(batch.asset.file);
      }
    }
  }
  extent(base: Extent, objects: readonly FacilityObject[]): Extent {
    let { minX, maxX, minZ, maxZ } = base;
    for (const object of objects) {
      const dimensions = findLibraryAsset(object.assetId)?.dimensions ?? [1, 1, 1];
      const angle = object.rotation * Math.PI / 180, x = (Math.abs(Math.cos(angle)) * dimensions[0] + Math.abs(Math.sin(angle)) * dimensions[2]) * object.scale / 2 + 1;
      const z = (Math.abs(Math.sin(angle)) * dimensions[0] + Math.abs(Math.cos(angle)) * dimensions[2]) * object.scale / 2 + 1;
      minX = Math.min(minX, object.x - x); maxX = Math.max(maxX, object.x + x); minZ = Math.min(minZ, object.z - z); maxZ = Math.max(maxZ, object.z + z);
    }
    return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }
  stats() { return { objects: this.objects.size, uniqueModels: this.batches.size, revision: this.revision, pending: [...this.batches.values()].filter(batch => !batch.failed && !batch.meshes.length).length, failed: [...this.batches.values()].filter(batch => batch.failed).length + [...this.objects.values()].filter(view => !view.file).length }; }
  dispose() {
    this.disposed = true;
    for (const [id, view] of this.objects) this.remove(id, view);
    this.resources.clear(); this.preview.clear();
  }
}
