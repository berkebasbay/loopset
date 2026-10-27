# Verification and quality boundaries

The core checks are reproducible locally:

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:headless
```

The unit suite covers independent numerical references, conservation/capacity invariants, event phases, keyed randomness, snapshot/protocol safety, cancellation, validation, history, local-storage conflicts/recovery, strict data conversion and report identity. Headless contracts verify the three examples, repeatability, input bounds, safe diagnostics and the standalone engine bundle.

## Browser checks

Serve a production build locally, then run the maintained UX smoke script in an isolated context:

```sh
QUEUELAB_URL=http://127.0.0.1:4173 QUEUELAB_UX_PHASE=core node scripts/ux-smoke.mjs
```

Additional phases exercise process edits, explicit profiles/horizon policies, experiments/replay, file/library behavior and cancellation/limits. Artifacts stay outside version control under `.private/evidence/`. Browser binaries are a separate local Playwright prerequisite; the script does not install them or use an owner's profile.

Check the three worlds and desktop/tablet/phone layouts for actual input→calculate→compare→scenario→file/report behavior. Inspect real downloaded contents; a toast alone does not prove file receipt. Verify keyboard/focus, partially typed inputs, obsolete async operations and preservation of the last accepted result. Do not weaken assertions or time limits to conceal defects.

## Interpretation

Functional browser checks at emulated widths are not physical-device, assistive-technology or participant research. Headless WebKit is not a native Safari certification. Visual smoothness depends on device and workload; no universal frame-rate or memory guarantee is made.

Numerical outcomes and recorded replay have different coverage. A limited, cancelled or failed attempt must remain explicitly incomplete. Synthetic examples and observed bottleneck candidates are not validated business forecasts or guaranteed optimization results.
