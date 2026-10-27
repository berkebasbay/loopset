# Loopset development guidelines

- Read README, CONTRIBUTING and the relevant workspace, model and architecture guides before changing an area.
- Keep the core free, client-side and usable without accounts, paid APIs or a simulation backend.
- Keep numerical model state separate from layout, display units, camera, field drafts, replay and immutable run snapshots.
- Reuse model commands and validation; preserve logical Undo/Redo, distribution shapes and explicit calendar edits.
- Preserve sampling identities when branching plans; give copied steps new identities. Keep station limits, shared resources and calendars independent.
- Preserve project files, browser storage, conflicts and recovery behavior. Use synthetic models and isolated browser contexts for tests.
- Keep the engine independent of rendering, storage and network services; illustrative movement must not change numerical results.
- Keep user-visible copy in the message modules and preserve keyboard, focus, reduced-motion and DOM alternatives.
- Preserve licences, attribution and asset provenance. Keep generated builds, caches, private data and credentials outside tracked source.
- Use focused changes and explicit file ownership when delegating; integrate shared contracts in one place.
- Run checks appropriate to the change using CONTRIBUTING. Numerical changes need independent references or invariants; do not weaken assertions to conceal failures.
- Run the publication checks and review the actual staged/outgoing content, including commit metadata and media, before pushing.
