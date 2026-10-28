# Build a facility

The workspace follows **Build facility → Define process → Review results**. On desktop the Asset library has its own dock beside the site. Open **Build facility** to find three views:

- **Steps** retains the general workstation, waiting-area and delay tools.
- **Process cells** adds a connected waiting area and processing step with editable synthetic starting values.
- **3D models** searches the prepared equipment, building, furniture, storage, container and accessory models.

Choose **Templates → Blank** or **Empty site** for zero objects and zero process steps. Arrange the site freely; **Start a process** adds arrivals, a waiting area, one processing step and an exit as one undoable edit, keeping placed objects and existing resource pools. The new processing step has no shared-team requirement until you assign one. Your previous project follows the normal save/recovery path. The three example worlds remain available under **Templates**. **View → Show example surroundings** controls their decorative setting; it does not add numerical resources.

**Templates** offers twelve facilities with real scene previews, assumptions and two saved experiments each. **Little Factory** keeps the original Factory process in an updated 57-object layout; its portable version is [`examples/facility.json`](../examples/facility.json). **Workshop** uses a distinct shared-operator and curing process. Open **Project brief** to apply an alternative, then calculate and compare it. See the [template collection](TEMPLATES.md).

## Place and arrange objects

Filter or search 3D models, then select a model. The library shows its source dimensions, download size and attribution. Choose **Place object** or drag its tile onto the world. Browsing the library loads metadata and the current page of previews; it does not download every model.

Selecting a placed object opens its controls under **Placed** in the inspector. Change horizontal position, elevation, rotation, scale or name; duplicate it or remove it. Dragging snaps horizontal movement to half-unit increments. Numeric controls accept finer values. Enter or leaving a valid field applies the edit; Escape cancels an unfinished field. Use the object list when precise canvas pointing is inconvenient, and **G** or **View → Focus selected object** to inspect the selection.

Elevation allows visual arrangements such as beams, roofs or objects on shelving. There is no automatic stacking, collision, structural or inventory calculation. Source dimensions are metres; the miniature workspace remains an illustrative layout rather than a calibrated CAD or transport model.

Placed layout objects do not create processing capacity, staff, storage policies or travel time. A shelf can illustrate a modeled waiting area, but its appearance does not infer a queue capacity.

## Add equipment to the process

Every catalogue tile starts as a **Layout object**, including equipment. This lets you arrange a facility without creating numerical stages or allocating teams. The selected model has a visible placement action; details and attribution are secondary.

For an equipment model, deliberately choose **Use as → Processing step** to add a timed service to the flow. Select **Add after**, enter processing time and deliberately choose a separate team, an existing team or no shared team. A separate team starts with one installed and available unit and zero hourly cost; review its capacity, shifts and cost in Properties. These are starting inputs, not measurements supplied by the artwork.

**Layout object** places the equipment visually without creating a process step. **Use on selected step** changes an existing step's appearance while retaining its numerical settings. The equipment-appearance disclosure also restores the world's default artwork and adjusts its rotation/scale.

Built-in cells cover machining, inspection, packing, reception and service. Each adds a waiting area and service as one undoable change, keeping the chosen connection and team policy explicit. A cell adds stages; parallel stations add concurrent capacity at an existing service. More stations do not automatically create more staff.

Drag/drop uses the actual camera and resulting process layout. Expanded station groups reserve visual spacing. If an exact process position falls inside an expanded band, the new stage snaps nearby and a message explains the adjustment. Existing stages and their numerical inputs are preserved.

## Calculate and compare

Change a numerical input, choose **Run & compare**, and inspect input differences with the recorded outcomes. **Choose the next test** links observed waiting or a base-capacity mismatch to a setting worth inspecting. It does not establish causality or promise an improvement. **Repeat this comparison** examines variation using the existing experiment tools.

Moving, resizing, replacing artwork or changing surroundings does not change numerical results. Durations, queues, resources, routing and calendars do. No forklift routing, accumulating conveyor, machine kinematics, assembly or physical transport behavior is inferred from a model's appearance.

## Save reusable templates

Choose **Save as template** in the Asset library or Templates menu, enter a name, then save. **My templates** supports search, use, download, import and removal. Templates capture the layout, process settings and saved scenarios; recorded run results are recalculated rather than stored as template output. Each use creates a separate project, so edits never change the saved starting point.

The library is local to this browser and site address, with up to 50 templates and 50 MB of project JSON. It stores references to artwork, not copies of model binaries. Download JSON backups before clearing browser data or moving devices. Import reviews a valid project JSON before saving a template; it does not replace the open project. Removing a template keeps projects already created from it.

## Save and transfer the complete facility

**Download project JSON** includes object positions, elevation, transforms, names, asset revisions, step appearances and saved scenarios alongside the numerical model. Open it through the normal review/import flow to move between devices or site addresses. Browser-library saves belong to the current origin; they are not cloud synchronization.

Named scenarios preserve their facility presentation. Saving a baseline uses the presentation captured with that run, rather than later draft artwork. Run reports remain numerical records tied to immutable calculations; use project JSON for an editable facility.

If an old asset revision is unavailable, its reference and placement remain in the project. Use the Placed list or equipment controls to choose a replacement, keep a JSON backup, or reopen with a compatible catalogue. Failed artwork loading does not delete objects or replace them silently with unrelated models.

## Scope and limits

The catalogue count describes available model variants, not the number of objects already placed. The library shows the placed-object count separately and explains reached limits before placement. The editor supports up to 500 independent layout objects, separately from the numerical model's 100 steps and 50 resource pools. File, scenario, history and calculation limits still apply. Repeated instances share model geometry; the renderer tracks bounded model caches and can report unavailable detail without discarding the project. Browser HTTP caching is managed by the browser; the application does not persist a complete asset catalogue in the project database.

Models and source previews retain their separate licences. See [asset provenance](NVIDIA_ASSETS.md), the [catalogue preparation guide](CATALOGUE.md), and [third-party notices](../THIRD_PARTY_NOTICES.md).
