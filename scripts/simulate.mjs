#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createExample, parsePortableProject, PROJECT_FILE_LIMIT, simulate } from '../dist-engine/queuelab.js';

const usage = `Usage:
  npm run simulate -- --example factory --seed 4207
  npm run simulate -- examples/festival.json
  node scripts/simulate.mjs path/to/project.json [--seed INTEGER]

Options:
  --example WORLD   factory, festival, or service (instead of a file)
  --seed INTEGER    override the project's safe-integer seed
  --help           show this help

Writes deterministic summary JSON to stdout. No input file is modified.
Build the headless module first with npm run build:engine.
Use node scripts/simulate.mjs directly when piping pure JSON; npm prints a banner.`;

function args(values) {
  let example; let file; let seed;
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--help' || value === '-h') return { help: true };
    if (value === '--example' || value === '--seed') {
      if (seen.has(value)) throw new Error('Each option can be supplied only once.');
      seen.add(value);
      const next = values[++i];
      if (next === undefined) throw new Error('An option value is missing.');
      if (value === '--example') {
        if (!['factory', 'festival', 'service'].includes(next)) throw new Error('Choose factory, festival, or service.');
        example = next;
      } else {
        if (!/^-?\d+$/.test(next) || !Number.isSafeInteger(Number(next))) throw new Error('Seed must be a safe integer.');
        seed = Number(next);
      }
    } else if (value.startsWith('-')) throw new Error('Unknown option. Use --help for usage.');
    else if (file === undefined) file = value;
    else throw new Error('Supply exactly one project JSON file.');
  }
  if (Number(example !== undefined) + Number(file !== undefined) !== 1) throw new Error('Choose either --example WORLD or one project JSON file.');
  return { example, file, seed };
}

async function readProject(file) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); }
  catch { throw new Error('Could not open the input project file.'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Input must be a regular project JSON file.');
    if (stat.size > PROJECT_FILE_LIMIT) throw new Error('Project files are limited to 5 MB.');
    // Bounded read also protects against a file growing between stat and read.
    const bytes = Buffer.alloc(PROJECT_FILE_LIMIT + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > PROJECT_FILE_LIMIT) throw new Error('Project files are limited to 5 MB.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)); }
    catch { throw new Error('Input project must use valid UTF-8.'); }
    return parsePortableProject(text);
  } finally { await handle.close(); }
}

try {
  const options = args(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage}\n`); }
  else {
    const project = options.example ? createExample(options.example) : await readProject(options.file);
    const run = simulate(project.model, { seed: options.seed });
    const result = {
      format: 'queuelab-summary-v1',
      id: run.id, engineVersion: run.engineVersion, rngVersion: run.provenance.rngVersion, provenance: run.provenance,
      modelHash: run.modelHash, demandHash: run.demandHash, seed: run.seed,
      status: run.status, ...(run.reason ? { reason: run.reason } : {}),
      simulatedUntil: run.simulatedUntil, model: run.model,
      summary: run.summary, stations: run.stations, pools: run.pools, classes: run.classes,
      trace: run.trace, processedEvents: run.processedEvents, diagnostics: run.diagnostics, warnings: run.warnings,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (run.status !== 'completed') process.exitCode = 2;
  }
} catch (error) {
  // OS paths and imported values are deliberately excluded from diagnostics.
  process.stderr.write(`Simulation: ${error instanceof Error ? error.message : 'Simulation could not be completed.'}\n`);
  process.exitCode = 1;
}
