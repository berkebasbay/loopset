# Testing

Use Node.js 24 and the committed lockfile:

```sh
npm ci
npm run typecheck
npm run check:assets
npm run check:templates
npm run check:docs
npm test -- --maxWorkers=1
npm run test:publication
npm run build
npm run test:headless
```

The unit suite covers numerical references, conservation/capacity invariants, event ordering, keyed randomness, validation, cancellation, history, storage conflicts/recovery and report identity. Headless contracts check the three examples, repeatability, import bounds, diagnostics and the standalone engine.

## Browser smoke checks

The required PR check and Pages build run `npm run test:browser` against the built app. This starts its own loopback preview, checks first use, no-3D/module failures, safe guided entry, templates and the original worlds, then stops only its own processes. Linux CI uses software graphics in isolated Chromium contexts; these are correctness checks, not GPU performance measurements.

Install the browser matching the pinned Playwright dependency once with `npx playwright install chromium` (CI uses `npx playwright install --with-deps chromium`, as in the [Playwright CI guide](https://playwright.dev/docs/ci-intro)). Then run:

```sh
npm run build
npm run test:browser
```

The runner fails if its preview port is occupied. Set `QUEUELAB_BROWSER_PORT` to a free port; it never stops an existing server. `QUEUELAB_BROWSER_DIST` selects an alternative build folder. `QUEUELAB_PUBLIC_URL` supplies the built deployment subpath, so the Pages build is checked under the same `/loopset/` base. Generated evidence remains ignored; no browser profiles or customer files are used.

Documentation checks validate local file/image links and common Markdown heading anchors, excluding fenced code examples. They do not make external website availability a build requirement.


Serve a production build on loopback and run:

```sh
QUEUELAB_URL=http://127.0.0.1:4173 QUEUELAB_UX_PHASE=core node scripts/ux-smoke.mjs
```

The script uses isolated browser contexts and synthetic models. It requires Playwright browser binaries; it does not install them. Generated screenshots and files stay outside version control.

Run `QUEUELAB_URL=http://127.0.0.1:4173 npm run test:learning` for the first experiment: real selection/edit/run/compare/template save at desktop and 320/390 px, keyboard focus, reduced motion, refresh, original-project/history restoration, storage errors and cancelled loading. Other smoke checks use the welcome's public **Explore on my own** path before testing the workspace.

The facility flow has a separate isolated smoke command:

```sh
QUEUELAB_URL=http://127.0.0.1:4173 npm run test:facility
```

Run `QUEUELAB_URL=http://127.0.0.1:4173 node scripts/facility-workspace-smoke.mjs` for the facility-first workspace: fresh workshop, separate dock/canvas, visible placement/limits, metadata-only browsing, equipment defaulting to layout, explicit processing choice and narrow-screen controls.

Run `QUEUELAB_URL=http://127.0.0.1:4173 node scripts/facility-navigation-smoke.mjs` for mobile Properties reveal/focus and connection-preview priority while leaving numerical inputs unchanged.

Run `QUEUELAB_URL=http://127.0.0.1:4173 node scripts/interface-polish-smoke.mjs` for exact numeric readouts, captured result labels, real experiment execution, dialog/keyboard bounds, forced colors, short windows, narrow model navigation and global validation repair.

Run `QUEUELAB_URL=http://127.0.0.1:4173 node scripts/templates-smoke.mjs` for true blank starts, placement, template snapshots, fresh instances, reload, process initialization/Undo, JSON import/export, storage failures, simultaneous saves and mobile templates. Run `node scripts/templates-storage-smoke.mjs` with the same URL for the independent byte cap, unavailable storage and future-database handling.

Run `QUEUELAB_URL=http://127.0.0.1:4173 npm run test:templates` for all twelve curated starters and their twenty-four alternatives, recorded reference outcomes, real JSON download and Undo, selected-only loading, HTTP/integrity errors, retry, cancellation, unfinished fields and narrow gallery/brief layouts.

The facility compatibility smoke checks real placement/transforms, unchanged numerical results for visual edits, object history, functional cells, captured baseline/current scenarios, actual project download/reopen and the existing worlds. It reuses an installed browser and never installs one automatically. Catalogue checks decode and validate prepared derivatives using public manifests, without needing local preparation logs. Numerical invariants and file/storage/recovery tests remain separate from browser/graphics evidence.

| Area | Check |
| --- | --- |
| Scenario and time plans | Duration, demand, distribution shapes, period boundaries and explicit horizon policies. |
| Process and capacity | Selection, insertion, copying, connections and independent station, team and calendar limits. |
| History and comparison | Undo/Redo, immutable recorded results, input differences and outcome metrics. |
| Experiments and replay | Sampling identities, experiment limits and separation of calculated results from presentation. |
| Projects and reports | Real download/reopen, exported contents, save conflicts, invalid input, cancellation and recovery. |
| Navigation | Keyboard/focus and desktop, tablet and phone layouts, including DOM editing alternatives. |

Use the [workspace guide](UX_GUIDE.md) for the interactions. Viewport emulation does not cover every physical device or assistive technology; include the tested browser, revision, actions and any unresolved failure in a contribution.

For numerical changes, use an independent reference or invariant. Preserve incomplete-run labels and the last accepted results through failures. The [model guide](MODEL_GUIDE.md) defines calculation assumptions and limits.
