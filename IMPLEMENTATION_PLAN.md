# Implementation plan

## Phase 0: upstream package readiness

- Make `@spiky-panda/nodeeditor` installable from an external repository.
- Stabilize the public plugin, registry, serialization and GraphRunner APIs.
- Consider extracting the DOM-free contracts into `@spiky-panda/plugin-sdk`.
- Validate an external asynchronous plugin against installed packages.

## Phase 1: headless foundation

- Define State, Intention, DecisionContext, Action, Capability and Experience.
- Keep cumulative audit counters separate from adaptive decision weights.
- Implement exact matching and deterministic context keys.
- Implement policy graph snapshots and restoration.

## Phase 2: plasticity

- Add exponentially weighted reward and success estimates.
- Add bounded effective evidence.
- Add distinct promotion and demotion thresholds.
- Prove that a transition remains reversible after 10,000 successes.

## Phase 3: decision runtime

- Add capability and reasoning provider registries.
- Add policy lookup, fallback, safety, execution, observation and evaluation.
- Add decision traces, episode metrics, deadlines and cancellation.

## Phase 4: visual plugin

- Register State, Policy, Reasoning, Execution, Safety and Learning nodes.
- Inject runtime services after graph loading instead of serializing them.
- Add inspectors for candidates, transitions, experience and metrics.

## Phase 5: provider adapters

- Keep the deterministic mock as the reference provider.
- Add structured-output LLM adapters.
- Add human approval and MCP capability adapters.
- Never give a provider direct access to executable functions or secrets.

## Phase 6: resilience case study

- Run stationary, degraded, recovered and noisy HELIOS phases.
- Compare fallback-only, frozen policy and adaptive policy controllers.
- Report fallback ratio, safe-envelope violations, stale decisions and
  adaptation latency.

## Definition of done for the first release

- The Counter experiment reduces fallback calls without reducing success.
- The HELIOS experiment deconsolidates an obsolete scrubber strategy.
- Ten thousand historical successes do not prevent bounded adaptation.
- Policy snapshots round-trip without losing plasticity.
- The visual plugin loads without coupling the headless runtime to the editor.

