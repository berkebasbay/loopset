# World assets and attribution

Loopset uses a curated, pinned subset of [NVIDIA SimReady assets](https://huggingface.co/datasets/nvidia/simready-assets). It does not require downloading the complete catalogue, an NVIDIA runtime, an account or a remote asset API.

## Equipment selection

| Modeled role | Visual material |
| --- | --- |
| Factory machining | Brake lathe `serviceTool_brake_lathe_a01` |
| Inspection | Workbench, caliper and monitor |
| Packing | Conveyor, cartons and pallets |
| Reception and ticket checks | Desks, monitors and barcode scanners |
| Office waiting | Office chairs |
| Workshop structure | Floor, wall modules, shelf and ceiling lights |

Equipment is selected by its role and sampling identity, not by a renamed label or its array position. Abstract routes/delays and exits use process annotations. Artwork illustrates the process; it does not add modeled walking time, collisions, CAD constraints or inventory assembly.

The pinned NVIDIA revision is `524747d9b5e1f21b5b18b56041788c01d745f1a1`. The selected packages declare **CC BY 4.0**. Their source URLs, original/output hashes, adaptations and licences are recorded in `public/assets/simready/manifest.json` and the accompanying licence file.

## People, surroundings and lighting

Normal-proportion people are by [Quaternius](https://quaternius.com/) under CC0; original source/archive revisions and animation adaptations are in `public/assets/characters/manifest.json`. The model's own Idle, Walk and Interact poses drive the bounded illustrations. Shared pools retain anonymous staff identities rather than duplicating employees at every stage.

Missing plant, scenery and office categories use [Kenney](https://kenney.nl/) CC0 material, with exact pack sources and hashes in `public/assets/kenney/manifest.json`. The local lighting environment is [Studio Small 09 by Sergej Majboroda / Poly Haven](https://polyhaven.com/a/studio_small_09), CC0, with its own manifest.

Factory has a cutaway workshop/loading yard; Festival has tents, a stage and spectator surroundings; Service has an office/lounge. Decorative props never create process nodes or resource capacity.

## Browser adaptations

The initial view uses source-derived browser models with recorded simplification/quantization and meshopt compression. Close primary inspection can load the detailed equipment. Lathe texture atlases, source geometry and character animation provenance remain documented. Lossless gzip siblings decode to the same checked-in GLBs, with fallback to original local files.

`public/assets/lod/manifest.json` records each derivative's source/output hashes, licence, bounds and adaptation. Artwork is optimized for the browser rather than a full USD/MDL/physics reproduction. Large worlds retain bounded illustrations while exact resources, queues and numerical outcomes stay authoritative.

## Reproduction and licences

Normal installation uses the checked-in assets and needs no Python or asset-processing tools. Optional preparation scripts use allowlisted sources, byte/hash checks and private candidate output directories. Inspect their pinned tooling requirements before regenerating files; never replace attributed material without updating its provenance.

Original Loopset code is MIT-licensed. Assets, fonts and dependencies keep their own licences in [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) and the asset folders. Preserve those notices in source and runtime distributions.
