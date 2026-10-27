import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url), directory = new URL('public/assets/simready/', root);
const manifestFile = new URL('manifest.json', directory);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const backup = new URL('.private/assets/uncompressed-catalog/', root); await mkdir(backup, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const asset of manifest.assets) {
  const file = new URL(asset.file, directory), data = await readFile(file);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  if (json.extensionsUsed?.includes('EXT_meshopt_compression')) continue;
  await copyFile(file, new URL(asset.file, backup));
  const packed = new URL(asset.file.replace('.glb', '-packed.glb'), directory);
  const result = spawnSync('npm', ['exec', '--yes', '--package=gltfpack@1.3.0', '--', 'gltfpack', '-i', fileURLToPath(file), '-o', fileURLToPath(packed), '-cc', '-ce', 'ext', '-vp', '16', '-vt', '16', '-vn', '12', '-kn', '-km'], { cwd: fileURLToPath(root), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const bytes = await readFile(packed);
  const metadata = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (!metadata.extensionsUsed?.includes('EXT_meshopt_compression')) throw new Error('Missing codec declaration');
  asset.optimization = { tool: 'gltfpack1.3.0', sourceBytes: data.length, sourceSHA256: hash(data), options: '-cc -ce ext -vp16 -vt16 -vn12 -kn -km', intentionalSimplification: false };
  asset.bytes = bytes.length; asset.sha256 = hash(bytes);
  await rename(packed, file);
  console.log(`${asset.file}: ${data.length} -> ${bytes.length} bytes`);
}
manifest.runtimeModelBytes = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Runtime models: ${manifest.runtimeModelBytes} bytes. Repeated actor/character geometry remains uncompressed for CPU animation baking.`);
