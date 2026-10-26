import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Vector3, Quaternion, Box3 } from 'three';

// Default mode creates private candidates. --gzip-public only adds lossless transport siblings.
const root = fileURLToPath(new URL('../', import.meta.url));
const candidateRoot = resolve(root, '.private/audits/browser-lod-candidates');
const args = process.argv.slice(2);
const gzipPublic = args.length === 1 && args[0] === '--gzip-public';
if (!gzipPublic && args.length && (args.length !== 2 || args[0] !== '--output-dir')) throw new Error('Usage: node scripts/prepare-browser-lods.mjs [--output-dir private-candidate-directory | --gzip-public]');
const outputRoot = resolve(root, args[1] ?? candidateRoot);
if (outputRoot !== candidateRoot && !outputRoot.startsWith(candidateRoot + sep)) throw new Error('Output must remain inside .private/audits/browser-lod-candidates');
if (root.startsWith('<workspace-volume>/')) {
  const info = spawnSync('diskutil', ['info', '-plist', '<workspace-volume>'], { encoding: 'utf8' });
  if (info.status !== 0 || !/<key>VolumeUUID<\/key>\s*<string>76EC491C-C108-41DA-89B9-4B69C79AED19<\/string>/.test(info.stdout)) throw new Error('Expected WorkSSD volume is not mounted');
  if (!(await realpath(root)).startsWith('<workspace>')) throw new Error('Unexpected canonical checkout');
}
await mkdir(outputRoot, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const selectedClips = new Set(['idle', 'walk', 'interact']);
const terminal = name => name.split('|').at(-1).toLowerCase();
const commonOptions = ['-cc', '-ce', 'ext', '-vp', '16', '-vt', '16', '-vn', '12', '-kn', '-km', '-ke'];
const staticFiles = [
  'box_corrugated_brown_b08', 'chair_office_amf_black_a01', 'computer_monitor_office_a01',
  'computer_scanner_barcode_a01', 'conveyor_belt_a05', 'desk_a01',
  'furniture_workbench_standard_e01', 'instrument_caliper_a01',
  'lamp_ceiling_1m_rectangle_a01', 'serviceTool_brake_lathe_a01',
  'storage_shelf_basic_a01', 'structure_wall_straight_a01',
].map(name => `simready/${name}.glb`);
const characterFiles = ['worker', 'worker-female', 'casual-character', 'visitor-female'].map(name => `characters/${name}.glb`);
const additionalGzipFiles = [
  'simready/environment_floor_a01.glb', 'simready/pallet_a01.glb', 'simready/box_corrugated_brown_b08-actor.glb',
  'kenney/nature-kit/tree_oak.glb', 'kenney/nature-kit/tree_detailed.glb', 'kenney/potted-plant.glb',
];

if (gzipPublic) {
  const directory = resolve(root, 'public/assets/lod'), manifestPath = resolve(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const allowlist = new Set([...staticFiles, ...characterFiles]);
  if (manifest.assets.length !== allowlist.size || new Set(manifest.assets.map(asset => asset.file)).size !== allowlist.size) throw new Error('Unexpected public LOD manifest');
  let sourceBytes = 0, gzipBytes = 0;
  for (const asset of manifest.assets) {
    if (!allowlist.has(asset.file)) throw new Error(`Unexpected public LOD file ${asset.file}`);
    const original = await readFile(resolve(directory, asset.file));
    if (hash(original) !== asset.sha256 || original.length !== asset.bytes) throw new Error(`Public LOD hash changed: ${asset.file}`);
    const compressed = gzipSync(original, { level: 9 });
    if (!gunzipSync(compressed).equals(original) || !gzipSync(original, { level: 9 }).equals(compressed)) throw new Error('Non-reproducible gzip output');
    asset.gzipFile = `${asset.file}.gz`; asset.gzipBytes = compressed.length; asset.gzipSHA256 = hash(compressed);
    await writeFile(resolve(directory, asset.gzipFile), compressed);
    sourceBytes += original.length; gzipBytes += compressed.length;
  }
  const additionalAssets = [];
  for (const file of additionalGzipFiles) {
    const original = await readFile(resolve(root, 'public/assets', file)), compressed = gzipSync(original, { level: 9 });
    if (!gunzipSync(compressed).equals(original) || !gzipSync(original, { level: 9 }).equals(compressed)) throw new Error('Non-reproducible gzip output');
    await writeFile(resolve(root, 'public/assets', `${file}.gz`), compressed);
    additionalAssets.push({ file: `/assets/${file}`, bytes: original.length, sha256: hash(original), gzipFile: `/assets/${file}.gz`, gzipBytes: compressed.length, gzipSHA256: hash(compressed) });
    sourceBytes += original.length; gzipBytes += compressed.length;
  }
  manifest.gzipTransport = { format: 'gzip', tool: 'node:zlib gzipSync', level: 9, deterministic: true, decodedBytesIdentical: true, sourceBytes, gzipBytes, additionalAssets, reproduction: 'node scripts/prepare-browser-lods.mjs --gzip-public' };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ files: allowlist.size + additionalAssets.length, sourceBytes, gzipBytes }));
  process.exit(0);
}

