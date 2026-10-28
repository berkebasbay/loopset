# Architecture

Loopset is a static React/Three.js application with a headless TypeScript discrete-event engine. There is no simulation backend, account service or remote model upload.

Compatibility identifiers include the `queuelab` package, `queuelab-projects` database, portable/repair format tags, `QUEUELAB_PUBLIC_URL` build setting and `dist-engine/queuelab.js` entry. Preserve these identifiers when changing presentation or branding so stored projects and package entry points continue to work.

| Area | Responsibility |
| --- | --- |
| `src/model` | Model types, validation, numerical fingerprints and explicit editing commands |
| `src/engine` | Event ordering, waiting queues, atomic resource allocation, calendars, keyed sampling and exact metrics |
| `src/experiments` | Independent replications, compatible paired comparisons and finite capacity search |
| `src/worker` | Validated request/response boundaries, progress, cancellation and obsolete-response protection |
| `src/playback` | Bounded reconstruction of a recorded run, separate from calculation |
| `src/scene` | Illustrative world, camera, picking, walking and reversible layout |
| `src/features`, `src/lab` | Contextual controls, full DOM editor, comparisons, experiments and files |
| `src/storage` | Local projects, conflict/recovery protection, portable files and immutable reports |
| `src/ui/messages` | User-visible English copy |

## State boundaries

A project contains its identity, model, layout and optional named scenarios. The model contains the actual process, demand, resources, costs and measurement policies. Layout and viewing preferences are presentation state.

The optional `facility` presentation stores independent asset placements, node artwork references and example-surroundings visibility. It is validated separately from the numerical model and travels through files, history, storage and scenario snapshots. Catalogue availability belongs to rendering, so a safe missing asset reference remains recoverable data. A UI-side immutable presentation snapshot accompanies each accepted run for saving its baseline; it never enters engine `RunResult` or fingerprints.

A calculation seals a copy of the submitted model, actual seed and effective limits. Accepted results remain tied to that snapshot after editing the draft. Cancelled, failed and limited attempts remain separate from completed results and cannot silently enter a comparison or confidence interval.

Field buffers and staged time plans are UI state. Applying a valid command creates one history action; Enter/blur applies ordinary numeric fields and Escape restores their prior value. Display-unit changes never write converted numbers back to the model. Horizon cropping/repetition and distribution replacement require an explicit choice.

## Calculation

Events use exact Number ordering and stable tie-breaks. Requests are ordered per station; the global dispatcher merges feasible station heads and allocates all required resource units atomically. A shared pool, station concurrency and calendar override are independent limits. Started service is nonpreemptive.

Random draws are keyed by the recorded seed and sampling identities. Presentation, frame rate and seeking cannot consume engine draws. The [model guide](MODEL_GUIDE.md) documents horizon, warm-up, queue, routing and metric policies; the [API](API.md) documents reproducibility and budget boundaries.

## Local data

Projects save in IndexedDB for the current browser origin. Save acknowledgment, download request and actual file receipt are separate events. Writes retain comparison context and reject conflicting revisions. Imports are validated before acceptance; unsupported records are preserved, not silently migrated or deleted.

The library scans bounded metadata pages and labels partial searches explicitly. A reviewed saved project is re-read before opening, and an obsolete/unmounted operation cannot replace a newer draft. Downloaded project JSON is the portable backup; run JSON is a report rather than an editable project.

## Rendering and reports

The scene consumes model/layout plus a recorded replay frame. It never decides the numerical result. Staff and visitors are bounded illustrations, not a physical crowd or individual-worker assignment model. A full DOM editing/results path remains available.

The facility layer batches repeated source meshes with instanced rendering. Parsed models have explicit scene leases; only inactive buffers can be evicted. Metadata/thumbnail browsing does not load the whole model library. Failed or pending invisible art does not block visible geometry's hit testing. Async model completion and subsequent layout edits invalidate shadows without applying numerical edits. Download, decoded-resource and rendering costs are separate budgets.

Reports read the selected immutable run, including its status, measurement scope and provenance. Exporting an earlier run never substitutes current draft values. All runtime fonts, models and artwork are served locally with their source licences.

## Reusable templates and empty layouts

An explicit optional `workspaceMode: "layout"` admits a zero-node project for visual design. `validateModel` and the engine remain strict; only project/scenario validation accepts this explicit empty state. Process initialization uses the shared edit/history path.

The separate `loopset-templates` IndexedDB database stores immutable project-JSON snapshots and bounded metadata. Read/write transactions atomically enforce the 50-template and 50-MB limits. Listing reads metadata; use/download validates one payload and creates a fresh document identity while preserving modeled inputs and sampling identities. Existing project storage is not migrated.
