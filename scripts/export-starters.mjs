// Deterministic, synthetic starter projects. No downloads or private input files.
import { build } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const output = path.resolve('.cache/starter-export');
await build({ configFile: false, publicDir: false, logLevel: 'error', build: {
  outDir: output, emptyOutDir: true, target: 'es2022', minify: false,
  lib: { entry: { definitions: 'src/templates/definitions.ts', engine: 'src/engine/index.ts', catalogue: 'src/templates/catalogue.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.mjs` },
} });
const { buildStarter } = await import(pathToFileURL(path.join(output, 'definitions.mjs')).href);
const { simulate } = await import(pathToFileURL(path.join(output, 'engine.mjs')).href);
const { starterTemplates } = await import(pathToFileURL(path.join(output, 'catalogue.mjs')).href);
const seeds = [4207, 4208, 4209], inventory = {}, references = { version: 1, engineVersion: null, rngVersion: null, limits: null, seeds, templates: {} }, files = [];
for (const item of starterTemplates) {
  const project = buildStarter(item.id), text = JSON.stringify(project, null, 2) + '\n';
  inventory[item.id] = { version: 1, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
    objects: project.facility.objects.length, steps: project.model.nodes.length, resources: project.model.resources.length };
  references.templates[item.id] = project.scenarios.map(scenario => ({ id: scenario.id, name: scenario.name, runs: seeds.map(seed => {
    const run = simulate(scenario.model, { seed });
    references.engineVersion = run.engineVersion; references.rngVersion = run.provenance.rngVersion; references.limits = run.provenance.limits;
    if (run.status !== 'completed' || run.trace.complete !== true) throw new Error(`${scenario.id}/${seed}: incomplete starter run`);
    if (run.summary.arrivals !== run.summary.completed + run.summary.inSystem + run.summary.balked + run.summary.reneged) throw new Error(`${scenario.id}: flow conservation failed`);
    return { seed, modelHash: run.modelHash, demandHash: run.demandHash, summary: run.summary };
  }) }));
  files.push([`public/templates/${item.id}.json`, text]);
  if (item.id === 'factory') files.push(['examples/facility.json', text]);
  console.log(item.id, inventory[item.id].objects, 'objects;', references.templates[item.id].map(s => `${s.name}: ${s.runs[0].summary.completed} complete / $${s.runs[0].summary.cost.toFixed(2)}`).join(' | '));
}
files.push(['src/templates/inventory.json', JSON.stringify(inventory, null, 2) + '\n']);
files.push(['public/templates/reference-results.json', JSON.stringify(references, null, 2) + '\n']);
if (process.argv.includes('--check')) {
  for (const [file, text] of files) if (await readFile(file, 'utf8') !== text) throw new Error(`Stale starter output: ${file}`);
  console.log('All starter projects, inventory and reference results match their definitions.');
} else {
  await mkdir('public/templates', { recursive: true });
  for (const [file, text] of files) await writeFile(file, text);
  console.log('Wrote 12 validated starter projects with 24 alternatives and three reference seeds.');
}
