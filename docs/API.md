# Headless API

The headless entry point exports the same engine and synthetic example factories used by the application. It has no DOM, React, Three.js, IndexedDB or network imports. Node.js 24 provides the standard globals used for cloning, encoding, timing and unique document IDs.

## Build and import

```sh
npm ci
npm run build:engine
npm run test:headless
```

Output is `dist-engine/queuelab.js` (ES module), `dist-engine/types/` (TypeScript declarations) and license notices. Declarations use explicit relative `.js` specifiers so TypeScript's NodeNext and bundler resolution can consume them. The build uses the already-installed TypeScript and Vite; it adds no runtime dependency.

From an ES module in the checkout:

```js
import { createExample, simulate } from './dist-engine/queuelab.js';

const project = createExample('factory');
const run = simulate(project.model, { seed: 4207 });
if (run.status !== 'completed') throw new Error(run.reason);
console.log(run.summary.completed, run.summary.meanWait);
```

The package's `queuelab` and `queuelab/engine` exports point to that bundle and its declarations. They work as package self-references after building, and in a fork installed as a local package. The package remains `private: true`; there is no npm-registry publication command.

## Export surface

| Exports | Purpose |
| --- | --- |
| `simulate`, `simulateAsync` | Synchronous / cooperatively yielding execution of one model |
| `runExperiment`, `runExperimentAsync` | Independent replications with explicit seeds |
| `comparePaired`, `capacitySearch`, `estimate` | Matched-input differences, finite candidate search, Student-t estimates |
| `validateModel`, `validateProject`, `assertModel` | Schema and semantic validation |
| `parsePortableProject`, `PROJECT_FILE_LIMIT` | Bounded project JSON text boundary for external input |
| `parseProject` | Lower-level JSON + shared schema validation; use `parsePortableProject` for external files |
| `canonical`, `fingerprint`, `modelHash`, `demandHash` | Canonical serialization and reproducibility fingerprints |
| `normalizeRunLimits`, `buildCouplingManifest` | The engine's effective numeric caps and a static source/stage coupling description for two sealed runs |
| `arrivalExpectation`, `calculationBudget`, `capacitySearchPlan` | Pre-run arrival expectations, normalized work caps and the same validated search count used by execution |
| `createExample`, `WORLD_INFO` | Synthetic `factory`, `festival`, `service` worlds |
| `mutateProject`, `setCapacity`, `serviceNodes`, `meanDuration`, `duplicateProject` | Project edits and common station operations |
| `saveScenario`, `restoreScenario`, `removeScenario` | Named local model/layout snapshots inside a project |
| `SCHEMA_VERSION`, `ENGINE_VERSION`, `RNG_VERSION` | File, engine and random-generator identities |
| Model/result/experiment types | The complete TypeScript contract from `src/model/types.ts` and search types |

`createExample` and `duplicateProject` generate fresh document IDs. `saveScenario` generates an ID and current creation time. Those metadata fields do not affect simulation draws. Checked-in example fixtures deliberately use fixed project/scenario IDs and a fixed creation time; see [examples](../examples/README.md).

`setCapacity(project, stationId, capacity)` changes parallel servers and scales a dedicated single-unit resource pool. Shared pools remain separately managed. For precise custom edits, use `mutateProject`; validate the result before calculation. Edits clone their input and advance project revision. The engine clones the input model before executing it.

## Validate external project files

```js
import { readFile } from 'node:fs/promises';
import { parsePortableProject, PROJECT_FILE_LIMIT, simulate } from 'queuelab';

const bytes = await readFile('examples/factory.json');
if (bytes.byteLength > PROJECT_FILE_LIMIT) throw new Error('File too large');
const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const project = parsePortableProject(text);
const result = simulate(project.model);
```

For an untrusted file, bound the read itself as the CLI does; checking after an unbounded `readFile` does not bound allocation. `parsePortableProject` accepts a UTF-8 BOM, limits encoded text to 5,000,000 bytes, rejects malformed JSON, nesting beyond 40, unsafe prototype-related keys, invalid surrogate strings/keys, invalid save timestamps, unsupported schema versions and shared-model validation errors. Its errors do not echo imported names or values. It does not modify the source file or invent a migration.

