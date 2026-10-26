import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

function disposeOwned(resources: Set<{ dispose(): void }>) {
  const images = new Set<ImageBitmap>();
  for (const resource of resources) {
    const texture = resource as THREE.Texture;
    if (texture.isTexture && typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    resource.dispose();
  }
  images.forEach(image => image.close());
}

/** Component-lifetime cache: scene edits reuse parsed models and GPU buffers. */
export class CatalogStore {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly pending = new Map<string, Promise<THREE.Group>>();
  private readonly resources = new Set<{ dispose(): void }>();
  private disposed = false;

  load(url: string): Promise<THREE.Group> {
    if (this.disposed) return Promise.reject(new Error('Asset store closed'));
    const known = this.pending.get(url);
    if (known) return known;
    const promise = this.loader.loadAsync(url).then(gltf => {
      const found = new Set<{ dispose(): void }>();
      gltf.scene.traverse(object => {
        if (!(object as THREE.Mesh).isMesh) return;
        const mesh = object as THREE.Mesh; found.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          found.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) found.add(value as THREE.Texture);
        }
      });
      if (this.disposed) { disposeOwned(found); throw new Error('Asset store closed'); }
      found.forEach(resource => this.resources.add(resource));
      gltf.scene.animations = gltf.animations;
      return gltf.scene;
    }).catch(error => { this.pending.delete(url); throw error; });
    this.pending.set(url, promise);
    return promise;
  }
  dispose() {
    this.disposed = true;
    disposeOwned(this.resources);
    this.resources.clear(); this.pending.clear();
  }
}
