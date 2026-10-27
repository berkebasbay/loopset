# Model guide

Loopset models discrete-event flow through a network of process steps. Positions make a readable miniature world; event rules, durations and capacities determine numerical results. The examples are invented teaching models, not calibrated industrial forecasts.

## Portable project schema v1

The portable unit is a UTF-8 JSON **Project**, not just a model. Complete, validated files are checked in under [`examples/`](../examples/README.md). The TypeScript contract in [`src/model/types.ts`](../src/model/types.ts) and runtime checks in [`src/model/validate.ts`](../src/model/validate.ts) define the accepted schema.

| Project field | Meaning |
| --- | --- |
| `schemaVersion` | Exactly `1`; unsupported versions stop without rewriting the file |
| `id`, `name`, `description` | Document identity and human-readable context |
| `world` | `factory`, `festival` or `service`; visual world selection |
| `revision` | Nonnegative safe integer; advances when document content changes |
| `model` | The engine's numerical contract |
| `layout` | Node ID → `{ x, z }`, bounded presentation coordinates |
| `savedAt` | Optional valid date string for a browser save |
| `scenarios` | Optional list of up to 20 named model/layout snapshots |

Models retain `id`, `name`, `nodes`, `resources`, `horizon`, `warmup`, `seed`, `slaSeconds` and a three-letter uppercase `currency` label. Time is in **seconds**, arrival rates are per **hour**, costs are per **unit-hour**. Changing a currency label does not convert prices.

Use 2–100 process nodes, at most 50 resource pools and a horizon greater than 0 and at most 31,536,000 seconds (365 days). The Run & project editor accepts seconds, minutes, hours or days for run length; this display choice never changes the stored time unit. Warm-up must be nonnegative and less than the horizon. Seeds are safe integers. Node/pool/class/sampling identities use 1–64 ASCII letters, digits, underscores or hyphens and begin with a letter or digit; unsafe prototype-related names are rejected. Validation reports broken references, probability sums and possible zero-time loops rather than silently repairing them.

Project JSON is limited to 5,000,000 bytes. Imports validate UTF-8, structure, nesting and schema before applying a project. The CLI and public `parsePortableProject` are suitable file boundaries; lower-level `parseProject` performs JSON/schema checks only. There is no version migration or remote schema fetch.

## Process steps

Every node has `id`, `samplingId`, `label` and `kind`.

| Kind | Configuration and behavior |
| --- | --- |
| `source` | Arrival pattern, weighted classes, and `next`; creates external work |
| `queue` | `next` must be one service; finite waiting `capacity` or `null`, FIFO/priority, optional patience |
| `service` | Positive duration, parallel `servers`, atomic pool requirements, and `next` |
| `route` | Weighted `{ to, probability }` branches summing to one |
| `delay` | Nonnegative duration and `next`; models explicit transfer/holding time |
| `sink` | Completes an entity |

Each service can have at most one explicit waiting queue. Merge flows before that queue. A direct transition to a service has an implicit zero waiting buffer: work starts immediately if feasible, otherwise it balks. Queue capacity counts only waiting work; busy work does not use a waiting slot. Capacity zero still allows immediate service.

Classes have a probability and integer priority. Lower numeric priority is served first in a priority queue; FIFO ignores that ranking. Class IDs with the same value at multiple sources are combined in class results. Running service is nonpreemptive. Feasible-first resource dispatch may let a later feasible job bypass an earlier job that cannot acquire all its required resources; a diagnostic counts these bypass events. There is no reservation, priority aging or starvation guarantee.

## Arrivals and distributions

Arrival patterns:

- `fixed`: arrivals at time 0 and multiples of `3600 / perHour`; zero rate creates no arrivals.
- `poisson`: ordered, nonoverlapping `{ start, end, perHour }` periods; integrated exponential hazard respects rate changes and zero-rate gaps. Outside defined periods the rate is zero.
- `schedule`: 0–100,000 ordered exact timestamps in `[0, horizon)`; duplicate timestamps are allowed.

Fixed and Poisson arrival rates accept 0–10,000,000 entities/hour. Finite queues accept up to 10,000,000 waiting places; unlimited queues remain available. These are input bounds, not a guarantee that every combination fits device memory or the per-run calculation limits.

Source classes and route branches are sampled using their probabilities; each set must sum to one. At most 20 classes per source and 100 route branches are accepted. Rate/calendar lists are limited to 200 periods.

Service durations are strictly positive. Delay and patience can include zero where their distribution permits it.

| Distribution | Fields | Interpretation |
| --- | --- | --- |
| `constant` | `value` | One duration |
| `exponential` | `mean` | Positive mean; sampled duration has an unbounded tail |
| `triangular` | `min`, `mode`, `max` | Minimum ≤ most likely ≤ maximum |
| `empirical` | `values` | 1–10,000 duration samples, sampled with replacement |

Configured means, triangular bounds and empirical samples are bounded at seven days. This does not truncate exponential samples at that bound. A positive duration that cannot advance representable numerical time produces a failed run instead of a silent zero-time event.

