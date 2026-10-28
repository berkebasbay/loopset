# Starter templates

Open **Templates → Browse templates** to search twelve facilities by production, logistics, service or events. Select a card to see its actual scene preview, process question, starting assumptions and two experiments. **Open this template** creates an independent project. **Blank** remains available for a site with no objects or process steps.

Each starter includes **Original plan** and two named alternatives. In the workspace, open **Project brief**, review a plan's input changes and choose **Apply this plan**. Applying also restores that plan's layout. Then use **Run & compare** to calculate the changed draft. **Undo** returns to the previous draft, while recorded results remain tied to the inputs that produced them.

## The collection

| Template | Explore | Two alternatives |
| --- | --- | --- |
| Little Factory | Parallel packing stations versus the team available to staff them | Extra packing station; Staff both stations |
| Workshop | Shared operators, finishing and a timed curing stage | Cross-trained team; Shorter curing study |
| Machining Cell | Two machining routes competing for operators | Duplicate the slow station; Staff the added station |
| Quality & Rework | A repeatable inspection and repair loop | Second inspection team; Lower rework study |
| 3D Print Studio | Variable print times and finishing capacity | Same mean, steady jobs; Second finishing bench |
| Packing Hall | Standard and bulky parcel lanes sharing a crew | Extra bulky bench; Larger packing crew |
| Order Fulfillment | Bursty order release and picking/packing balance | Rebalance the crew; Smooth order releases |
| Returns Center | Triage followed by restocking or refurbishment | Faster intake study; Staff a second repair bench |
| Parcel Hub | Arrival bursts and time-limited dispatch cover | Peak dispatch cover; Even parcel releases |
| Repair Workshop | Shared technicians and a planned availability reduction | Relief during the break; Third technician |
| Service Studio | Priority queues and a shared specialist break | Cover the team break; First come, first served |
| Festival Gate | Visitor waves and security coverage | Peak security cover; All-hour security cover |

Factory, Festival and Service preserve the numerical inputs of the original reference examples. Their presentation is updated. Workshop has its own process with shared operators and a resource-free curing delay. The initial workspace opens the enhanced Factory facility; existing saved projects reopen unchanged.

## Read a result carefully

Every timing, demand pattern, probability and staffing assumption is synthetic. These are editable learning models, not forecasts calibrated to a real business. An extra station may leave output unchanged, move a queue elsewhere, or cost more without resolving the limiting resource. Inspect waiting, unfinished work, cost and class outcomes alongside completed work.

The print-time study preserves the theoretical mean while changing variability. The fulfillment and parcel release studies preserve the number of jobs while changing arrival times; their external demand timing is different. Break-cover studies preserve nonpreemptive service and can incur overtime when work continues across an availability reduction. Repeated experiments are available for examining sampling uncertainty.

A layout object does not create inventory, collision rules or processing capacity. Picking is an aggregate timed service, not a physical walking route. Parcel handling does not model trucks, conveyor accumulation or consolidated loads. The curing delay has unlimited space and no shared resource. These boundaries appear in each template's assumptions.

## Save your own starting points

Use **Save as template → My templates** to keep a personal snapshot. Personal templates stay in this browser and site address, with the existing 50-template / 50-MiB limit. Download JSON to back up or transfer one. Each use creates a new project; editing that project does not modify the saved template.

Starter projects use the same portable project JSON format. Only the selected starter payload is fetched. It is checked against the catalogue's size and SHA-256 before opening. Closing the chooser cancels a pending load; errors leave the open project intact. Model artwork is shared with the existing asset catalogue and loaded when used.

## Reproduce and contribute

Definitions live in `src/templates/definitions.ts`, authored presentation in `src/templates/presentation.ts`, and readable catalogue copy in `src/ui/messages/starterTemplates.ts`.

```sh
npm run templates:export
npm run check:templates
npm test -- --maxWorkers=1
```

The exporter writes twelve projects under `public/templates`, their bounded inventory, three reference seeds per plan, and the Factory presentation fixture in `examples/facility.json`. It validates all 36 plans before writing. Check mode compares generated text with the committed outputs. CI runs this check.

Numerical coverage includes independent one-job timelines, equal-headcount cost, rework-loop absorption, demand-count conservation, constant-versus-variable mean preservation, capacity bounds, original-reference preservation and deterministic regression results. Browser checks exercise all twelve starters and twenty-four alternatives, actual JSON downloads, scenario application and Undo, failed/cancelled loads, numeric drafts and narrow screens. See [Testing](QUALITY.md).

Previews are actual Loopset renders using the credited artwork, not illustrations of unimplemented features. When changing geometry or layout, capture and inspect the corresponding preview and the alternative layouts. Asset sources and adaptations retain their [existing licences and credits](../THIRD_PARTY_NOTICES.md).

## Process vocabulary

The generic cell arrangement draws on the [Lean Enterprise Institute's explanation of adjacent processing cells and U-shaped layouts](https://www.lean.org/lexicon-terms/cell/). This informs presentation; changing the layout does not change modeled walking time.

The fulfillment stages use ordinary pick, pack and ship terminology described in [Amazon's fulfillment overview](https://supplychain.amazon.com/blog/ecommerce-fulfillment-pick-pack-ship). No company operating data, calibration, endorsement or proprietary facility design is included.
