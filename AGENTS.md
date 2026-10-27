# Loopset contributor agreements

## Public repository and session continuity

- This is the active public Loopset repository. Every pushed branch, commit, tag, PR description and attachment is public. Keep private working notes out of Git history, including temporary commits later deleted.
- Optimize for a polished, useful open-source product: a clear first experience, reproducible examples, easy setup/forking and helpful contributions. Earn stars and forks through real utility; never fabricate engagement, benchmarks or adoption.
- At session start, read this file and README. If `.private/SESSION_HANDOFF.md` exists locally, read it for current private continuity; never copy it into public docs or commits. Another clone must rely on public guides unless the owner supplies private context separately.
- Before editing, check the working tree and preserve unrelated changes. Do not restart accepted research, redesign or completed validation without a related change or concrete regression.
- Use a focused feature/fix branch and a reviewable PR for integration. Commit real, coherent changes; do not manufacture history. Run the publication guard and inspect the outgoing diff and commit messages before every push.
- Install the repository-local hooks with `npm run setup:hooks` when no custom hooks path exists. Preserve existing custom hooks and integrate the checks explicitly. Do not bypass hooks or push protection to ship private content.
- Never commit personal/customer models, credentials, browser data, raw logs, private plans, chat/session transcripts, machine-specific paths, caches, archives or intermediate recordings. Keep local evidence in ignored private storage. Public examples and screenshots must use synthetic data; documentation must serve users or contributors.
- Keep an explicitly configured Git identity; use a GitHub noreply address when keeping contact details private. Hook setup enables repository-local `user.useConfigOnly` so Git cannot infer an identity from the device.
- Stage explicit reviewed paths. Check the actual staged/pushed content; `.gitignore` does not protect a file that was force-added or already tracked. A guard cannot determine whether arbitrary prose or an image is private, so human/agent diff review remains required.
- Preserve existing data, licenses and attribution. New paid services, domain purchases, account/permission changes and social posting need authorization covering that action.

## Product and quality contracts

- Keep the core free, client-side and usable without accounts, paid APIs or a simulation backend.
- Read README, the workspace guide, model guide and architecture before changing the relevant area.
- Keep numerical model state separate from layout, viewing preferences, field drafts, replay and immutable run snapshots.
- Reuse shared commands and validation. Units, camera, animation and names must not change numerical outcomes.
- Preserve sampling identities when branching plans; give copied steps new identities. Keep station limits, resources and calendars explicit.
- Preserve project files, browser storage and unrelated changes. Use synthetic models and isolated browser contexts for tests.
- Assign file ownership when delegating. Integrate shared contracts in one place and review implementation independently.
- Use repository-relative paths. Keep caches, private evidence and generated builds outside version control.
- Run focused checks for a change, then typecheck, unit tests, production build and headless contracts for integration. Do not relax assertions to hide a failure.
- Keep user-visible copy in the message modules and maintain keyboard, focus, reduced-motion and DOM alternatives.
- Preserve licences, attribution and asset provenance. Do not introduce unlicensed material or publish private data.
