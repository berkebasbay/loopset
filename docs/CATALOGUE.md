# Prepared asset catalogue

The facility library uses attributed browser derivatives of NVIDIA SimReady content. The browser does not compose upstream USD stages, execute asset scripts or require an NVIDIA runtime. Normal installation, building and use need only the committed assets and Node/npm tools documented in CONTRIBUTING.

## Inventory and provenance

`scripts/facility-selection.json` pins an upstream revision and an allowlist of source IDs, intended roles and categories. Selection is an eligibility list, not a count of working simulations or distinct machine behaviors. Model variants remain distinct catalogue entries.

`public/assets/facility/manifest.json` records available derivatives: source ID/revision, metric bounds, source/input hashes, output bytes/hash, thumbnail adaptation, compression and simplification. Reused original assets retain their previous source manifest and revision. The initial-world assets under `simready` and `lod` remain attributed separately.

The public manifest's `excluded` records contain only an ID and a technical reason code. Codes distinguish licence, geometry, source/dependency, preview, distribution-budget and source-availability constraints. A source-availability failure does not prove incompatibility. Detailed local preparation errors are not needed to validate a distribution.

`src/catalog/data.ts` is generated from prepared entries. Only those entries appear as available objects. Project references contain IDs and source revisions, rather than arbitrary fetch URLs. An unavailable reference remains portable data and is explained by the editor; the numerical engine does not import the artwork catalogue to calculate a model.

## Optional source preparation

The current preparation script requires a matching Python installation with the official `usd-core` package, pinned `gltfpack@1.3.0`, and macOS `sips` for bounded source-preview resizing. Set `QUEUELAB_ASSET_PYTHON` and `QUEUELAB_USD_PYTHONPATH` to the matching build-time installation. These tools are not browser/runtime dependencies and are not required to use or build an ordinary checkout.

```sh
npm exec --yes --package=gltfpack@1.3.0 -- gltfpack -h
npm run prepare:facility -- --only=furniture_workbench_modular_a01
npm run prepare:facility -- --retry --only=furniture_workbench_modular_a01
```

Preparation is resumable. It validates package licences and source size/hashes, downloads allowlisted composition files and a bounded preview, checks local layer dependencies, converts source geometry and records each outcome. It does not clone the whole source dataset or fetch a full high-resolution texture library. Only the job's own newly created temporary input directory is released; original archives are not pruned.

Derivatives use static GLB, source-derived material-family PBR, meshopt compression and source-derived LOD with an explicit simplification error bound. They do not reproduce source MDL, physics, animation or sensor behavior. The source-derived preview and rendered browser material can differ; provenance records these adaptations.

Current preparation budgets include 200 MiB of selected sources per asset, 120 MiB per source file, 96 USD dependencies, a 2 MiB library model, and bounded native-tool times. Prepared models and thumbnails must fit the checked distribution budget. Download bytes are distinct from decoded memory and rendering cost.

## Verification

```sh
npm run check:assets
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:headless
```

`check:assets` runs in a clean checkout without private preparation logs. It checks the public manifest/selection accounting, model and preview files, source links and hashes, self-contained geometry, declared buffer bounds, actual meshopt decoding, finite vertices/indices and metric bounds. Broad-catalogue/category coverage prevents an empty or heavily excluded inventory from passing as a completed catalogue. Reused unchanged initial-world models retain their existing provenance.

The app still runs calculations locally. Static distribution size and traffic are separate hosting constraints; expanding the catalogue does not create a simulation backend or make unlimited hosting capacity a product guarantee.
