# Portable synthetic examples

These are complete schema-v1 **Project** JSON files accepted by the browser's **Open project JSON** flow and the headless CLI. Every name, arrival pattern, duration and cost is invented.

| File | Story | Seed / horizon |
| --- | --- | --- |
| [factory.json](factory.json) | Machining → quality check → packing; a packing bottleneck and unlimited intermediate waiting buffers | 4207 / 3,600 s |
| [festival.json](festival.json) | A visitor-arrival wave passes three checkpoints; the final waiting queue has 900 s patience | 4207 / 3,600 s |
| [service.json](service.json) | Standard/priority requests share two specialists between two stages; scheduled shared capacity drops to one from 1,800–2,100 s | 4207 / 3,600 s |

Each file keeps a fixed project ID, fixed baseline-scenario ID and fixed `2026-10-20T00:00:00.000Z` fixture timestamp. Model IDs, source/stage sampling IDs, seed and duration settings come from `createExample`. Runtime-created examples use fresh document IDs; those do not affect simulation outcomes.

## Use a file

```sh
npm ci
npm run build:engine
npm run simulate -- examples/factory.json --seed 4207
```

For pure JSON stdout without npm's script banner:

```sh
node scripts/simulate.mjs examples/factory.json --seed 4207
```

The CLI validates the byte limit, UTF-8, JSON structure and shared schema before running the real engine. It does not change the input file. The browser import presents the project for review before replacing the current draft. Fixed fixture document IDs identify fixtures: duplicate a project in the UI to make an independent saved document.

## Regenerate and review

```sh
npm run examples:export
```

`npm run test:headless` checks these fixtures, CLI repeatability, input rejection and safe diagnostics.

The export command builds the engine and calls its exported `createExample`, validates each project and runs the same engine to produce [reference-results.json](reference-results.json). It rewrites only these generated example JSON files. Regenerating twice from the same code produces identical bytes. Review semantic and reference-result changes together; never edit outputs to make a performance story look better.

The reference file records the generating engine/RNG identity, seed, model/demand fingerprints, actual effective run caps and numerical checkpoints. The CLI exposes the canonical `provenance` object for complete and limited runs. These are reproducibility checkpoints from the implementation, not an independent oracle for correctness. Independent engine reference tests remain under `tests/`.

The portable schema is described in the [model guide](../docs/MODEL_GUIDE.md), with runnable [API examples](../docs/API.md). No JSON schema URL is fetched at runtime. There is no unsupported-version migration or implication of real-world calibration.
