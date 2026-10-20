import { mkdir, writeFile } from 'node:fs/promises';
import { createExample, parsePortableProject, simulate, RNG_VERSION } from '../dist-engine/queuelab.js';

const folder = new URL('../examples/', import.meta.url);
await mkdir(folder, { recursive: true });
const references = { engineVersion: undefined, rngVersion: RNG_VERSION, examples: {} };
for (const world of ['factory', 'festival', 'service']) {
  const project = createExample(world);
  // Runtime examples get unique document identities; checked-in fixtures are stable.
  project.id = `${world}-example`;
  project.revision = 0;
  delete project.savedAt;
  project.scenarios = [{
    id: `${world}-baseline`, name: 'Baseline', createdAt: '2026-10-20T00:00:00.000Z',
    world, model: structuredClone(project.model), layout: structuredClone(project.layout),
  }];
  const text = `${JSON.stringify(project, null, 2)}\n`;
  parsePortableProject(text);
  const run = simulate(project.model);
  if (run.status !== 'completed') throw new Error(`Synthetic ${world} example did not complete.`);
  references.engineVersion = run.engineVersion;
  references.examples[world] = {
    seed: run.seed, modelHash: run.modelHash, demandHash: run.demandHash,
    arrivals: run.summary.arrivals, completed: run.summary.completed,
    inSystem: run.summary.inSystem, meanWait: run.summary.meanWait, cost: run.summary.cost,
  };
  await writeFile(new URL(`${world}.json`, folder), text);
}
await writeFile(new URL('reference-results.json', folder), `${JSON.stringify(references, null, 2)}\n`);
process.stdout.write('Regenerated three synthetic projects and their engine reference results.\n');
