# Implementation plan

## Point de référence avant V2

Voir l'[état des lieux V1](docs/ETAT_DES_LIEUX_V1.md) pour distinguer les
réalisations vérifiées des travaux restants. Ce document fait référence pour
le jalon du 8 septembre 2026 ; les phases ci-dessous restent une feuille de
route et ne constituent pas une liste de fonctionnalités toutes livrées.

La prochaine évolution proposée concerne les contextes de fonctionnement
appris et la séparation entre fiabilité d'une branche et applicabilité
actuelle. Elle n'est pas implémentée. Les acquis V1 portent sur le pipeline
exécutable, les contrôles, la plasticité des scores et leur observation.
La preuve de résilience HELIOS et les adaptateurs LLM restent à réaliser.

## Delivered milestone: executable visual Counter

The headless and visual paths now share a guarded 12-stage pipeline. The local
editor demo loads the external plugin bundle, executes its visible graph, shows
traces and evolving policy eligibility, reverses the world dynamics, and saves
the harness and policy separately. JSON validation, fresh approval, stale-state
rejection, timeout/cancellation and session identity are covered by tests.

Scope remains deliberately limited to a single acyclic decision graph. A real
LLM adapter, general workflows, production authorization and continuous HELIOS
resilience experiments remain future work. See `docs/VALIDATION.md`.

## Phase 0: upstream package readiness

- Make `@spikypanda/nodeeditor` installable from an external repository.
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
