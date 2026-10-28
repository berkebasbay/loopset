# Contributing to Loopset

Useful contributions make process questions easier to model, explain or reproduce. Small synthetic examples, independently reasoned engine tests, clearer editing, accessible interactions and focused bug fixes are welcome.

## Choose a contribution

| Contribution | Start here | Include in the proposal or pull request |
| --- | --- | --- |
| A starter or experiment | [Template guide](docs/TEMPLATES.md), `src/templates/definitions.ts`, `src/templates/presentation.ts`, `src/templates/catalogue.ts`, `src/ui/messages/starterTemplates.ts` | One process question, explicit synthetic assumptions, an original plan and two meaningful alternatives; explain which inputs change and why |
| An engine test or fix | `src/engine`, `src/experiments`, [model contract](docs/MODEL_GUIDE.md), [engine API](docs/API.md) | A minimal model plus an analytical timeline, independent reference or invariant that establishes the expected result |
| An editing or accessibility improvement | `src/features`, `src/lab`, `src/ui/messages`, [workspace guide](docs/UX_GUIDE.md) | Reproducible actions, expected behavior, and relevant keyboard, focus, Undo/Redo and narrow-screen checks |
| A guide or example clarification | `docs`, `examples/README.md` | The confusing task or assumption, a concrete correction, and checked commands or UI labels |

Search existing issues first. For a larger change or a new starter, open an [issue](https://github.com/berkebasbay/loopset/issues/new/choose) with the problem, proposed scope and expected evidence before writing substantial code. A focused fix can come directly as a pull request with reproduction steps. Proposals are reviewed for fit, correctness, accessibility and maintenance; opening a PR does not guarantee acceptance.

## Start locally

Use Node.js 24 and the committed npm lockfile:

```sh
npm ci
npm run setup:hooks
npm run dev
```

No backend, account or API key is required. Use invented data in issues, tests, screenshots and examples. Keep customer files, personal information, credentials, browser profiles and raw local logs out of contributions.

## Change a starter template

The collection currently contains twelve starters, each with an original plan and two alternatives. Edit the source definitions and presentation, then regenerate the portable projects:

```sh
npm run templates:export
npm run check:templates
```

The exporter validates all 36 plans and writes `public/templates/*.json`, `src/templates/inventory.json`, three reference seeds per plan in `public/templates/reference-results.json`, and the Factory fixture in `examples/facility.json`. Check mode compares these outputs with their definitions; CI runs it. Change generated files through the exporter, and review every resulting model and reference-result difference.

Keep the original Factory, Festival and Service numerical examples unchanged unless the proposed change explicitly addresses their behavior. A new starter needs catalogue and message entries as well as its model, alternatives and presentation. Include an independent expectation for the behavior it teaches; a saved regression result alone does not establish correctness.

Open the starter in the app, apply and calculate both alternatives, inspect the input differences and results, then exercise Undo and JSON download/reopen. When changing layout, capture and inspect the actual preview and alternative layouts. See the [template guide](docs/TEMPLATES.md) and [browser checks](docs/QUALITY.md) for the complete flow and `npm run test:templates` setup. Do not imply physical transport, inventory assembly or real-business calibration through the scenery or copy.

## Publication checks

Set up the optional local hooks with `npm run setup:hooks`. They check staged files before a commit and outgoing commit/tag contents before a push. Existing custom hooks are preserved; integrate these checks into a custom setup when needed. Setup enables repository-local `user.useConfigOnly`, so configure your intended Git identity. A GitHub noreply address keeps your contact address private.

Use `npm run check:publication` for the committed tree or `node scripts/check-publication.mjs --staged` for the index. The guard rejects private/generated paths, machine paths and common credential shapes. GitHub push protection is a separate layer. Review prose, images, metadata and licences too; automated patterns cannot recognize every kind of private data.

Repair rejected content before pushing. Removing a file in a later commit does not remove it from earlier history. Use focused branches, meaningful commits and reviewable PRs.

## Keep the boundaries clear

| Area | Responsibility |
| --- | --- |
| `src/model` | Schema, validation, identities, model commands and input differences |
| `src/engine` | Browser-independent discrete-event execution |
| `src/experiments` | Replications, matched-input comparisons and finite capacity search |
| `src/worker` | Calculation lifecycle, progress, cancellation and message validation |
| `src/features` / `src/lab` | Editing, scenarios, results and experiment interfaces |
| `src/storage` | Project files, local persistence, CSV conversion and reports |
| `src/playback` / `src/scene` | Recorded-result replay and visual presentation |
| `src/ui/messages` | Typed English product copy and accessible labels |
| `src/examples` / `examples` | Synthetic factories and portable reference projects |
| `src/templates` / `public/templates` | Curated starter definitions, layouts, catalogue and generated portable projects |
| `src/public-api.ts` | Headless engine exports |

The engine must remain independent of DOM, React, Three.js, browser storage, animation speed and network services. Visual movement is not modeled transport time. Drafts, recorded run snapshots, scenarios, experiments and playback state have separate identities and lifecycles.

Use the shared edit/history path for model changes. One logical edit should form one Undo action. Display units and view preferences must not change the model. Preserve sampling identities when branching an existing model; copied steps need distinct identities. Never silently clip schedules, normalize probabilities, fix imported rows or convert a distribution to a constant.

Changes to event ordering, random draws or model semantics need an explicit reproducibility assessment. Read the [model contract](docs/MODEL_GUIDE.md) and [API](docs/API.md) before changing these boundaries.

## Make a reviewable change

Describe the concrete problem, resulting behavior and relevant validation. Keep unrelated changes separate.

- For numerical changes, use an analytical example, independent reference or invariant. A test should not simply repeat the implementation's arithmetic.
- For interaction changes, exercise the real edit → calculate → compare → save/open flow with synthetic projects, keyboard use and appropriate screen sizes.
- Preserve project data, save-conflict checks, retained drafts and previous accepted results through failures or cancellation. Browser tests must use isolated contexts and test origins.
- Keep visible copy, accessible names and recovery instructions in the relevant message catalog. User/model names and canonical file keys remain data, rather than translatable UI strings.
- Verify dependency and asset licenses before adding or updating them. Retain attribution, source manifests and modification records.

Match verification to the change. For prose-only changes, check the referenced commands, labels and links; do not rerun unrelated numerical or browser suites. For code or model changes, run the relevant focused checks and these integration checks before requesting review:

```sh
npm run typecheck
npm run check:assets
npm test -- --maxWorkers=1
npm run build
npm run test:headless
```

The last command builds and checks the standalone engine and portable examples. If an original example definition changes, run `npm run examples:export` and review both its project JSON and reference-result differences. For curated starters, use `npm run templates:export` and `npm run check:templates` as described above. Do not edit expected results merely to make a story or a test look better.

Pull requests targeting `main` run the repository's automatic checks; manual workflow dispatch is also available. The Pages workflow checks, builds and publishes `main` to the browser demo. See [Testing](docs/QUALITY.md) for check coverage and browser smoke commands.

## Keep source portable

Use project-relative paths and documented environment options. Do not commit generated builds, dependencies, caches, local projects, private test artifacts or machine-specific setup. Avoid introducing a paid service or account requirement into the client-side core.

For a public bug report, include a minimal synthetic model, reproducible actions, expected and observed behavior, and relevant environment information. Review screenshots and exported reports for private model content before sharing them. Report security issues using [SECURITY](SECURITY.md).

Original contributions use the repository's [MIT license](LICENSE). Third-party materials retain their separate terms and credits in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
