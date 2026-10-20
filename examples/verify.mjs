// Headless distribution contract checks using only Node's standard library.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createExample, parsePortableProject, simulate } from '../dist-engine/queuelab.js';

const run = args => spawnSync(process.execPath, ['scripts/simulate.mjs', ...args], { encoding: 'utf8' });
const baseline = run(['--example', 'factory', '--seed', '4207']);
assert.equal(baseline.status, 0);
assert.equal(baseline.stderr, '');
assert.equal(run(['examples/factory.json', '--seed', '4207']).stdout, baseline.stdout);
assert.equal(run(['--example', 'factory', '--seed', '4207']).stdout, baseline.stdout);
assert.notEqual(run(['--example', 'factory', '--seed', '4208']).stdout, baseline.stdout);
const summary = JSON.parse(baseline.stdout);
assert.equal(summary.status, 'completed');
assert.equal(summary.summary.arrivals, 80);
assert.equal(summary.summary.completed, 40);
assert.equal(summary.summary.cost, 74);

const references = JSON.parse(await readFile(new URL('reference-results.json', import.meta.url), 'utf8'));
for (const world of ['factory', 'festival', 'service']) {
  const execution = run([`examples/${world}.json`]);
  assert.equal(execution.status, 0);
  const actual = JSON.parse(execution.stdout);
  const expected = references.examples[world];
  assert.equal(actual.engineVersion, references.engineVersion);
  assert.equal(actual.rngVersion, references.rngVersion);
  for (const key of ['seed', 'modelHash', 'demandHash']) assert.equal(actual[key], expected[key]);
  for (const key of ['arrivals', 'completed', 'inSystem', 'meanWait', 'cost']) assert.equal(actual.summary[key], expected[key]);
}

for (const args of [[], ['--example', 'unknown'], ['--example', 'factory', '--seed', '1.5'],
  ['--example', 'factory', '--seed', '9007199254740992'], ['--example', 'factory', '--seed'],
  ['--example', 'factory', '--example', 'service'], ['--example', 'factory', 'examples/factory.json'], ['--unknown']]) {
  const execution = run(args);
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, '');
}

await mkdir('.cache', { recursive: true });
const folder = await mkdtemp(resolve('.cache/headless-check-'));
const project = createExample('factory');
const invalid = [
  ['malformed.json', '{sensitive-fixture-value'],
  ['version.json', JSON.stringify({ ...project, schemaVersion: 99 })],
  ['schema.json', JSON.stringify({ ...project, model: { ...project.model, horizon: -1 } })],
  ['unsafe.json', '{"__proto__":{"value":"sensitive-fixture-value"}}'],
  ['unicode.json', '{"name":"\\ud800"}'],
  ['key-unicode.json', '{"\\ud800":0}'],
  ['deep.json', '['.repeat(42) + '0' + ']'.repeat(42)],
  ['utf8.json', Buffer.from([0xc3, 0x28])],
  ['oversized.json', ' '.repeat(5_000_001)],
  ['bare-model.json', JSON.stringify(project.model)],
];
for (const [name, content] of invalid) {
  const path = resolve(folder, name);
  await writeFile(path, content);
  const execution = run([path]);
  assert.equal(execution.status, 1, name);
  assert.equal(execution.stdout, '');
  assert(!execution.stderr.includes(path));
  assert(!execution.stderr.includes('sensitive-fixture-value'));
}
const missing = run([resolve(folder, 'private-missing-name.json')]);
assert.equal(missing.status, 1);
assert(!missing.stderr.includes('private-missing-name'));
assert.equal(run([folder]).status, 1);
const bom = resolve(folder, 'bom.json');
await writeFile(bom, '\ufeff' + JSON.stringify(project));
assert.equal(run([bom]).status, 0);
const partialProject = structuredClone(project);
partialProject.model.nodes.find(node => node.kind === 'source').arrival = { kind: 'schedule', times: Array(10_001).fill(0) };
const partialPath = resolve(folder, 'partial.json');
await writeFile(partialPath, JSON.stringify(partialProject));
const partial = run([partialPath]);
assert.equal(partial.status, 2);
assert.equal(JSON.parse(partial.stdout).status, 'limited');
assert.equal(parsePortableProject(JSON.stringify(project)).schemaVersion, 1);
assert.throws(() => parsePortableProject('{"name":"\\ud800"}'), /Unicode/);
assert.equal(simulate(project.model, { maxEvents: 1 }).status, 'limited');

const bundle = await readFile(new URL('../dist-engine/queuelab.js', import.meta.url), 'utf8');
assert(!/^import\s/m.test(bundle), 'Standalone bundle must not import runtime dependencies.');
assert(!/\b(?:document|indexedDB|window)\s*\.\s*[A-Za-z_$]/.test(bundle), 'Headless bundle must not access browser globals.');
process.stdout.write('Headless contracts passed: three examples, repeatability, file/schema bounds, safe diagnostics and standalone bundle.\n');
