# Contributing to Loopset

Useful contributions make process questions easier to model, explain or reproduce. Small synthetic examples, independently reasoned engine tests, clearer editing, accessible interactions and focused bug fixes are welcome.

## Start locally

Use Node.js 24 and the committed npm lockfile:

```sh
npm ci
npm run setup:hooks
npm run dev
```

No backend, account or API key is required. Use invented data in issues, tests, screenshots and examples. Keep customer files, personal information, credentials, browser profiles and raw local logs out of contributions.

## Keep public history clean

Every pushed branch and intermediate commit is public. Use synthetic examples and stage explicit reviewed files. Private notes, credentials, personal models, browser data, machine paths, raw traces and generated archives belong outside tracked source.

The optional local hooks inspect the staged snapshot before a commit and all outgoing commit snapshots before a push. Set them up with `npm run setup:hooks`; if you already use a custom hooks path, integrate `.githooks` into it rather than replacing it. Fresh clones need this explicit setup. Setup also enables repository-local `user.useConfigOnly`: configure your intended Git identity instead of letting Git derive one from your device. Choose a GitHub noreply address if you want to keep your contact address private. GitHub secret scanning and push protection provide a separate provider-token check.

Run `npm run check:publication` to inspect the committed tree, or `node scripts/check-publication.mjs --staged` for the current index. A rejected push must be repaired before publication; deleting the file in a later commit does not remove it from history. Never bypass a warning to publish private material. Review the diff, commit text, images and licenses yourself: automated checks do not understand every kind of private information.

Use focused branches and PRs, with meaningful commits and relevant checks. Keep public documentation about the product and contributions; personal delivery or session notes stay local.

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

Run checks appropriate to the change, then the integration checks before requesting review:

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:headless
```

The last command builds and checks the standalone engine and portable examples. If an example definition changes, run `npm run examples:export` and review both its project JSON and reference-result differences. Do not edit expected results merely to make a story or a test look better.

Pull requests targeting `main` run the repository's automatic checks; manual workflow dispatch is also available. The Pages workflow checks, builds and publishes `main` to the browser demo. CI covers its listed checks, not human usability, every device or live hosting behavior. Report the actual tested revision and distinguish unit, browser and manual evidence.

## Keep source portable

Use project-relative paths and documented environment options. Do not commit generated builds, dependencies, caches, local projects, private test artifacts or machine-specific setup. Avoid introducing a paid service or account requirement into the client-side core.

For a public bug report, include a minimal synthetic model, reproducible actions, expected and observed behavior, and relevant environment information. Review screenshots and exported reports for private model content before sharing them. Report security issues using [SECURITY](SECURITY.md).

Original contributions use the repository's [MIT license](LICENSE). Third-party materials retain their separate terms and credits in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