function parseGLB(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header');
  const chunks = []; let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk');
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + length) }); offset += 8 + length;
  }
  const json = JSON.parse(chunks.find(chunk => chunk.type === 0x4e4f534a).bytes.toString('utf8'));
  return { json, chunks, bin: chunks.find(chunk => chunk.type === 0x004e4942)?.bytes };
}
function repackJSON(glb, json) {
  const raw = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc((raw.length + 3) & ~3, 0x20); raw.copy(padded);
  const chunks = [{ type: 0x4e4f534a, bytes: padded }, ...glb.chunks.filter(chunk => chunk.type !== 0x4e4f534a)];
  const result = Buffer.alloc(12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0));
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  let offset = 12;
  for (const chunk of chunks) { result.writeUInt32LE(chunk.bytes.length, offset); result.writeUInt32LE(chunk.type, offset + 4); chunk.bytes.copy(result, offset + 8); offset += 8 + chunk.bytes.length; }
  return result;
}
function normalized(value, accessor) {
  if (!accessor.normalized || accessor.componentType === 5126) return value;
  const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[accessor.componentType];
  return Math.max(accessor.componentType === 5120 || accessor.componentType === 5122 ? -1 : 0, value / max);
}
function inspect(bytes) {
  const { json: j, bin } = parseGLB(bytes); let triangles = 0;
  for (const mesh of j.meshes ?? []) for (const p of mesh.primitives ?? []) {
    const count = j.accessors[p.indices ?? p.attributes.POSITION].count;
    if (p.mode === undefined || p.mode === 4) triangles += count / 3;
    else if (p.mode === 5 || p.mode === 6) triangles += count - 2;
    else throw new Error(`Unsupported primitive mode ${p.mode}`);
  }
  const bounds = new Box3();
  const walk = (index, parent) => {
    const node = j.nodes[index], local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const matrix = parent.clone().multiply(local);
    if (node.mesh !== undefined) for (const primitive of j.meshes[node.mesh].primitives) {
      const a = j.accessors[primitive.attributes.POSITION];
      if (!a.min || !a.max) throw new Error('Missing position bounds');
      const lo = a.min.map(v => normalized(v, a)), hi = a.max.map(v => normalized(v, a));
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(matrix));
    }
    for (const child of node.children ?? []) walk(child, matrix);
  };
  for (const index of j.scenes?.[j.scene ?? 0]?.nodes ?? []) walk(index, new Matrix4());
  return {
    bytes: bytes.length, sha256: hash(bytes), triangles,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new Vector3()).toArray(), note: 'Default-scene accessor bounds transformed to metric coordinates; unposed bind bounds for characters.' },
    meshNames: (j.meshes ?? []).map(m => m.name).filter(Boolean),
    nodeNames: (j.nodes ?? []).map(n => n.name).filter(Boolean),
    materialNames: (j.materials ?? []).map(m => m.name ?? ''),
    animations: (j.animations ?? []).map(a => ({ name: a.name, channels: a.channels.length, duration: Math.max(...a.samplers.map(s => j.accessors[s.input].max?.[0] ?? 0)) })),
    images: (j.images ?? []).map(image => {
      if (image.uri) return { uri: image.uri };
      const view = j.bufferViews[image.bufferView];
      return { mimeType: image.mimeType, bytes: view.byteLength, sha256: hash(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)) };
    }),
    extensionsUsed: j.extensionsUsed ?? [],
  };
}