The library takes already-decoded text. Use a fatal UTF-8 decoder at a byte boundary. `validateModel` / `validateProject` return issues and do not make an unchecked value safe to execute. `assertModel` throws on model errors; both simulation entry points call it.

## One run

```ts
simulate(model: SimulationModel, options?: RunOptions): RunResult
simulateAsync(model: SimulationModel, options?: RunOptions): Promise<RunResult>
```

`RunOptions` supports a seed override, `maxEvents` (charged execution work), `maxEntities`, `maxMicrosteps`, `maxTraceEntities`, `maxTraceEvents`, `onProgress(fraction)` and `shouldCancel()`. Limits must be integers within the engine's allowed bounds. Invalid models/options throw. Runtime/numerical failure returns `failed`; work/entity/microstep limits return `limited`; cancellation returns `cancelled`. Inspect status before using a result in comparisons.

| Budget | Default | Maximum accepted |
| --- | ---: | ---: |
| `maxEvents` | 1,000,000,000 | 1,000,000,000 |
| `maxEntities` | 10,000,000 | 10,000,000 |
| `maxMicrosteps` | 1,000,000 | 1,000,000 |
| `maxTraceEntities` | 4,000 | 100,000 |
| `maxTraceEvents` | 100,000 | 1,000,000 |

Zero is accepted for these limits. Setting trace limits to zero disables retained detail; it does not disable full metrics. `processedEvents` counts work including transitions and admission attempts, not just semantic trace events. Count bounds are not a measured byte/heap guarantee. Engine 0.1.2 keeps waiting requests in balanced ordered queues and charges actual dispatch/admission work rather than repeatedly scanning blocked backlogs. Replay limits stay unchanged; high-volume full metrics do not require retaining every entity. Large simultaneous backlogs still consume device memory.

`simulateAsync` uses the same execution generator and yields a task after 256 bounded work units, including within a timestamp. It enables progress/cancellation in a worker; it does not create a worker by itself. A callback is checked synchronously within the engine. On the main thread, use the async API to let external input update cancellation state.

`RunResult` contains the copied model, run ID, model/demand fingerprints, engine version, actual seed, status/reason, simulated end, summary/station/pool/class metrics, diagnostics, bounded entity/event detail, trace coverage and warnings. `provenance.rngVersion` records the actual generator version; `provenance.limits` retains all five effective numeric caps after the same normalization used by the engine. Zero remains a literal cap. Callbacks are never serialized. `elapsedMs` is wall-clock instrumentation and is not reproducible. Seed overrides live in `result.seed`; the copied model retains its originally configured `model.seed`.

The run ID fingerprints engine version, semantic model and seed. It identifies modeled inputs, not a unique execution attempt or trace/work-budget configuration. Fingerprints are FNV-based identity aids, not security signatures. Preserve exact snapshots and versions rather than trusting a hash as proof of integrity.

`normalizeRunLimits(options?)` exposes the same immutable five-cap normalization used for execution, including defaults and range rejection. It does not run the model, estimate duration or guarantee heap use. Completed and partial results, CSV/HTML reports and PNG cards retain the effective caps. The CLI retains this canonical object as `provenance` and keeps its existing `rngVersion` alias. Cancel-callback timing is external; a recorded budget does not reproduce an arbitrary wall-clock cancellation by itself.

### Work before execution

`arrivalExpectation(model)` returns `{count, stochastic}` for external arrivals in the full half-open `[0,horizon)` interval, including warm-up. Fixed schedules/rates count their planned arrivals; Poisson periods contribute their integrated expectation. Realized random counts, capped execution, visits, queue work and completions can differ. This helper validates the model and never runs the engine.

`calculationBudget(groups, options?, conditionalRuns=0)` takes `{label, model, runs}` groups for the largest planned execution. It returns each group's arrival expectation, normalized per-run limits, minimum/maximum run counts and `maximumRuns × maxEvents` as the upper work-unit budget. Conditional runs are removed only from the minimum count. Counts are bounded to1–1,000 model runs in total; these figures are not duration or whole-memory predictions. Experimental UI plans use zero trace retention while retaining complete numerical results.

`capacitySearchPlan(model, spec)` validates the same pool, candidate/seed/constraint/run-budget rules as `capacitySearch`, then returns `{minimumRuns, maximumRuns, runBudget}` without computing candidates. The minimum is all training runs; the maximum also includes held-out verification if a candidate is selected. Runtime retention and numerical failure checks still apply when execution begins. The browser submits the same prepared request it displays in preflight.

