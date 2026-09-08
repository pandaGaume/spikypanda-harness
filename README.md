# SpikyPanda Harness

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

The harness runtime is headless and depends only on `@spiky-panda/core`. The
visual plugin depends on `@spiky-panda/nodeeditor` and registers authoring
nodes for the existing SpikyPanda plugin loader.

## Workspace packages

- `@spiky-panda/harness`: headless policy graph, plasticity and runtime.
- `@spiky-panda/plugin-harness`: visual Harness nodes for Node Editor.
- `@spiky-panda/harness-provider-mock`: deterministic reasoning provider.

## Current dependency status

`@spiky-panda/core` and `@spiky-panda/nodeeditor` are peer dependencies. During
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
```

`link:spikypanda` is only a local development bridge while the upstream
packages are not both published. Pass the path to a SpikyPanda checkout, or set
`SPIKYPANDA_REPO`. The command never replaces an existing dependency link.


## What the experiments demonstrate

The Counter experiment demonstrates cold-start fallback, consolidation,
direct policy decisions and adaptation after an invisible reversal of the
environment dynamics.

The HELIOS experiment tells the resilience story. A CO2 scrubber strategy is
learned, becomes ineffective when the filter degrades, is deconsolidated, then
is learned again after maintenance.

Neither experiment treats historical success counters as decision weights.
Lifetime counters exist for audit, while eligibility uses bounded exponentially
weighted evidence with promotion and demotion hysteresis.

## Safety boundary

The LLM or other reasoning provider proposes a structured capability call. It
cannot execute code, mutate the policy or bypass the safety guard. Hard safety
rules remain outside learning.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged roadmap.
