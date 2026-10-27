# Workspace guide

Start with the world and a question: which arrival rate, processing time, team or waiting policy do you want to test? Use **Scenario settings** and **Properties** for common edits. **Tools → Model editor** provides the full model without requiring a second workflow.

**How it works** in the world opens the optional three-step guide: change one thing, run the changed plan, compare and keep it. On a phone, select a world object and use **Edit selected step** below the scene. Scenario settings links directly to arrivals and related team controls.

The team’s base availability is visible in Properties. Installed capacity, cost and shifts have their own disclosures. A capacity note explains when the base team cannot staff every parallel station; shared use and calendar overrides remain separate limits. Short duration readouts retain the exact editable value when focused.

## Find a setting

Select an object in the world, or open **Steps** and search its name or type. Sources, queues, processing steps, routes, delays and exits all have DOM entries. Checkboxes support group selection; selecting a name opens that step's Properties.

**Find a setting or action** searches a small set of real workspace actions. Typing does not calculate, download or create a model; selecting an action opens or performs it. **Help → Quick guide** is optional and can be reopened. View detail and reduced motion are available directly under **View**.

## Edit deliberately

Number fields retain incomplete typing outside the model. Enter or leaving a valid field applies it; Escape cancels the unfinished field. Model commands use Undo/Redo and **Action history**. View units, camera, layout and playback are separate from numerical inputs.

Click a step's heading to rename it. The project title has its own rename action. Project labels, technical model names and recorded run labels serve different purposes; a rename does not rewrite a completed run.

### Duration and time plans

Open **Scenario settings** beside Run. Select a preset or enter a custom length, then review the proposed change. Runs can span up to 365 days, subject to calculation and device limits.

| Choice | Effect |
| --- | --- |
| Keep the existing plan | Retains exact arrival times, variable-rate periods and calendars. A shorter horizon is refused if it would invalidate them. |
| Trim to the new end | Deliberately removes out-of-range arrivals and trims crossing periods. The preview identifies effects on warm-up. |
| Repeat the existing plan | Extends the plan by repeating its arrival and calendar pattern within row/period limits. |

Fixed rates continue over a longer horizon naturally. Variable-rate gaps have no arrivals; resource-calendar gaps use the pool's base capacity. An extended horizon alone does not turn a one-hour arrival wave into an all-day event.

Timelines and period tables describe the same stored times. Change the display unit without changing the model; edit a period, inspect gaps or overlaps, then **Apply time plan** as one change. A break sets resource availability to zero in the selected interval. Work already in service finishes normally.

### Demand

A source can generate fixed intervals, Poisson rate periods or an exact timestamp schedule. Expected totals are calculated before execution; random realized counts need not match them. Actual counts and results state their scope, while warm-up determines the measured arrival cohort.

Scaling a variable profile changes its rates while keeping boundaries and zero-rate periods. A new regular, busy-hour or wave profile is an explicit replacement: preview its shape and expected total before applying it. Replacing exact timestamps with a random profile does not preserve the individual arrival times.

### Stations, teams and shifts

These are independent controls:

| Control | Meaning |
| --- | --- |
| Parallel stations | Maximum simultaneous jobs at this processing step. |
| Base available units | Available units in a related team/equipment pool outside calendar overrides. |
| Installed unit limit | Upper bound for the pool's base and scheduled capacities. |
| Resource requirements | Units the processing step needs together for each start. |
| Calendar periods | Availability overrides during specific intervals. |

More stations do not automatically add staff. A shared pool can constrain multiple steps, and its disclosure lists those consumers. Model hourly cost and calendar settings are visible with that pool. Cost is a modeled resource charge, not a real business bill.

A mean-duration edit can scale the existing constant, exponential, triangular or empirical distribution while preserving its shape. Choosing a fixed duration is a separate deliberate conversion. Invalid scaled parameters are not applied.

### Queues and routes

Choose **Unlimited waiting** or a finite number of waiting places. Zero waiting places allows admission only when processing can begin immediately. FIFO or nonpreemptive priority determines queue order; patience controls when waiting work may leave. Service already in progress is not interrupted.