The experiment panel's completed receipt records actual model-run count, summed processed work units, an execution UUID and local elapsed milliseconds from immediately before worker-client execution through accepted response validation. It remains attached to the accepted result across draft edits and later cancelled/failed attempts. Timing is local instrumentation, excluded from reproducible run identity; it is not a forecast of the next run.

## Replay coverage and statistics

`status === 'completed'` means numerical execution reached the requested horizon. `trace.complete` separately describes detailed replay. When trace retention saturates, `trace.until` freezes at the last complete timestamp transaction. Do not replay an incomplete tail or infer a complete world from retained entities' final statuses. Incomplete runs are partial observations even if some summary values look plausible.

The application presentation module `src/playback` provides `frameAt(project, result, time)` and `replayManifest(result)`. It is separate from the headless engine bundle. Seeking consumes recorded events; it never runs the model again or adds modeled travel time. `WorldFrame` retains its existing counters, null-prototype queue/busy maps and representative actors: up to 24 per node/state, round-robin across groups, at most 500 in total. Counters still use every covered entity. Frames are detached from cached state.

`replayManifest` is immutable metadata with:

- `coverage`: closed seekable intervals. The current engine supplies one `[0, trace.until]` prefix or no interval. An incomplete trace ending at 0 is unavailable, even if part of that unfinished timestamp was retained.
- `checkpoints`: an empty `origin` before the first timestamp, followed by `sealed-timestamp` states after complete timestamp groups; metadata includes time, event offset and active count, never the private actor state.
- `segments`: following retained-event ranges `[eventStart, eventEnd)`, with their checkpoint index and time bounds. A normal checkpoint includes its timestamp; its following segment consumes later timestamps through its endpoint. The explicit origin precedes events at 0.
- `coveredEvents`, `traceComplete`, `limits` and separate `accounting` for checkpoint copies, priority lookup and peak active cursor state.

The actual seek path binary-searches the event target/checkpoint and consumes the following segments. A single forward cursor avoids restarting from origin during playback. Defaults target 2,048 events per checkpoint, at most 32 checkpoints including origin, at most 50,000 copied checkpoint actor records and 8 MiB estimated checkpoint allocation. A large timestamp or copy budget may produce fewer checkpoints and longer segments; it does not invent missing coverage. The cursor and retained-entity priority lookup have separate reported bounds. Build reuses the cursor rather than retaining a second full active map. Accounting estimates are not measured browser heap, total-memory or latency guarantees.

The cache uses the actual `RunResult` object, because one run ID can have different trace/work limits. Replacing event/entity arrays or coverage/cap metadata invalidates it. Inputs must remain sealed; in-place mutation is outside this internal contract. Neither model/input distributions nor the raw numerical result/trace are cloned or modified. Layout, labels and seek order do not change calculation results.

The browser shows lazy **Replay coverage** and optional index evidence inside recorded run settings. Unavailable replay disables the timeline while complete numerical exports remain available. Range controls select the exact recorded endpoint even if the browser rounds its serialized value; the engine uses no endpoint tolerance. This presentation index is not embedded in portable projects or worker messages.

Summary waiting/sojourn samples use completed entities whose external arrivals lie in `[warmup, horizon)`. Unfinished and abandoned work is censored, never inserted as zero waiting. Inspect `waitSampleSize`; a numeric zero with zero observations is a placeholder. Time-weighted areas and resource costs include all work in the observed measurement window. Station waits use completed station visits, which can differ from full-system completions. [Detailed model semantics](MODEL_GUIDE.md)

## Replications and paired comparisons

```js
import { createExample, setCapacity, runExperiment, comparePaired } from 'queuelab';

const baseline = createExample('factory');
const candidate = setCapacity(baseline, 'station-c', 2);
const seeds = [4207, 4208, 4209, 4210];
const experiment = runExperiment(baseline.model, seeds);
const comparison = comparePaired(baseline.model, candidate.model, seeds);
console.log(experiment.wait, comparison.paired, comparison.delta.wait);
```

