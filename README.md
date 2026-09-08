# SpikyPanda Harness

## État du jalon avant V2

L'[état des lieux V1 du 8 septembre 2026](docs/ETAT_DES_LIEUX_V1.md)
consigne les réalisations, les vérifications et les limites connues.
Le harnais exécutable et la révision des scores sont opérationnels dans
Counter. La reconnaissance de fonctionnements déjà rencontrés, la séparation
entre fiabilité et applicabilité et une mémoire relationnelle plus riche
restent à implémenter en V2. Le terme V1 désigne ce jalon expérimental ;
les paquets restent en version `0.1.0`.

Une [refactorisation des nœuds exécutables](docs/REFACTORISATION_NOEUDS.md)
succède à ce jalon : les comportements sont portés par héritage et surcharge
dans les nœuds, sans `runStage()` central. Elle conserve la logique
d'apprentissage V1 ; elle ne réalise pas encore la mémoire contextuelle V2.
Le scénario Counter est isolé dans `examples/counter`. La bibliothèque reçoit
un graphe explicite, construit avec les builders de core ou chargé depuis un
document de l'éditeur.

## Overview

SpikyPanda Harness is an experimental framework for building inspectable and
plastic decision harnesses on top of the SpikyPanda graph runtime.

The central rule is simple:

> Do not ask a reasoning provider twice for a decision that has already been
> learned, while continuously allowing reality to invalidate that decision.

The project separates three graphs:

1. The plant graph contains the physical model, deterministic control and hard
   safety rules.
2. The harness graph contains observation, policy lookup, fallback reasoning,
   capability execution and outcome evaluation.
3. The policy graph contains learned contexts, actions, bindings, transitions
   and experiences.

The harness runtime is headless, using `@spiky-panda/core` and Ajv validation. The
visual plugin depends on `@spikypanda/nodeeditor` and registers authoring
nodes for the existing SpikyPanda plugin loader.

## Workspace packages

- `@spiky-panda/harness`: headless policy graph, plasticity and runtime.
- `@spiky-panda/plugin-harness`: visual Harness nodes for Node Editor.
- `@spiky-panda/harness-provider-mock`: deterministic reasoning provider.

## Current dependency status

`@spiky-panda/core` and `@spikypanda/nodeeditor` are peer dependencies. During
local development they can be linked from a SpikyPanda checkout. The Node
Editor package is currently private in the upstream repository, so publishing
it or extracting a public plugin SDK is an upstream prerequisite for a clean
npm installation.

The current `@spiky-panda/core` ESM output also contains extensionless relative
imports. Node cannot resolve those imports natively. The test and experiment
commands use `scripts/spikypanda-esm-loader.mjs` as a local compatibility layer
until the upstream build emits Node-compatible `.js` specifiers.

## Commands

```sh
npm install
npm run link:spikypanda -- ../../spikypanda
npm run build
npm test
npm run experiment:counter
npm run experiment:helios
npm run demo
npm run test:bundle
```

`link:spikypanda` is only a local development bridge while the upstream
packages are not both published. Pass the path to a SpikyPanda checkout, or set
`SPIKYPANDA_REPO`. The command never replaces an existing dependency link.


## What the experiments demonstrate

The Counter experiment and browser demo share the same world, reasoning mock
and executable graph. They demonstrate cold-start fallback, consolidation,
direct policy decisions and adaptation after two reversals of the environment
dynamics. The mock receives observations and past failures, not the world's
hidden direction. It is a deterministic reference, not a real LLM.

The existing HELIOS script is only an illustrative scaffold: its mock reads
the hidden scenario phase and its CO2 state is reset between episodes. It does
not establish physical resilience. A continuous, non-oracle case study remains
a later milestone.

Neither experiment treats historical success counters as decision weights.
Lifetime counters exist for audit, while eligibility uses bounded exponentially
weighted evidence with promotion and demotion hysteresis.

## Safety boundary

