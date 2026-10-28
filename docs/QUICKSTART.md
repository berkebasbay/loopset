# Quickstart

## Open a world

Open **[the live demo](https://berkebasbay.github.io/loopset/)**. No installation or account is required.

To run the same application locally with Node.js 24:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Choose **Little Factory**, **Festival Gate** or **Service Studio**; examples calculate on opening. **New model** starts a valid arrival → waiting → processing → completion flow.

The working surface has a world, a searchable **Steps** list, contextual **Properties**, and **Run simulation**. **Tools → Model editor** keeps the complete professional model available when you need it.

For a custom facility, choose **Build facility → Empty site**. Use **Process cells** for connected waiting/processing stages or **3D models** for searchable equipment and layout pieces. Placed objects can be moved, elevated, rotated, scaled and saved inside project JSON without changing numerical outcomes. Continue with the [facility guide](FACILITY_GUIDE.md).

## Try a capacity decision

1. Open Little Factory and select **Packing** in the world or **Steps**.
2. Inspect **Parallel stations**, processing time and the related team. The first calculation is your starting baseline.
3. Increase parallel stations. This changes concurrency only. If the team would still limit the extra station, open its disclosure and adjust **Base available units** separately, within its installed limit. Inspect any shift overrides and other steps using the same team.
4. Choose **Run & compare**. Read both **Input differences** and the completed-work, waiting and cost outcomes. Extra capacity may expose another constraint or increase cost.
5. In Compare, name and **Save current plan**. Save the baseline too if you want an alternative you can restore later. Saving a scenario keeps a model snapshot; it does not run a new calculation.

Use Undo/Redo or **Action history** to reverse model edits. Restoring a saved scenario changes the draft; calculate it to get a new result.

## Change duration or demand

**Scenario settings**, beside Run, offers 30-minute, 1-hour, 8-hour and custom durations. Choose seconds, minutes, hours or days for display. Changing the unit alone leaves the model unchanged.

Review the arrival, shift and warm-up impact before **Apply run length**. Keeping a plan does not automatically repeat variable-rate periods or exact arrivals. Trimming or repeating a plan is an explicit choice with a preview; a change that would invalidate the plan is rejected.

Select the arrival source for its **Properties**:

- Fixed demand has an arrivals-per-hour field.
- Variable demand can scale the existing rates while keeping periods and zero-rate gaps. Open the time plan for a timeline and editable period table.
- Exact timestamps have a separate edit path. Regular, busy-hour and wave profiles are previewed before deliberately replacing the existing pattern.

Expected demand is a planning quantity. Random actual arrivals can differ; read the displayed scope. Result statistics identify the measured arrival cohort, including any warm-up exclusion.

## Keep and reopen your work

**Download project JSON** creates a portable editable backup. Check that the browser saved the file.

To reopen it, choose **Open project → Open project JSON**, select the file, review the preview and choose **Open this project**. The same Projects area offers **Save in this browser**, saved-project search and **Review & open**.

Browser saves belong to the exact site address, including its port. Another browser, device or address has a separate library. Use downloaded JSON to transfer work; do not clear browser storage to find a missing project.

## Inspect and export a run

Open **Results** for work outcomes, waiting distributions, station/resource metrics and an observed bottleneck candidate. A candidate is a place to investigate, rather than a proven cause or an improvement guarantee.

**Results → Export report** offers run JSON, CSV, PNG, HTML and the browser's print/PDF path. These outputs preserve the recorded run. Run JSON is a report; project JSON is the editable backup used by Open.

Replay animates retained events. **Counts** describes the recorded moment; the main outcome metrics describe the calculated run. **Go to recorded time** jumps within the available recording. Pause, speed, camera, detail and reduced motion do not change numerical results. A bounded recording may end before the full calculation horizon.

## When a field or run needs attention

Number fields apply on Enter or when you leave a valid field. Escape restores its previous value. Apply or cancel unfinished input before calculating. Errors identify the relevant setting and offer a route back to it.

**Cancel calculation** stops computing; it does not mean the plan completed. Previous accepted results and the draft are preserved. Incomplete attempts remain labeled separately.

For copying, group editing, routing, calendars, CSV conversion, experiments and keyboard controls, continue with the [workspace guide](UX_GUIDE.md).