## Resources and calendars

A service has 1–1,000 parallel servers and up to 10 distinct pool requirements. All required units are allocated atomically with a free server. A resource pool has installed capacity (1–1,000), base scheduled capacity (0–installed), regular and overtime unit-hour rates, and ordered nonoverlapping calendar overrides.

Calendar periods are half-open `[start, end)` intervals within the horizon. Their capacity overrides the base capacity; gaps revert to base. Already-running work completes when scheduled capacity falls, even if that temporarily creates overtime. New work cannot allocate above the current schedule. A service-server limit remains in force independently of pool capacity.

Cost is scheduled unit-seconds / 3600 × regular rate plus overtime unit-seconds / 3600 × overtime rate. This is a simple modeled resource cost, not payroll/accounting. Pool normal utilization excludes overtime from the numerator and is null if scheduled area is zero; station utilization uses its server count and observed duration.

## Event ordering and horizon

At an exact timestamp the engine releases all completions, applies calendar changes, advances arrivals/routes/delays to quiescence, dispatches globally feasible work, admits waiting requests or records balking, then processes surviving patience deadlines. Ties use priority, request time, source sampling identity, numeric arrival ordinal and service sampling identity. A service opportunity at a patience deadline can therefore serve a request before it abandons.

External arrivals occur in `[0, T)`. At the horizon `T`, existing completions/transfers/calendar changes and patience expiration are processed, but no new service begins. The engine does not drain remaining work after `T`. Conservation is arrivals = completed + balked + reneged + still in system, within the stated cohort. No collision avoidance, stock assembly, conveyor capacity, upstream blocking, batching or worker-to-worker handoff is inferred from the scene.

## Measurement and interpretation

The external-arrival cohort is `[warmup, horizon)`. Summary/class arrival counts and outcomes refer to that cohort, observed through the actual simulated end. Summary wait and sojourn include only completed cohort entities. Unfinished/abandoned work is censored; it is not a zero-wait observation. `waitSampleSize` must accompany a mean or percentile. Empty samples use numeric zero as a placeholder. Zero-denominator rates/utilizations are null.

Station waits use finished service visits from the cohort. That station's sample can include work that has not yet completed the entire system. Time-weighted queue/busy/pool areas and costs cover all work in the observed measurement window, including arrivals before warm-up. Cohort in-system counts and all-physical-work diagnostics therefore answer different questions.

The SLA numerator is completed cohort entities with total waiting within `slaSeconds`; its denominator is **all** cohort arrivals, including unfinished/balked/reneged work. Quantiles use nearest rank. P95 is a distribution percentile, not an uncertainty interval. A single completed run has no confidence interval; independent replications estimate sampling uncertainty. The wait estimate excludes repetitions without completed observations. [Experiment API](API.md)

Full numerical completion and full replay retention are separate. Retained detail stops at its bound while metrics continue. Replay only the committed prefix through `trace.until`; inspect `trace.complete`. A cancelled/limited/failed run is partial and cannot enter completed-run comparisons or estimates.

## Reproduce and branch a model

Keep the exact model snapshot, `engineVersion`, `RNG_VERSION`, actual run seed and measurement/limit options. The current keyed RNG is `keyed-murmur32-v1`: draw keys include source sampling ID, external arrival ordinal, stage sampling ID, visit ordinal and draw kind. Rendering, labels and layout cannot consume random draws.

Node IDs identify graph references; `samplingId` values identify corresponding random stages. Preserve sampling IDs across intended same-input alternatives. Changing one deliberately changes its coupled stream. Array order is canonicalized for identity and dispatch where applicable; keep resource/class/route semantics equal when expecting a matched run.

`modelHash` excludes labels, document metadata, layout and configured seed. The result stores seed separately. `demandHash` identifies external source definitions, horizon and seed. Both are reproducibility fingerprints rather than tamper-proof signatures. Equal demand is necessary for paired comparisons; matching measurement/currency policies is also required. It does not imply arbitrary new stages have identical samples.

Editing the model makes an earlier result a stored snapshot, not a preview of the new draft. Saved scenarios retain their own model/layout; restoration advances the document revision. Runtime-created documents have unique IDs, while checked-in examples use fixed metadata for reviewable regeneration.

## CSV inputs

Arrival CSV:

```csv
arrival_seconds
0
12.5
30
```

Exactly one column; timestamps must be nonnegative, ordered and before the current horizon. Applying it replaces the selected source's arrival pattern with the exact schedule.

Service CSV:

```csv
service_seconds
15
22.5
30
```

Exactly one column with positive samples up to 604,800 seconds. Applying it replaces the selected service duration with empirical sampling with replacement. Files are UTF-8 and at most 5 MB; quoting, BOM and common line endings are supported. Decimal commas, exponents, formulas, extra columns, blank data rows, malformed quotes and invalid rows are rejected. No values are sorted or skipped automatically.

Review the target and preview before applying. These imports define a model; they do not by themselves establish that sampled data represent a real operation.
