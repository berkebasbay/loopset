// Offline, allowlisted asset preparation. Never clone/download the full dataset.
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = 'nvidia/simready-assets';
const allowlist = ['furniture_workbench_standard_e01', 'conveyor_belt_a05', 'pallet_a01', 'environment_floor_a01', 'desk_a01', 'computer_monitor_office_a01', 'chair_office_amf_black_a01', 'box_corrugated_brown_b08', 'serviceTool_brake_lathe_a01', 'instrument_caliper_a01', 'computer_scanner_barcode_a01', 'structure_wall_straight_a01', 'storage_shelf_basic_a01', 'lamp_ceiling_1m_rectangle_a01'];
const choices = process.env.SIMREADY_ONLY ? [...new Set(process.env.SIMREADY_ONLY.split(','))] : allowlist;
if (choices.some(name => !allowlist.includes(name))) throw new Error('Asset is outside the explicit allowlist');
const source = new URL('../.private/assets/simready/', import.meta.url);
const output = new URL('../public/assets/simready/', import.meta.url);
const limit = 160 * 1024 * 1024;
let downloaded = 0;
const hash = data => createHash('sha256').update(data).digest('hex');
let revision = process.env.SIMREADY_REVISION;
let previous;
try { previous = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8')); } catch { /* First preparation. */ }
if (!revision) {
  revision = previous?.revision;
}
if (!revision) {
  const response = await fetch(`https://huggingface.co/api/datasets/${repo}/revision/main`);
  if (!response.ok) throw new Error(`Dataset metadata: ${response.status}`);
  revision = (await response.json()).sha;
}
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing pinned revision');
if (process.env.SIMREADY_ONLY && previous?.revision && previous.revision !== revision) throw new Error('Cannot merge different source revisions');
await mkdir(source, { recursive: true });
await mkdir(output, { recursive: true });

const records = [];
for (const name of choices) {
  const treeResponse = await fetch(`https://huggingface.co/api/datasets/${repo}/tree/${revision}/${name}?recursive=true&limit=1000`);
  if (!treeResponse.ok) throw new Error(`${name} tree: ${treeResponse.status}`);
  const tree = await treeResponse.json();
  const get = async item => {
    if (item.size > limit || downloaded + item.size > limit) throw new Error('Selected-source download budget exceeded');
    const path = new URL(item.path, source);
    await mkdir(new URL('./', path), { recursive: true });
    let data;
    try { data = await readFile(path); } catch {
      const r = await fetch(`https://huggingface.co/datasets/${repo}/resolve/${revision}/${item.path}`);
      if (!r.ok) throw new Error(`${item.path}: ${r.status}`);
      data = Buffer.from(await r.arrayBuffer());
      if (data.length !== item.size) throw new Error(`Size mismatch: ${item.path}`);
      await writeFile(path, data);
    }
    if (data.length !== item.size) throw new Error(`Cached size mismatch: ${item.path}`);
    if (item.lfs?.oid && hash(data) !== item.lfs.oid) throw new Error(`Source hash mismatch: ${item.path}`);
    if (!item.lfs && /^[a-f0-9]{40}$/.test(item.oid ?? '')) {
      const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
      if (blob !== item.oid) throw new Error(`Pinned metadata/source mismatch: ${item.path}`);
    }
    downloaded += data.length;
    return data;
  };
  const metadataItem = tree.find(x => x.path === `${name}/com.nvidia.simready.packaging.json`);
  const metadata = JSON.parse(await get(metadataItem));
  if (metadata.license !== 'CC-BY-4.0') throw new Error(`Unapproved asset license: ${metadata.license}`);
  const licenseItem = tree.find(x => x.path === `${name}/.metadata/LICENSE.txt`);
  const license = await get(licenseItem);
  await writeFile(new URL('LICENSE-CC-BY-4.0.txt', output), license);
  const files = tree.filter(x => x.type === 'file' && /\.(usd|usda|usdc)$/.test(x.path) && !/\/(PhysX|MuJoCo|Newton|Physics)\//.test(x.path) && !/instances_(physx|newton|mujoco)\./.test(x.path));
  const root = files.find(x => /\/simready_usd\/[^/]+\.usd$/.test(x.path));
  if (!root) throw new Error(`Missing root USD: ${name}`);
  const ordered = [root, ...files.filter(x => x !== root)];
  const inputs = [];
  for (const item of ordered) {
    const data = await get(item);
    inputs.push({ path: item.path, bytes: data.length, sha256: hash(data) });
  }
  const textures = [];
  if (name === 'serviceTool_brake_lathe_a01') for (const tile of [1001, 1002, 1003]) {
    const item = tree.find(entry => entry.type === 'file' && entry.path.includes('/Textures/.thumbs/512x512/') && entry.path.endsWith(`t_serviceTool_brake_lathe_a01_alb.${tile}.png.png`));
    if (!item || item.size > 1024 * 1024) throw new Error(`Missing bounded lathe albedo ${tile}`);
    const data = await get(item), file = `lathe-albedo-${tile}.png`;
    await writeFile(new URL(file, output), data);
    const record = { path: item.path, file, bytes: data.length, sha256: hash(data), tile, resolution: [512, 512] };
    inputs.push({ path: item.path, bytes: data.length, sha256: hash(data) }); textures.push(record);
  }
  const file = `${name}.glb`;
  const conversion = spawnSync(process.env.QUEUELAB_ASSET_PYTHON || 'python3', [fileURLToPath(new URL('./simready-to-glb.py', import.meta.url)), fileURLToPath(new URL(root.path, source)), fileURLToPath(new URL(file, output))], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: fileURLToPath(new URL('../.private/tools/usd-core-26.11/', import.meta.url)) }, maxBuffer: 1024 * 1024 });
  if (conversion.status !== 0) throw new Error(conversion.stderr || conversion.stdout);
  const statistics = JSON.parse(conversion.stdout.trim().split('\n').at(-1));
  let glb = await readFile(new URL(file, output)), optimization;
  if (glb.length > 20 * 1024 * 1024) {
    // Enforce the browser budget on the shipped codec payload, retaining the
    // original geometry privately; never lower the runtime size guard.
    const backup = new URL('../.private/assets/uncompressed-catalog/', import.meta.url);
    await mkdir(backup, { recursive: true }); await copyFile(new URL(file, output), new URL(file, backup));
    const packed = new URL(file.replace('.glb', '-packed.glb'), output);
    const sceneryLOD = name === 'storage_shelf_basic_a01' ? ['-si', '0.25', '-se', '0.001'] : [];
    const result = spawnSync('npm', ['exec', '--yes', '--package=gltfpack@1.3.0', '--', 'gltfpack', '-i', fileURLToPath(new URL(file, output)), '-o', fileURLToPath(packed), '-cc', '-ce', 'ext', '-vp', '16', '-vt', '16', '-vn', '12', '-kn', '-km', ...sceneryLOD], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    optimization = { tool: 'gltfpack1.3.0', sourceBytes: glb.length, sourceSHA256: hash(glb), options: '-cc -ce ext -vp16 -vt16 -vn12 -kn -km' + (sceneryLOD.length ? ' -si0.25 -se0.001' : ''), intentionalSimplification: sceneryLOD.length > 0 };
    glb = await readFile(packed); await rename(packed, new URL(file, output));
  }
  if (glb.length > (name === 'serviceTool_brake_lathe_a01' ? 24 : 20) * 1024 * 1024) throw new Error(`Browser asset too large: ${file}`);
  let actorLOD;
  if (name === 'box_corrugated_brown_b08') {
    const actorFile = `${name}-actor.glb`;
    const reduced = spawnSync(process.env.QUEUELAB_ASSET_PYTHON || 'python3', [fileURLToPath(new URL('./simready-to-glb.py', import.meta.url)), fileURLToPath(new URL(root.path, source)), fileURLToPath(new URL(actorFile, output)), 'actor'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: fileURLToPath(new URL('../.private/tools/usd-core-26.11/', import.meta.url)) }, maxBuffer: 1024 * 1024 });
    if (reduced.status !== 0) throw new Error(reduced.stderr || reduced.stdout);
    const data = await readFile(new URL(actorFile, output));
    actorLOD = { file: actorFile, bytes: data.length, sha256: hash(data), modification: 'Source-derived vertex-clustered LOD for repeated work items.' };
  }
  const thumb = tree.find(x => x.type === 'file' && x.path.includes('/.thumbs/256x256/') && x.path.endsWith('.usd_light.png'));
  if (!thumb || thumb.size > 2 * 1024 * 1024) throw new Error(`Missing bounded thumbnail: ${name}`);
  const thumbData = await get(thumb);
  await writeFile(new URL(`${name}.png`, output), thumbData);
  records.push({ name, file, actorLOD, ...(optimization ? { optimization } : {}), ...(textures.length ? { textures } : {}), thumbnail: `${name}.png`, thumbnailSHA256: hash(thumbData), revision, license: metadata.license, creator: 'NVIDIA', source: `https://huggingface.co/datasets/${repo}/tree/${revision}/${name}`, modifications: textures.length ? 'Composed OpenUSD geometry with retained UVs, three source-provided 512px UDIM albedo atlases and material-family PBR; no physics/MDL/4K payloads.' : 'Composed with OpenUSD and converted to GLB; excluded physics/MDL/4K textures; original geometry with local PBR palette, metric scale and shared material batches.', bytes: glb.length, sha256: hash(glb), ...statistics, inputs });
  console.log(JSON.stringify({ asset: name, ...statistics, glbBytes: glb.length, selectedSourceBytes: downloaded }));
}
const retained = process.env.SIMREADY_ONLY ? (previous?.assets ?? []).filter(asset => !choices.includes(asset.name)) : [];
const manifest = { dataset: repo, revision, sourceBudgetBytes: limit, selectedSourceBytes: downloaded, selectedSourceBytesNote: 'Bytes processed in the latest bounded preparation; earlier prepared models may be retained by SIMREADY_ONLY.', fullDatasetDownloaded: false, runtimeRemoteRequests: false, assets: [...retained, ...records] };
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${records.length} assets; source bytes ${downloaded}; no full dataset, texture or duplicate-source download.`);