Each candidate retains one frozen model snapshot shared by its runs. Treat results as immutable and clone a model before editing it. Structured cloning to the UI preserves these shared references; ordinary JSON serialization repeats references and can produce a larger document. A shared 32 MiB UTF-8 serialized-retention budget covers unique snapshots and run metadata across a repetition, paired comparison or search. Oversized candidate sets are rejected before simulation, and incremental output is checked before accepting estimates. This guard is not a browser heap, worker RAM or GPU-memory guarantee. Reduce input samples, candidates, runs or explicitly requested traces if it rejects a job.

Use 1–100 distinct safe-integer seeds. Replications execute sequentially, default to zero trace retention and reject incomplete runs from estimates. `MetricEstimate` exposes mean, standard error, lower/upper 95% confidence bounds and observation count. Bounds are null for fewer than two observations. Wait estimates exclude runs with no completed-cohort samples; their observation count may be smaller than the number of seeds. P95 estimates average each replication's P95; they are not pooled-entity percentiles.

Paired comparisons require equal external-demand fingerprints for each seed and equal horizon, warm-up, SLA and currency policies. Deltas are candidate minus baseline. When pairing is unavailable, `paired` is false, `reason` explains why, and deltas have zero observations/null uncertainty. Wait deltas exclude pairs lacking observed completed waits in either run. Matching demand does not make new/removed stage draws identical: preserve corresponding `samplingId` values for intended coupling.

`PairedComparison.coupling` retains a bounded static manifest from the two sealed model snapshots. The same description can be obtained with `buildCouplingManifest(baselineRun, candidateRun)` without running more simulations. It lists matched source/stage identities, each side's draw kinds, potential shared raw kinds, changed definitions, unmatched identities/kinds, generator/seed/demand/measurement compatibility, exact key-tuple scope and caveats. A graph-node rename with a retained sampling identity is distinguished from a new stream. Full input distributions remain in the two model snapshots rather than being copied into the manifest.

This describes possible common random inputs, not an executed-draw log or observed matched-visit counts. Corresponding source identity, actual seed, arrival ordinal, stage identity, per-entity visit ordinal and draw kind are needed for a common stage key. Changed distributions can transform the same uniform differently; routing, queueing, resources and stops can change which visits occur. Matched components with no random draws do not imply shared samples. The manifest is retained even when the measured runs are ineligible for paired deltas, and it is included in the experiment's shared32MiB retention accounting.

## Bounded capacity search

```js
import { createExample, capacitySearch } from 'queuelab';
const project = createExample('factory');
const search = capacitySearch(project.model, {
  poolId: 'team-c', capacities: [1, 2, 3],
  trainingSeeds: [1001, 1002, 1003],
  verificationSeeds: [2001, 2002, 2003],
  targetCompleted: 30, maxMeanWait: 1200, maxRuns: 32,
});
console.log(search.selectedCapacity, search.verified, search.reason);
```

Search changes the selected pool's base capacity, not service-server concurrency or explicit calendar periods. The factory's packing service still has one server in this example; a resource-only increase can therefore leave its bottleneck unchanged. Model the intervention you mean to test.

Search accepts 1–32 distinct capacities within installed capacity and disjoint training/verification seeds. It chooses the cheapest training-feasible candidate, then runs independent held-out verification; `verified` can be false. The default run budget is 256; the maximum is 1,000. Constraints apply to sample means, not guaranteed real-world service levels. No global optimum is claimed. Comparison and search are synchronous; run them in a worker or a Node process for larger workloads.

## CLI contract

```sh
npm run simulate -- --example factory --seed 4207
npm run simulate -- examples/festival.json
node scripts/simulate.mjs --help
```

Choose one built-in world or one portable **Project** JSON file. A bare `SimulationModel`, malformed UTF-8/JSON, unsupported schema, unsafe key, oversized file or invalid model is rejected. No input or output path is logged. The default output is stdout; npm itself prints script banners, so use `node scripts/simulate.mjs …` or `npm --silent run simulate -- …` for clean JSON.

The `queuelab-summary-v1` output contains the exact model, run identity, generator identity, status, numerical metrics, trace coverage and warnings. It omits entity/event detail and nondeterministic elapsed time. Same engine, model, seed and default limits produce byte-identical CLI output. Exit codes: `0` completed/help, `1` argument/input error, `2` limited/cancelled/failed simulation (partial JSON still emitted). No files are written unless the caller explicitly redirects stdout.
