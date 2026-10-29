# Loopset documentation

Build a process, test a plan and understand the result. These guides cover the browser workspace, modeling rules, experiments and the standalone engine.

**[Open Loopset →](https://berkebasbay.github.io/loopset/)** · [Watch the demos](https://berkebasbay.github.io/loopset/watch/) · [Project overview](../README.md)

## Choose a starting point

| Your goal | Follow this path |
| --- | --- |
| Try Loopset for the first time | [Quickstart](QUICKSTART.md) → [Service Studio video experiment](QUICKSTART.md#reproduce-the-service-studio-demo) |
| Build a layout from scratch | [Facility guide](FACILITY_GUIDE.md) → [Workspace controls](UX_GUIDE.md) |
| Explore a ready-made process | [Starter templates](TEMPLATES.md) → [Read a result carefully](TEMPLATES.md#read-a-result-carefully) |
| Understand results and uncertainty | [Read results in the workspace](UX_GUIDE.md#read-results-and-keep-alternatives) → [Measurement and interpretation](MODEL_GUIDE.md#measurement-and-interpretation) |
| Integrate or extend the engine | [Headless API](API.md) → [Architecture](ARCHITECTURE.md) → [Contributing](../CONTRIBUTING.md) |

## Use the application

| Guide | What you will find |
| --- | --- |
| [Quickstart](QUICKSTART.md) | Open a template, try a capacity decision, reproduce the demo, calculate, save and reopen a project. |
| [Workspace guide](UX_GUIDE.md) | Properties, demand and duration, teams and shifts, process editing, comparisons, replay, keyboard controls and smaller screens. |
| [Build a facility](FACILITY_GUIDE.md) | Start empty, place and arrange objects, connect process cells, save templates and transfer the complete facility. |
| [Starter templates](TEMPLATES.md) | All twelve starters, their process questions, two alternatives each, assumptions and personal templates. |
| [Export and share](SHARING.md) | Choose project JSON, run JSON, CSV, PNG, HTML or print/PDF and keep the calculation context with the result. |

## Understand the simulation

The visual world and the numerical model have different roles. Artwork and walking make a process easier to follow; arrivals, durations, routing, queues and capacity determine its results.

- [Model guide](MODEL_GUIDE.md): process steps, distributions, priorities, patience, resources, calendars, event ordering, measurement, reproducibility and CSV inputs.
- [Measurement and interpretation](MODEL_GUIDE.md#measurement-and-interpretation): completed versus unfinished work, waiting samples, percentiles, warm-up, replay limits and uncertainty.
- [Replications and paired comparisons](API.md#replications-and-paired-comparisons): run repeated experiments and compare compatible plans through the headless API.
- [Bounded capacity search](API.md#bounded-capacity-search): search a finite set of shared-resource capacities and retain separate verification runs.
- [Portable examples](../examples/README.md): synthetic reference projects and reproducible command-line runs.

The supplied examples are learning models. Real decisions need appropriate inputs, validation and an understanding of uncertainty. A single run is not a general improvement guarantee.

## Develop and deploy

| Guide | What you will find |
| --- | --- |
| [Headless API](API.md) | Build/import commands, public exports, project validation, one run, replay statistics, experiments and the CLI contract. |
| [Architecture](ARCHITECTURE.md) | Model, calculation, rendering and storage boundaries; immutable results; templates and empty layouts. |
| [Contributing](../CONTRIBUTING.md) | Where to make a change, what evidence to include, template/demo exports and publication checks. |
| [Testing](QUALITY.md) | Automated coverage and browser smoke-check commands. |
| [Static hosting](DEPLOYMENT.md) | Build a static deployment, configure a subpath, serve media and verify the deployed source revision. |
| [Security](../SECURITY.md) | Supported reporting and handling of vulnerabilities. |

## Assets, media and licenses

- [Prepared asset catalogue](CATALOGUE.md): the browser-ready inventory, source preparation and verification.
- [World assets and attribution](NVIDIA_ASSETS.md): model, people, surroundings and lighting sources, plus browser adaptations.
- [Demo media](media/README.md): videos, screenshots, repository artwork, recording scope and credits.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): the separate licenses for dependencies, artwork, fonts, music and effects.
- [Code license](../LICENSE): MIT terms for original Loopset code.

## Get help

[Open an issue](https://github.com/berkebasbay/loopset/issues/new/choose) with a small synthetic example, the actions you took and the result you expected. Keep personal or customer data out of public examples.
