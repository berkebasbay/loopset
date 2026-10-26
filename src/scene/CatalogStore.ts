import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BROWSER_GZIP_URLS } from './browserAssets';

const compressedModelURLs = new Set<string>(BROWSER_GZIP_URLS);
const isGLB = (bytes: ArrayBuffer) => bytes.byteLength >= 12 && new DataView(bytes).getUint32(0, true) === 0x46546c67;

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

  private async loadModel(url: string) {
    if (!compressedModelURLs.has(url) || typeof DecompressionStream === 'undefined') return this.loader.loadAsync(url);
    let bytes: ArrayBuffer;
    try {
      const response = await fetch(`${url}.gz`);
      if (!response.ok) throw new Error('Compressed model unavailable');
      bytes = await response.arrayBuffer();
      // Fetch already decodes HTTP Content-Encoding. A decoded GLB must not be
      // decompressed again; a static .gz body still carries the gzip signature.
      if (!isGLB(bytes)) {
        const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
        if (header[0] !== 0x1f || header[1] !== 0x8b) throw new Error('Invalid compressed model');
        bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
      if (!isGLB(bytes)) throw new Error('Invalid model payload');
      return await this.loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
    } catch {
      // Standalone GLBs remain available on hosts without compressed transport
      // or with a damaged compressed payload. A failed fallback still surfaces.
      return this.loader.loadAsync(url);
    }
  }

  load(url: string): Promise<THREE.Group> {
    if (this.disposed) return Promise.reject(new Error('Asset store closed'));
    const known = this.pending.get(url);
    if (known) return known;
    const promise = this.loadModel(url).then(gltf => {
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