The reasoning provider receives plain, frozen data and proposes a structured
capability call. The runtime validates the proposal and arguments, applies the
host guard, requests fresh approval when required, then verifies observation
freshness before execution. Graph wiring cannot skip these stages. Hard safety
rules remain outside learning. Providers and capability adapters are trusted
in-process code; this is not an isolation sandbox.

The default guard is permissive for experiments. Production hosts must provide
their own guard and capabilities. Cancellation is cooperative: a timed-out
external action may already have had an effect. The registry refuses overlapping
calls while an earlier adapter is unresolved. Never blindly retry an uncertain
action; use application-specific reconciliation and idempotency.

## Visual milestone

`npm run demo` starts the local editor on the fixed address
`http://127.0.0.1:4175` and opens the default browser once the server is ready.
If the same demo from this checkout is already running there, the launcher
verifies its identity and opens that instance without starting another server.
An occupied port belonging to another service or an older, unidentifiable demo
causes a clear error. No automatic port changes and no process termination occur.
Use `npm run demo -- --no-open` or `HARNESS_OPEN_BROWSER=0` to disable opening.
Set `HARNESS_PORT` only to explicitly choose a different fixed port. Browser
storage is specific to each port. The demo loads the
generated `SpkPluginHarness.js` through the existing Node Editor plugin loader,
using the same core and harness instances as its host. The host exposes
`globalThis.SpikypandaHarness` before loading the plugin. No remote service is called.

1. Click **Repartir sans mémoire** if a saved policy was loaded, then **Un pas**.
   The read-only memory graph grows from evaluated results, not from animation
   fixtures. Contexts, actions and capabilities appear; each learned link shows
   its current confidence and actual replay eligibility.
2. Keep **Ralentir pour voir l'apprentissage** enabled and run **Entraîner (8 épisodes)**.
   Repeated actions add experience nodes while revising the existing links.
3. Click **Inverser la dynamique**, then run more episodes. Observe failures,
   fallback reasoning and reconsolidation of the opposite action.
4. Save, reload, and run again. The policy remains plastic after restoration.
5. Edit the graph or rebuild it from the node palette. Invalid wiring, missing
   stages and disabled required nodes are rejected before any action.

The default palette contains 12 executable node classes and two alternative
decision branches. Trusted host factories can specialize nodes by inheritance
or add typed intermediate nodes without modifying the runtime. The compiler
validates one observation source, one experience sink, complete typed wiring
and acyclicity, without fixing the node count. It is not yet a general workflow
engine with arbitrary loops or parallel actions. Episodes are driven by the host.

The memory graph is distinct from the executable flow below it. Its stable
nodes and links are a projection of the real policy snapshot. In Counter,
values 0, 1 and 2 share the context "below target" for target 3. There is no new
context for every numerical value. Experience nodes are currently isolated
in the stored graph; the UI shows the latest 12 separately and derives their
association to a transition from their records when selected. All experiences
remain stored. The confidence shown on selection is the link's current value,
not a reconstruction of its historical value.

**Repartir sans mémoire** creates a new in-memory policy with the same plasticity
settings. **Retrouver la mémoire précédente** restores the previous policy
(multiple resets can be undone). These controls reset the simulated world and
runtime metrics, never browser storage. Recovery is available only until page
reload or closure. No learning algorithm or launcher port is changed by this view.

The harness definition and policy snapshot are saved separately, both as local
browser records and downloadable JSON files. Importing or reloading creates new
host services; the demo world starts at zero with normal dynamics. Graph JSON
does not serialize functions or service credentials. Observation, invocation and
experience data are application data: redact sensitive fields before persistence.

The post-V1 refactor preserves consolidated V1 harness and policy JSON documents.
Wire payloads are opaque, typed, session-bound packets. Drafts from before the
V1 port contract should still be rebuilt with the Counter template.

See [docs/EXECUTION.md](docs/EXECUTION.md) for the execution contract and
[docs/VALIDATION.md](docs/VALIDATION.md) for tests and known limits.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged roadmap.
