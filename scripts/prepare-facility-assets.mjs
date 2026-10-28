// Bounded, resumable source preparation. The browser only consumes local derivatives.
import { readFile, writeFile, mkdir, rename, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCatalogueExclusions } from './facility-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'c72b4dea0c5738abb1fb42c04b644b753cb975e7';
const sourceBase = `https://huggingface.co/datasets/nvidia/simready-assets/resolve/${revision}/`;
const output = path.join(root, 'public/assets/facility');
const work = path.join(root, '.private/work/facility-assets');
const selection = JSON.parse(await readFile(path.join(root, 'scripts/facility-selection.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxSource = 200 * 1024 * 1024, maxModel = 2 * 1024 * 1024, maxDistribution = 600 * 1024 * 1024;
const python = process.env.QUEUELAB_ASSET_PYTHON || 'python3.12';
const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PXR_WORK_THREAD_LIMIT: '2', PYTHONPATH: process.env.QUEUELAB_USD_PYTHONPATH || path.join(root, '.private/tools/usd-core-26.11') };
const execute = promisify(execFile);
async function native(file, args, options) {
  try { const result = await execute(file, args, options); return { status: 0, ...result }; }
  catch (error) { return { status: 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr || error.message) }; }
}
await mkdir(output, { recursive: true }); await mkdir(work, { recursive: true });
const manifestPath = path.join(output, 'manifest.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { manifest = { revision, assets: [], excluded: [] }; }
if (manifest.revision !== revision) throw new Error('Use a separate output catalogue for a different source revision.');
const wanted = new Map(selection.assets.map(item => [item.id, item]));
if (wanted.size !== selection.assets.length || selection.assets.some(item => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(item.id))) throw new Error('Invalid source allowlist.');
const args = process.argv.slice(2), only = args.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
if (only?.some(id => !wanted.has(id))) throw new Error('Asset is outside the catalogue allowlist.');
const maximum = Number(args.find(arg => arg.startsWith('--limit='))?.slice(8) ?? wanted.size);
if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error('Invalid preparation limit.');
const failuresPath = process.env.QUEUELAB_PREPARE_OUTCOMES ? path.resolve(process.env.QUEUELAB_PREPARE_OUTCOMES) : path.join(work, 'outcomes.json');
let outcomes = {}; try { outcomes = JSON.parse(await readFile(failuresPath, 'utf8')); } catch { /* New preparation. */ }

async function fetchBytes(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > limit) throw new Error('Source file exceeds its byte budget.');
  const parts = []; let total = 0;
  for await (const part of response.body) { total += part.length; if (total > limit) throw new Error('Source stream exceeds its byte budget.'); parts.push(part); }
  return Buffer.concat(parts);
}
async function tree(id) {
  const items = []; let url = `https://huggingface.co/api/datasets/nvidia/simready-assets/tree/${revision}/${id}?recursive=true&limit=1000`;
  for (let page = 0; url; page++) {
    if (page >= 5) throw new Error('Source dependency listing exceeds its page budget.');
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Source listing returned ${response.status}`);
    items.push(...await response.json());
    const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
    url = next?.[1];
    if (url && !url.startsWith('https://huggingface.co/api/datasets/nvidia/simready-assets/tree/')) throw new Error('Unexpected source pagination host.');
  }
  return items;
}
function verifySource(bytes, item) {
  if (bytes.length !== item.size) throw new Error('Source size mismatch.');
  if (item.lfs?.oid) { if (hash(bytes) !== item.lfs.oid) throw new Error('Source checksum mismatch.'); }
  else if (/^[a-f0-9]{40}$/.test(item.oid ?? '')) {
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (oid !== item.oid) throw new Error('Source Git checksum mismatch.');
  }
}
function glb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB container.');
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (!document.meshes?.length || document.buffers?.some(buffer => buffer.uri) || document.images?.some(image => image.uri)) throw new Error('Library GLB must be self-contained.');
  return document;
}
const categoryFor = id => {
  const item = wanted.get(id);
  if (item) return item.category;
  return id.startsWith('box_') || id.startsWith('pallet_') ? 'containers' : id.includes('lamp') ? 'lighting' : 'equipment';
};
const title = id => {
  const parts = id.replace(/([a-z])([A-Z])/g, '$1 $2').split('_');
  const variant = /^[a-z]+\d+$/.test(parts.at(-1)) ? parts.pop().toUpperCase() : '';
  const prefix = parts[0];
  if (['equipment', 'furniture', 'computer', 'serviceTool', 'service Tool', 'testing Tool', 'power Tool', 'tire Tool', 'structure', 'storage'].includes(prefix)) parts.shift();
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${variant ? ` · ${variant}` : ''}`;
};
async function writeIndex() {
  const assets = [...manifest.assets].sort((a, b) => a.name.localeCompare(b.name));
  const available = new Set(assets.map(asset => asset.id));
  manifest.excluded = mergeCatalogueExclusions(selection.assets, available, manifest.excluded, outcomes);
  const text = `import type { LibraryAsset } from './types';\n\n/** Prepared, source-attributed browser models. Regenerate with prepare-facility-assets.mjs. */\nexport const libraryAssets: readonly LibraryAsset[] = ${JSON.stringify(assets.map(({ provenance, ...item }) => item), null, 2)};\n`;
  const target = path.join(root, 'src/catalog/data.ts'), temporary = `${target}.tmp`;
  await writeFile(temporary, text); await rename(temporary, target);
  await writeFile(`${manifestPath}.tmp`, JSON.stringify({ ...manifest, assets }, null, 2) + '\n'); await rename(`${manifestPath}.tmp`, manifestPath);
  await writeFile(`${failuresPath}.tmp`, JSON.stringify(outcomes, null, 2) + '\n'); await rename(`${failuresPath}.tmp`, failuresPath);
}

// Reuse the original attributed derivatives without rewriting their source files.
const legacy = JSON.parse(await readFile(path.join(root, 'public/assets/simready/manifest.json'), 'utf8'));
for (const entry of legacy.assets) {
  if (manifest.assets.some(asset => asset.id === entry.name)) continue;
  let file = `assets/lod/simready/${entry.file}`;
  try { await stat(path.join(root, 'public', file)); } catch { file = `assets/simready/${entry.file}`; }
  const bytes = await readFile(path.join(root, 'public', file));
  manifest.assets.push({ id: entry.name, version: entry.revision, name: title(entry.name), category: categoryFor(entry.name), role: wanted.get(entry.name)?.role ?? (['lathe', 'workbench', 'scanner', 'desk'].some(word => entry.name.includes(word)) ? 'process' : 'visual'), file: `/${file}`, thumbnail: `/assets/simready/${entry.thumbnail}`, bytes: bytes.length, sha256: hash(bytes), dimensions: entry.originalDimensions, triangles: entry.triangles, source: entry.source, provenance: { reused: true, sourceManifest: 'assets/simready/manifest.json' } });
}
await writeIndex();
if (args.includes('--seed-only')) { process.stdout.write(`Indexed ${manifest.assets.length} attributed models.\n`); process.exit(0); }

// The pinned registry tool is resolved once, rather than invoking npm per asset.
const npmCache = spawnSync('npm', ['config', 'get', 'cache'], { cwd: root, encoding: 'utf8' }).stdout.trim();
let packer;
try { for (const dir of await readdir(path.join(npmCache, '_npx'))) {
  const candidate = path.join(npmCache, '_npx', dir, 'node_modules/.bin/gltfpack');
  try {
    const metadata = JSON.parse(await readFile(path.join(npmCache, '_npx', dir, 'node_modules/gltfpack/package.json'), 'utf8'));
    if (metadata.version !== '1.3.0') continue;
    await stat(candidate); packer = candidate; break;
  } catch { /* Other cached tool. */ }
} } catch { /* A missing tool is an explicit preparation dependency. */ }
if (!packer) throw new Error('Install the pinned build-time gltfpack@1.3.0 tool before preparing models.');
const thumbnails = spawnSync('sips', ['--version'], { encoding: 'utf8', timeout: 10_000 });
if (thumbnails.status !== 0) throw new Error('Thumbnail preparation requires macOS sips. Existing prepared models do not require this build-time tool.');
const version = spawnSync(python, ['-c', 'from pxr import Usd; print(Usd.GetVersion())'], { env: pythonEnv, encoding: 'utf8', timeout: 30_000 });
if (version.status !== 0) throw new Error('The selected Python cannot load the installed usd-core package.');
let prepared = 0;
const candidates = selection.assets.filter(item => (!only || only.includes(item.id)) && !manifest.assets.some(asset => asset.id === item.id) && (args.includes('--retry') || !outcomes[item.id]?.excluded)).slice(0, maximum);
let checkpoint = Promise.resolve();
async function prepare(item) {
  const temporary = await mkdtemp(path.join(work, 'source-'));
  try {
    const entries = await tree(item.id); let sourceBytes = 0;
    const get = async entry => {
      if (!entry || entry.type !== 'file' || typeof entry.path !== 'string' || !entry.path.startsWith(`${item.id}/`) || /[\\\x00\r\n?#:]/.test(entry.path) || entry.path.split('/').some(part => ['..', '.', ''].includes(part)) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 120 * 1024 * 1024 || sourceBytes + entry.size > maxSource) throw new Error('Source dependency is outside its path or byte budget.');
      sourceBytes += entry.size;
      const bytes = await fetchBytes(sourceBase + entry.path.split('/').map(encodeURIComponent).join('/'), Math.min(120 * 1024 * 1024, entry.size));
      verifySource(bytes, entry);
      const target = path.join(temporary, entry.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
      return { bytes, target };
    };
    const metadata = await get(entries.find(entry => entry.path === `${item.id}/com.nvidia.simready.packaging.json`));
    if (JSON.parse(metadata.bytes).license !== 'CC-BY-4.0') throw new Error('The source package licence is not the approved CC BY 4.0.');
    const licence = await get(entries.find(entry => entry.path === `${item.id}/.metadata/LICENSE.txt`));
    await writeFile(path.join(output, 'LICENSE-CC-BY-4.0.txt'), licence.bytes.toString('utf8').trimEnd() + '\n');
    const files = entries.filter(entry => entry.type === 'file' && /\.(usd|usda|usdc)$/.test(entry.path) && !/\/(PhysX|MuJoCo|Newton|Physics)\//i.test(entry.path) && !/instances_(physx|newton|mujoco)\./i.test(entry.path));
    if (files.length > 96) throw new Error('Source dependency count exceeds its budget.');
    const stage = files.find(entry => /\/simready_usd\/[^/]+\.(usd|usda|usdc)$/.test(entry.path)) ?? files.filter(entry => /\.(usd|usda|usdc)$/.test(entry.path) && !/\/(payloads|materials|physics)\//i.test(entry.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
    if (!stage) throw new Error('No supported source stage.');
    const inputs = [];
    let dependencyCursor = 0;
    const downloads = await Promise.allSettled(Array.from({ length: Math.min(2, files.length) }, async () => {
      for (;;) { const file = files[dependencyCursor++]; if (!file) return; const { bytes } = await get(file); inputs.push({ path: file.path, bytes: bytes.length, sha256: hash(bytes) }); }
    }));
    const failedDownload = downloads.find(result => result.status === 'rejected');
    if (failedDownload) throw failedDownload.reason;
    const source = path.join(temporary, stage.path), raw = path.join(temporary, 'library.glb');
    const check = await native(python, [path.join(root, 'scripts/check-usd-dependencies.py'), path.join(temporary, item.id)], { env: pythonEnv, encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000 });
    if (check.status !== 0) throw new Error(check.stderr.trim() || 'Source dependency validation failed.');
    const convert = await native(python, [path.join(root, 'scripts/simready-to-glb.py'), source, raw, '--library'], { env: pythonEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000 });
    if (convert.status !== 0) throw new Error(convert.stderr.slice(-1000) || 'Geometry conversion failed.');
    const statistics = JSON.parse(convert.stdout.trim().split('\n').at(-1));
    if (!statistics.originalDimensions.every(value => Number.isFinite(value) && value >= 0 && value <= 300) || !statistics.originalDimensions.some(value => value > .001)) throw new Error('Geometry bounds are invalid.');
    const file = `${item.id}.glb`, target = path.join(output, file), packed = path.join(temporary, 'packed.glb');
    const ratio = Math.min(1, 45_000 / Math.max(1, statistics.triangles));
    const pack = await native(packer, ['-i', raw, '-o', packed, '-cc', '-ce', 'ext', '-vp', '16', '-vt', '14', '-vn', '10', '-si', String(ratio), '-se', '0.001'], { encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 });
    if (pack.status !== 0) throw new Error(pack.stderr.slice(-1000) || 'Geometry compression failed.');
    const bytes = await readFile(packed), document = glb(bytes);
    if (bytes.length > maxModel) throw new Error('The quality-bounded model exceeds the 2 MiB library budget.');
    const distributed = manifest.assets.filter(asset => asset.file.startsWith('/assets/facility/')).reduce((n, asset) => n + asset.bytes, 0);
    if (distributed + bytes.length > maxDistribution) throw new Error('Catalogue distribution budget reached.');
    const thumbnails = entries.filter(entry => entry.type === 'file' && entry.path.includes('/.thumbs/256x256/') && entry.path.endsWith('.png') && entry.size <= 2 * 1024 * 1024);
    const thumbnail = thumbnails.find(entry => /\.usda?_light\.png$/.test(entry.path)) ?? thumbnails[0];
    if (!thumbnail) throw new Error('No bounded source thumbnail.');
    const thumb = await get(thumbnail);
    if (thumb.bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Unsupported thumbnail container.');
    const thumbTarget = path.join(temporary, 'thumbnail.png');
    const resize = await native('sips', ['-Z', '256', thumb.target, '--out', thumbTarget], { encoding: 'utf8', timeout: 20_000 });
    if (resize.status !== 0) throw new Error('Source thumbnail could not be resized.');
    const thumbnailBytes = await readFile(thumbTarget);
    if (thumbnailBytes.length > 512_000) throw new Error('Prepared thumbnail exceeds its size budget.');
    await writeFile(target, bytes); await writeFile(path.join(output, `${item.id}.png`), thumbnailBytes);
    const triangles = document.meshes.reduce((n, mesh) => n + mesh.primitives.reduce((count, primitive) => count + (document.accessors[primitive.indices]?.count ?? 0) / 3, 0), 0);
    manifest.assets.push({ id: item.id, version: revision, name: title(item.id), category: item.category, role: item.role, file: `/assets/facility/${file}`, thumbnail: `/assets/facility/${item.id}.png`, bytes: bytes.length, sha256: hash(bytes), dimensions: statistics.originalDimensions, triangles, source: `https://huggingface.co/datasets/nvidia/simready-assets/tree/${revision}/${item.id}`, provenance: { creator: 'NVIDIA', license: 'CC-BY-4.0', inputs, thumbnail: { path: thumbnail.path, sourceSHA256: hash(thumb.bytes), sha256: hash(thumbnailBytes), bytes: thumbnailBytes.length, modification: 'Source preview resized to at most 256 pixels.' }, modifications: 'OpenUSD composition converted to source-derived static GLB; material-family PBR palette; source physics, MDL and high-resolution textures excluded; meshopt compression and LOD with 0.1% simplification error bound.', simplificationTarget: ratio, sourceTriangles: statistics.triangles } });
    outcomes[item.id] = { prepared: true, bytes: bytes.length, sourceBytes }; prepared++;
    process.stdout.write(JSON.stringify({ id: item.id, prepared: manifest.assets.length, bytes: bytes.length, triangles }) + '\n');
  } catch (error) {
    outcomes[item.id] = { excluded: true, reason: String(error.message).slice(0, 1500) };
    process.stdout.write(JSON.stringify({ id: item.id, excluded: true, reason: String(error.message).slice(0, 180) }) + '\n');
  } finally {
    // Only this job's freshly created temporary directory is released.
    await rm(temporary, { recursive: true, force: true });
    checkpoint = checkpoint.then(writeIndex); await checkpoint;
  }
}
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => {
  for (;;) { const item = candidates[cursor++]; if (!item) return; await prepare(item); }
}));
process.stdout.write(JSON.stringify({ preparedNow: prepared, available: manifest.assets.length, excluded: Object.values(outcomes).filter(item => item.excluded).length, candidates: wanted.size }) + '\n');
if (candidates.length && !prepared) process.exitCode = 1;
