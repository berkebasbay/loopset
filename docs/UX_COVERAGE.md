# Interaction verification

Use synthetic models and isolated browser contexts. The [workspace guide](UX_GUIDE.md) explains the controls; [Quality](QUALITY.md) lists the reproducible commands.

| Area | Verify |
| --- | --- |
| Scenario and time plans | Change duration and demand; preview horizon effects; preserve periods and distribution shapes unless replacement is explicit. |
| Process and capacity | Select, add, copy, connect and arrange steps; keep station concurrency, shared teams and calendars independent. |
| History and results | Undo/Redo logical edits; retain immutable recorded results; show both input and outcome differences. |
| Experiments and replay | Preserve sampling identities; keep calculation results separate from camera, units, animation and recorded-time navigation. |
| Projects and reports | Save, download and reopen real files; verify exported contents, conflicts, cancellation and recovery. |
| Navigation | Exercise keyboard/focus and desktop, tablet and phone layouts, including the DOM editing alternatives. |

Local functional checks and responsive emulation have different scope from physical-device, assistive-technology and participant studies. Report the revision, browser, actual actions and any unresolved failure when contributing a change.
