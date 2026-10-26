// Offline, allowlisted asset preparation. Never clone/download the full dataset.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = 'nvidia/simready-assets';
const choices = ['furniture_workbench_standard_e01', 'conveyor_belt_a05', 'pallet_a01'];
const source = new URL('../.private/assets/simready/', import.meta.url);
const output = new URL('../public/assets/simready/', import.meta.url);
const limit = 30 * 1024 * 1024;
let downloaded = 0;
const hash = data => createHash('sha256').update(data).digest('hex');
let revision = process.env.SIMREADY_REVISION;
if (!revision) {
  try { revision = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8')).revision; } catch { /* First preparation pins main below. */ }
}
if (!revision) {
  const response = await fetch(`https://huggingface.co/api/datasets/${repo}/revision/main`);
  if (!response.ok) throw new Error(`Dataset metadata: ${response.status}`);
  revision = (await response.json()).sha;
}
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing pinned revision');
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
  const file = `${name}.glb`;
  const conversion = spawnSync(process.env.QUEUELAB_ASSET_PYTHON || 'python3', [fileURLToPath(new URL('./simready-to-glb.py', import.meta.url)), fileURLToPath(new URL(root.path, source)), fileURLToPath(new URL(file, output))], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: fileURLToPath(new URL('../.private/tools/usd-core-26.11/', import.meta.url)) }, maxBuffer: 1024 * 1024 });
  if (conversion.status !== 0) throw new Error(conversion.stderr || conversion.stdout);
  const statistics = JSON.parse(conversion.stdout.trim().split('\n').at(-1));
  const glb = await readFile(new URL(file, output));
  if (glb.length > 14 * 1024 * 1024) throw new Error(`Browser asset too large: ${file}`);
  records.push({ name, file, revision, license: metadata.license, creator: 'NVIDIA', source: `https://huggingface.co/datasets/${repo}/tree/${revision}/${name}`, modifications: 'Composed with OpenUSD and converted to GLB; excluded physics/MDL/4K textures; original geometry with local PBR palette, metric scale and shared material batches.', bytes: glb.length, sha256: hash(glb), ...statistics, inputs });
  console.log(JSON.stringify({ asset: name, ...statistics, glbBytes: glb.length, selectedSourceBytes: downloaded }));
}
const manifest = { dataset: repo, revision, sourceBudgetBytes: limit, selectedSourceBytes: downloaded, fullDatasetDownloaded: false, runtimeRemoteRequests: false, assets: records };
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${records.length} assets; source bytes ${downloaded}; no full dataset, texture or duplicate-source download.`);