Class and route probabilities are edited as percentages. They must total 100%; the app does not silently normalize them. Advanced identities and sampling settings remain in the full model editor.

## Build and arrange a process

**Add step** and **Add after** preview which connection will change before inserting a new stage. This adds a stage to the flow; it is different from adding parallel capacity at one station. Connection pickers explain invalid destinations.

**Copy step** previews a detached copy or an insertion after the selected step. Copies receive new step and sampling identities and retain their resource references. Copying a source adds an independent arrival stream; copying a queue also copies its processing step.

Select compatible steps for shared settings, inspect the affected names/count and apply the change once. Mixed types are explained instead of partly updated. Drag a selected group in Move mode or use the DOM arrangement controls; both change only layout.

## Read results and keep alternatives

A changed draft is separate from its previous result. Input differences show what changed; recorded results keep their original model, seed and scope. Station rows can open the corresponding current step's controls without rewriting that result.

Average, median and 95th-percentile summary waiting times use completed members of the measured arrival cohort. Unfinished, rejected and abandoned work is reported separately. A wait-target fraction includes all cohort arrivals in its denominator. Station utilization and resource utilization measure different constraints.

The suggested place to investigate uses observed queue data. It does not prove a cause, promise that extra capacity will help or claim a global optimum.

Compare displays named recorded plans, input changes and outcome differences together. Demand, seed and measurement policies determine whether matched-input comparisons are valid. Save current/baseline plans as named scenarios; restore a scenario to edit it, or calculate it as a baseline. Scenarios travel inside project JSON.

**Repeat this comparison** captures the compared models for a paired experiment. Independent replications examine variation in one plan. Capacity search evaluates a finite resource-base-capacity list or start/end/step range, then uses separate seeds for verification. The installed limit, station counts, requirements and calendar overrides remain explicit; a full-run calendar can make base-capacity changes ineffective.

## Replay and view

The replay slider, **Counts** and **Go to recorded time** refer to retained events. Jump only within the displayed recorded interval, or choose Recorded start/end. Completed-run metrics stay fixed while seeking, pausing or changing speed.

Large runs can retain a shorter replay prefix while still calculating full numerical results. Walking, spacing and scenery are illustrative; add a modeled Delay for transport time. **View** changes detail and reduced motion, without changing the process.

## Project files, data and reports

The Files surface separates **Projects**, **Import data** and **Reports**. Recovery messages stay visible when a draft needs attention.

- **Save in this browser** waits for a browser-storage acknowledgment. Saved libraries belong to the current origin, including its port; they are not device or account synchronization.
- **Download project JSON** requests a portable editable backup. Verify the actual file before relying on it.
- **Review & open** validates a saved project before replacement. Search and sort read library summaries; large libraries explicitly show partial scanning and **Continue library scan**.
- A damaged or unsupported record is preserved rather than silently deleted. Repair backups are deliberately separate from validated project JSON.

For CSV import, choose arrival timestamps or service durations, select a file, then choose its time column, source unit and target. Preview converted seconds and sample rows before applying. Every selected row must pass validation; order and duplicate timestamps are retained. Files stay unchanged, and Cancel leaves the model unchanged. Inputs use UTF-8, comma-delimited CSV, plain decimal numbers and the existing file/row limits. See the [model guide](MODEL_GUIDE.md) for exact limits.

Results offer JSON, CSV, PNG, HTML and print/PDF formats. Reports preserve the selected immutable calculation, including incomplete/stale scope when applicable. Run JSON is a report, not a project import; use project JSON to reopen an editable model.

## Keyboard and smaller screens

Tab and Shift+Tab move through controls. Enter activates actions and applies valid numeric edits; Escape first cancels an unfinished field or closes its current surface. Text fields retain native editing shortcuts.

| Shortcut, with workspace focus | Action |
| --- | --- |
| Space | Play/pause replay |
| G | Focus selected step |
| F | Fullscreen world |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y | Redo |

On smaller screens, use Scenario settings and the labeled Steps/Properties controls to bring the relevant panel into view. The DOM model editor and numeric arrangement controls provide alternatives to precise canvas dragging.
