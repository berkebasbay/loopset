import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CatalogStore } from '../src/scene/CatalogStore';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial();
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry, material));
  return { gltf: { scene, animations: [] } as unknown as GLTF, geometry, material };
}
describe('catalogue resource leases', () => {
  it('reuses a model and keeps active geometry alive while many inactive models are retired', async () => {
    const active = fixture(), disposed = vi.spyOn(active.geometry, 'dispose');
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => url.endsWith('active.glb') ? active.gltf : fixture().gltf);
    const store = new CatalogStore();
    const first = await store.retain('/assets/facility/active.glb');
    const second = await store.retain('/assets/facility/active.glb');
    expect(first).toBe(second); expect(loader).toHaveBeenCalledTimes(1);
    store.release('/assets/facility/active.glb');
    for (let i = 0; i < 60; i++) { const url = `/assets/facility/inactive-${i}.glb`; await store.retain(url); store.release(url); }
    expect(disposed).not.toHaveBeenCalled();
    expect(store.stats().models).toBeLessThan(60);
    expect(await store.load('/assets/facility/active.glb')).toBe(first);
    store.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
  });
  it('releases geometry which finishes after its store has closed', async () => {
    const asset = fixture(), disposed = vi.spyOn(asset.geometry, 'dispose');
    let finish!: (value: GLTF) => void;
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = new CatalogStore(), pending = store.retain('/assets/facility/pending.glb');
    store.dispose(); finish(asset.gltf);
    await expect(pending).rejects.toThrow('Asset store closed'); expect(disposed).toHaveBeenCalledTimes(1);
    expect(store.stats().models).toBe(0);
  });
});
