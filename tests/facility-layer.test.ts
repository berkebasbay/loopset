import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FacilityLayer } from '../src/scene/FacilityLayer';
import { CatalogStore } from '../src/scene/CatalogStore';
import { libraryAssets } from '../src/catalog/registry';
import type { FacilityObject } from '../src/model/types';

describe('facility hit testing and delayed geometry', () => {
  it('does not block selection with pending or failed invisible art, then becomes selectable after successful retry', async () => {
    const asset = libraryAssets.find(asset => asset.id === 'furniture_workbench_standard_e01')!;
    const object: FacilityObject = { id: 'fixture-1', name: 'Synthetic fixture', assetId: asset.id, assetVersion: asset.version, x: 0, z: 0, rotation: 0, scale: 1 };
    const source = new THREE.Group(), geometry = new THREE.BoxGeometry(...asset.dimensions), material = new THREE.MeshStandardMaterial();
    const visible = new THREE.Mesh(geometry, material); visible.position.y = asset.dimensions[1] / 2; source.add(visible);
    let reject!: (reason: Error) => void;
    const retain = vi.fn(() => new Promise<THREE.Group>((_, no) => { reject = no; }));
    const store = { retain, release: vi.fn() } as unknown as CatalogStore;
    const scene = new THREE.Scene(), layer = new FacilityLayer(scene, store, () => {}, () => {});
    const ray = new THREE.Raycaster(new THREE.Vector3(0, asset.dimensions[1] / 2, 10), new THREE.Vector3(0, 0, -1));
    layer.sync([object], object.id); scene.updateMatrixWorld(true); expect(layer.pick(ray)).toBeNull();
    reject(new Error('Synthetic unavailable source')); await Promise.resolve(); await Promise.resolve();
    layer.sync([object], object.id); expect(layer.pick(ray)).toBeNull();
    retain.mockImplementation(() => Promise.resolve(source)); layer.retry(); await Promise.resolve(); await Promise.resolve();
    layer.sync([object], object.id); scene.updateMatrixWorld(true); expect(layer.pick(ray)?.id).toBe(object.id);
    layer.sync([], null); expect(layer.pick(ray)).toBeNull();
    layer.dispose(); geometry.dispose(); material.dispose();
  });
});