function restoreMeshNames(sourceBytes, packedBytes) {
  const source = parseGLB(sourceBytes).json, packed = parseGLB(packedBytes), output = packed.json;
  const descendants = index => {
    const node = output.nodes[index];
    return [...(node.mesh === undefined ? [] : [node.mesh]), ...(node.children ?? []).flatMap(descendants)];
  };
  for (const node of source.nodes ?? []) {
    const name = node.mesh === undefined ? undefined : source.meshes[node.mesh].name;
    if (!name) continue;
    const outputNode = output.nodes.findIndex(candidate => candidate.name === node.name);
    if (outputNode < 0) throw new Error(`Missing named mesh parent ${node.name}`);
    const meshes = [...new Set(descendants(outputNode))];
    if (meshes.length !== 1) throw new Error(`Ambiguous source mesh-name mapping for ${name}`);
    output.meshes[meshes[0]].name = name;
  }
  // Names are metadata only; all packed binary data remains unchanged.
  return repackJSON(packed, output);
}

const records = [];
for (const file of [...staticFiles, ...characterFiles]) {
  const sourcePath = resolve(root, 'public/assets', file), original = await readFile(sourcePath), source = inspect(original);
  const outputPath = resolve(outputRoot, file); await mkdir(dirname(outputPath), { recursive: true });
  const character = file.startsWith('characters/');
  let inputPath = sourcePath, animationFilter;
  if (character) {
    const glb = parseGLB(original), json = structuredClone(glb.json);
    json.animations = json.animations.filter(clip => selectedClips.has(terminal(clip.name)));
    if (json.animations.length !== 3 || new Set(json.animations.map(clip => terminal(clip.name))).size !== 3) throw new Error(`Missing exact source clips in ${file}`);
    const stripped = repackJSON(glb, json), strippedGLB = parseGLB(stripped);
    if (!strippedGLB.bin.equals(glb.bin)) throw new Error('Animation filter changed binary source data');
    inputPath = resolve(outputRoot, 'intermediate', file); await mkdir(dirname(inputPath), { recursive: true }); await writeFile(inputPath, stripped);
    animationFilter = { retained: json.animations.map(a => a.name), removed: glb.json.animations.filter(a => !selectedClips.has(terminal(a.name))).map(a => a.name), sourceAnimationJSONSHA256: hash(Buffer.from(JSON.stringify(json.animations))), sourceBINUnchanged: true, intermediate: relative(outputRoot, inputPath) };
  }
  const options = [...commonOptions, ...(character ? ['-af', '0', '-ac', '-at', '24', '-ar', '16', '-as', '24'] : ['-si', '0.04', '-se', '0.001', '-sp'])];
  const command = ['exec', '--offline', '--yes', '--package=gltfpack@1.3.0', '--', 'gltfpack', '-i', inputPath, '-o', outputPath, ...options];
  const packed = spawnSync('npm', command, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (packed.status !== 0) throw new Error(`gltfpack failed for ${file}: ${packed.stderr || packed.stdout}`);
  const packedBytes = restoreMeshNames(original, await readFile(outputPath));
  await writeFile(outputPath, packedBytes);
  const output = inspect(packedBytes);
  if (!output.extensionsUsed.includes('EXT_meshopt_compression')) throw new Error(`Missing meshopt compression in ${file}`);
  if (character && source.triangles !== output.triangles) throw new Error(`Character triangle count changed in ${file}`);
  if (JSON.stringify(source.images) !== JSON.stringify(output.images)) throw new Error(`Source image payloads changed in ${file}`);
  for (const name of source.nodeNames) if (!output.nodeNames.includes(name)) throw new Error(`Lost named node ${name} in ${file}`);
  for (const name of source.meshNames) if (!output.meshNames.includes(name)) throw new Error(`Lost named mesh ${name} in ${file}`);
  for (const name of source.materialNames) if (!output.materialNames.includes(name)) throw new Error(`Lost named material ${name} in ${file}`);
  if (character && JSON.stringify(output.animations.map(a => a.name).sort()) !== JSON.stringify(animationFilter.retained.toSorted())) throw new Error(`Animation selection changed in ${file}`);
  const maxBoundDelta = Math.max(...source.bounds.min.map((v, i) => Math.abs(v - output.bounds.min[i])), ...source.bounds.max.map((v, i) => Math.abs(v - output.bounds.max[i])));
  const record = { file, candidate: relative(root, outputPath), kind: character ? 'character-codec-only' : 'initial-static-lod', source, output, triangleRatio: output.triangles / source.triangles, maxBoundDelta, options, ...(animationFilter ? { animationFilter } : {}), command: ['npm', ...command] };
  records.push(record);
  console.log(JSON.stringify({ file, sourceBytes: source.bytes, outputBytes: output.bytes, sourceTriangles: source.triangles, outputTriangles: output.triangles, triangleRatio: record.triangleRatio, maxBoundDelta }));
}

// Unique Factory requests. HDR, code/fonts/UI thumbnails are outside this asset-only estimate.
const factoryFiles = [
  'simready/environment_floor_a01.glb', 'simready/pallet_a01.glb', 'simready/box_corrugated_brown_b08-actor.glb',
  'simready/serviceTool_brake_lathe_a01.glb', 'simready/furniture_workbench_standard_e01.glb', 'simready/conveyor_belt_a05.glb',
  'simready/instrument_caliper_a01.glb', 'simready/computer_monitor_office_a01.glb',
  'simready/structure_wall_straight_a01.glb', 'simready/storage_shelf_basic_a01.glb', 'simready/lamp_ceiling_1m_rectangle_a01.glb',
  'characters/worker.glb', 'characters/worker-female.glb',
  'kenney/nature-kit/tree_oak.glb', 'kenney/nature-kit/tree_detailed.glb', 'kenney/potted-plant.glb',
];
const factoryAssets = await Promise.all(factoryFiles.map(async file => {
  const record = records.find(item => item.file === file);
  return { file, bytes: record?.output.bytes ?? (await readFile(resolve(root, 'public/assets', file))).length, sourceBytes: record?.source.bytes ?? (await readFile(resolve(root, 'public/assets', file))).length, candidate: Boolean(record) };
}));
const estimate = { note: 'Asset-only sum, unique Factory models including surroundings; excludes HDR, JS/CSS/fonts, UI thumbnails and HTTP overhead. Rendering/decoder/visual acceptance still required.', assets: factoryAssets, sourceBytes: factoryAssets.reduce((sum, f) => sum + f.sourceBytes, 0), candidateBytes: factoryAssets.reduce((sum, f) => sum + f.bytes, 0) };
const metadata = { tool: 'gltfpack@1.3.0 (project-cached, npm --offline)', staticPolicy: 'Source-derived target 0.04 triangle ratio, maximum relative simplification error 0.001; permissive simplification across attribute discontinuities, no aggressive error override; 16-bit positions/UVs and 12-bit normals.', characterPolicy: 'Exact terminal Idle/Walk/Interact source animations selected by JSON-only repack, source BIN unchanged before packing, no geometry simplification, no animation resampling.', retainedOriginals: true, promotion: 'None: public assets and source manifests remain untouched.', excludedSmallModels: ['simready/environment_floor_a01.glb', 'simready/pallet_a01.glb', 'simready/box_corrugated_brown_b08-actor.glb'], records, factoryEstimate: estimate };
await writeFile(resolve(outputRoot, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ metadata: relative(root, resolve(outputRoot, 'metadata.json')), factorySourceBytes: estimate.sourceBytes, factoryCandidateBytes: estimate.candidateBytes }));
