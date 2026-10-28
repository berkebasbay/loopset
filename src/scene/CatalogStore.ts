import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BROWSER_GZIP_URLS } from './browserAssets';
import { assetURL } from '../assetUrl';

const compressedModelURLs = new Set<string>(BROWSER_GZIP_URLS);
const isGLB = (bytes: ArrayBuffer) => bytes.byteLength >= 12 && new DataView(bytes).getUint32(0, true) === 0x46546c67;
const INACTIVE_LIMIT = 24, INACTIVE_BYTE_LIMIT = 48 * 1024 * 1024, ACTIVE_BYTE_LIMIT = 256 * 1024 * 1024;
type Resources = Set<{ dispose(): void }>;
interface Entry { promise: Promise<THREE.Group>; resources: Resources; references: number; touched: number; bytes: number; loaded: boolean }

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
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  private async loadModel(url: string) {
    const resolved = assetURL(url);
    if (!compressedModelURLs.has(url) || typeof DecompressionStream === 'undefined') return this.loader.loadAsync(resolved);
    let bytes: ArrayBuffer;
    try {
      const response = await fetch(`${resolved}.gz`);
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
      return await this.loader.parseAsync(bytes, resolved.slice(0, resolved.lastIndexOf('/') + 1));
    } catch {
      // Standalone GLBs remain available on hosts without compressed transport
      // or with a damaged compressed payload. A failed fallback still surfaces.
      return this.loader.loadAsync(resolved);
    }
  }

  private entry(url: string): Entry {
    const known = this.entries.get(url);
    if (known) { known.touched = performance.now(); return known; }
    const entry: Entry = { promise: null!, resources: new Set(), references: 0, touched: performance.now(), bytes: 0, loaded: false };
    entry.promise = this.loadModel(url).then(gltf => {
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
      const arrays = new Set<ArrayBufferView>();
      let textureBytes = 0;
      for (const resource of found) {
        const geometry = resource as THREE.BufferGeometry;
        if (geometry.isBufferGeometry) {
          for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array);
          if (geometry.index) arrays.add(geometry.index.array);
        }
        const texture = resource as THREE.Texture;
        if (texture.isTexture) { const image = texture.image as { width?: number; height?: number } | undefined; textureBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3; }
      }
      entry.bytes = [...arrays].reduce((bytes, array) => bytes + array.byteLength, textureBytes);
      const active = [...this.entries.values()].filter(item => item !== entry && item.references > 0).reduce((bytes, item) => bytes + item.bytes, 0);
      if (entry.references > 0 && active + entry.bytes > ACTIVE_BYTE_LIMIT) { disposeOwned(found); throw new Error('Active scene asset budget reached.'); }
      entry.resources = found; entry.loaded = true;
      gltf.scene.animations = gltf.animations;
      this.prune();
      return gltf.scene;
    }).catch(error => { if (this.entries.get(url) === entry) this.entries.delete(url); throw error; });
    this.entries.set(url, entry);
    return entry;
  }
  load(url: string): Promise<THREE.Group> {
    if (this.disposed) return Promise.reject(new Error('Asset store closed'));
    return this.entry(url).promise;
  }
  retain(url: string): Promise<THREE.Group> {
    if (this.disposed) return Promise.reject(new Error('Asset store closed'));
    const entry = this.entry(url); entry.references++;
    return entry.promise;
  }
  release(url: string) {
    const entry = this.entries.get(url);
    if (entry) { entry.references = Math.max(0, entry.references - 1); entry.touched = performance.now(); }
    this.prune();
  }
  private prune() {
    const inactive = [...this.entries].filter(([, entry]) => entry.references === 0 && entry.loaded).sort((a, b) => a[1].touched - b[1].touched);
    let bytes = inactive.reduce((total, [, entry]) => total + entry.bytes, 0), count = inactive.length;
    for (const [url, entry] of inactive) {
      if (count <= INACTIVE_LIMIT && bytes <= INACTIVE_BYTE_LIMIT) break;
      disposeOwned(entry.resources); this.entries.delete(url); bytes -= entry.bytes; count--;
    }
  }
  stats() {
    return { models: this.entries.size, active: [...this.entries.values()].filter(entry => entry.references > 0).length, estimatedBytes: [...this.entries.values()].reduce((bytes, entry) => bytes + entry.bytes, 0) };
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) disposeOwned(entry.resources);
    this.entries.clear();
  }
}
