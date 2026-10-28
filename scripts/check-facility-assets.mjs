import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { catalogueReasonCodes } from './facility-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), directory = path.join(root, 'public/assets/facility');
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
const selection = JSON.parse(await fs.readFile(path.join(root, 'scripts/facility-selection.json'), 'utf8'));
const output = path.join(root, '.private/evidence/facility-builder/asset-validation.json'); await fs.mkdir(path.dirname(output), { recursive: true });
let previous = {}; try { previous = JSON.parse(await fs.readFile(output, 'utf8')).assets ?? {}; } catch { /* First validation. */ }
const validated = {}, ids = new Set(), categories = {}, loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let totalBytes = 0;
for (const asset of manifest.assets) {
  assert(!ids.has(asset.id), `Duplicate catalogue ID: ${asset.id}`); ids.add(asset.id);
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(asset.id) && /^[a-f0-9]{40}$/.test(asset.version));
  assert(/^\/assets\/(facility|simready|lod)\/[A-Za-z0-9_./-]+\.glb$/.test(asset.file) && !asset.file.includes('..'));
  assert(/^\/assets\/(facility|simready)\/[A-Za-z0-9_-]+\.png$/.test(asset.thumbnail));
  assert(asset.source === `https://huggingface.co/datasets/nvidia/simready-assets/tree/${asset.version}/${asset.id}`);
  assert(asset.dimensions.length === 3 && asset.dimensions.every(value => Number.isFinite(value) && value >= 0 && value <= 300));
  const bytes = await fs.readFile(path.join(root, 'public', asset.file.slice(1))), digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, asset.bytes); assert.equal(digest, asset.sha256);
  const thumbnail = await fs.readFile(path.join(root, 'public', asset.thumbnail.slice(1))); assert.equal(thumbnail.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  totalBytes += bytes.length + thumbnail.length; categories[asset.category] = (categories[asset.category] ?? 0) + 1;
  if (asset.provenance?.reused) { validated[asset.id] = { sha256: digest, reused: true }; continue; }
  assert.equal(asset.provenance?.creator, 'NVIDIA'); assert.equal(asset.provenance?.license, 'CC-BY-4.0'); assert(asset.provenance.inputs.length > 0);
  assert(bytes.length <= 2 * 1024 * 1024 && thumbnail.length <= 512_000);
  if (previous[asset.id]?.sha256 === digest && previous[asset.id]?.decoded) { validated[asset.id] = previous[asset.id]; continue; }
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert(document.buffers.every(buffer => !Object.hasOwn(buffer, 'uri')) && !document.images?.length, 'Library derivatives must contain local static geometry only.');
  assert(document.buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) <= 64 * 1024 * 1024, 'Decoded buffer declaration exceeds the preparation budget.');
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(array, ''); gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
  assert(!bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
  size.toArray().forEach((value, axis) => assert(Math.abs(value - asset.dimensions[axis]) <= Math.max(.02, asset.dimensions[axis] * .03), `Metric bounds mismatch: ${asset.id}`));
  let triangles = 0; const geometries = new Set(), materials = new Set();
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry; geometries.add(geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    const positions = geometry.attributes.position; assert(positions?.count > 0);
    for (let i = 0; i < positions.count; i++) assert([positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite));
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) assert(geometry.index.getX(i) < positions.count);
    triangles += (geometry.index?.count ?? positions.count) / 3;
  });
  assert(triangles > 0 && Number.isFinite(triangles));
  for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  validated[asset.id] = { sha256: digest, decoded: true, triangles, dimensions: size.toArray() };
}
assert(totalBytes < 650 * 1024 * 1024, 'Prepared models and thumbnails exceed their distribution budget.');
const selectedIds = new Set(selection.assets.map(asset => asset.id)), excludedIds = new Set();
const reasonCodes = new Set(catalogueReasonCodes);
for (const item of manifest.excluded ?? []) {
  assert(selectedIds.has(item.id) && !ids.has(item.id) && !excludedIds.has(item.id) && reasonCodes.has(item.reasonCode), 'Invalid public catalogue exclusion.');
  assert.deepEqual(Object.keys(item).sort(), ['id', 'reasonCode']); excludedIds.add(item.id);
}
const pending = selection.assets.filter(asset => !ids.has(asset.id) && !excludedIds.has(asset.id)).map(asset => asset.id);
const excluded = manifest.excluded ?? [];
if (process.argv.includes('--complete')) {
  assert.equal(pending.length, 0, 'Some source candidates are still unaccounted for.');
  assert(manifest.assets.length >= 800, 'Broad catalogue acceptance needs at least 800 prepared models.');
  for (const [category, minimum] of Object.entries({ equipment: 40, storage: 25, structure: 25, furniture: 40, containers: 200, accessories: 150, lighting: 8, safety: 10 })) assert((categories[category] ?? 0) >= minimum, `Catalogue category coverage is incomplete: ${category}`);
}
const result = { passed: true, complete: process.argv.includes('--complete'), models: ids.size, totalBytes, categories, pending, excluded, assets: validated };
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, models: ids.size, totalBytes, categories, pending: pending.length, excluded: excluded.length }));
