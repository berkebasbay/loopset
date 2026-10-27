import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CatalogStore } from '../src/scene/CatalogStore';

const modelURL = '/assets/lod/characters/worker.glb';
const baseURL = '/assets/lod/characters/';

/** Minimal real GLB: the parser must recover the scene's named node. */
function modelBytes(name: string): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name }],
  }));
  const chunkLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + chunkLength), header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true); header.setUint32(12, chunkLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20); bytes.set(json, 20);
  return bytes.buffer;
}

function compressedResponse(bytes: ArrayBuffer): Response {
  return new Response(Uint8Array.from(gzipSync(new Uint8Array(bytes))));
}

function malformedModel(): ArrayBuffer {
  const bytes = modelBytes('Damaged transport');
  // Keep the actual GLB header/chunk lengths, but invalidate its JSON chunk.
  new Uint8Array(bytes)[20] = 0x21;
  return bytes;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('catalogue compressed transport fallback', () => {
  it('loads a real compressed model from the configured deployment subpath', async () => {
    vi.stubEnv('BASE_URL', '/loopset/');
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
    const fetchModel = vi.fn(async () => compressedResponse(modelBytes('Subpath model')));
    vi.stubGlobal('fetch', fetchModel);
    const store = new CatalogStore();
    try {
      expect((await store.load(modelURL)).children[0]?.name).toBe('Subpath_model');
      expect(fetchModel).toHaveBeenCalledExactlyOnceWith(`/loopset${modelURL}.gz`);
      expect(original).not.toHaveBeenCalled();
    } finally { store.dispose(); }
  });

  it('falls back once after a real GLB parse rejection and caches the recovered scene', async () => {
    const raw = await new GLTFLoader().parseAsync(modelBytes('Raw recovery'), baseURL);
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(raw);
    const fetchModel = vi.fn(async () => compressedResponse(malformedModel()));
    vi.stubGlobal('fetch', fetchModel);
    const store = new CatalogStore();
    try {
      const first = store.load(modelURL), concurrent = store.load(modelURL);
      expect(concurrent).toBe(first);
      expect(await first).toBe(raw.scene);
      expect(await store.load(modelURL)).toBe(raw.scene);
      expect(fetchModel).toHaveBeenCalledExactlyOnceWith(`${modelURL}.gz`);
      expect(original).toHaveBeenCalledExactlyOnceWith(modelURL);
    } finally { store.dispose(); }
  });

  it('surfaces the original-file failure and permits a later retry', async () => {
    const raw = await new GLTFLoader().parseAsync(modelBytes('Retry recovery'), baseURL);
    const failure = new Error('Original GLB unavailable');
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValueOnce(failure).mockResolvedValueOnce(raw);
    const fetchModel = vi.fn(async () => compressedResponse(malformedModel()));
    vi.stubGlobal('fetch', fetchModel);
    const store = new CatalogStore();
    try {
      await expect(store.load(modelURL)).rejects.toBe(failure);
      expect(original).toHaveBeenCalledTimes(1);
      expect(await store.load(modelURL)).toBe(raw.scene);
      expect(fetchModel).toHaveBeenCalledTimes(2); expect(original).toHaveBeenCalledTimes(2);
    } finally { store.dispose(); }
  });

  it('decodes a genuine gzip stream and parses its actual scene without fallback', async () => {
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
    const fetchModel = vi.fn(async () => compressedResponse(modelBytes('Gzip decoded')));
    vi.stubGlobal('fetch', fetchModel);
    const store = new CatalogStore();
    try {
      const scene = await store.load(modelURL);
      expect(scene.children[0]?.name).toBe('Gzip_decoded');
      expect(fetchModel).toHaveBeenCalledExactlyOnceWith(`${modelURL}.gz`);
      expect(original).not.toHaveBeenCalled();
    } finally { store.dispose(); }
  });

  it('does not decompress a GLB already decoded by HTTP Content-Encoding', async () => {
    const decompress = vi.fn(() => { throw new Error('A decoded GLB must not enter gzip decoding'); });
    vi.stubGlobal('DecompressionStream', decompress);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(modelBytes('HTTP decoded'))));
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
    const store = new CatalogStore();
    try {
      expect((await store.load(modelURL)).children[0]?.name).toBe('HTTP_decoded');
      expect(decompress).not.toHaveBeenCalled(); expect(original).not.toHaveBeenCalled();
    } finally { store.dispose(); }
  });

  it('loads the original directly when native gzip support is absent', async () => {
    const raw = await new GLTFLoader().parseAsync(modelBytes('Native fallback'), baseURL);
    const original = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(raw);
    const fetchModel = vi.fn();
    vi.stubGlobal('DecompressionStream', undefined); vi.stubGlobal('fetch', fetchModel);
    const store = new CatalogStore();
    try {
      expect(await store.load(modelURL)).toBe(raw.scene);
      expect(original).toHaveBeenCalledExactlyOnceWith(modelURL); expect(fetchModel).not.toHaveBeenCalled();
    } finally { store.dispose(); }
  });
});
