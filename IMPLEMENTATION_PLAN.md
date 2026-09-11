# Implementation plan

## Transversal learning trajectory

The [V1, V2, V3 and later milestones](docs/TRAJECTOIRE_V1_V2_V3.md) separate
delivered learning mechanisms from possible product-development stages. The accompanying
[design note](docs/NOTE_PLASTICITE_ET_CONTEXTE.md) states why applicability
conditions must be learned rather than manually attached to every action.
V3 now includes [observer 0.1](docs/OBSERVATEUR_V0_1.md), a first-party adaptive
metric with shadow and active modes. Temporal/relational representation learning,
V4 active diagnosis and V5 continuous resilience remain future work. No final
neural architecture has been selected. The objective is product control, not
scientific novelty; commercial dependencies are not required and critical logic
must remain first-party. No new dependency was added for this observer.
Those labels do not renumber the software workstreams below or the npm packages.

## Point de référence avant V2

Voir l'[état des lieux V1](docs/ETAT_DES_LIEUX_V1.md) pour distinguer les
réalisations vérifiées des travaux restants. Ce document fait référence pour
le jalon du 8 septembre 2026 ; les phases ci-dessous restent une feuille de
route et ne constituent pas une liste de fonctionnalités toutes livrées.

La V2 expérimentale implémente les contextes de fonctionnement issus de
signatures d'effets observés et sépare fiabilité conditionnelle et applicabilité.
Voir [le bilan V2](docs/V2_MEMOIRE_CONTEXTUELLE.md) pour son périmètre et ses limites. Les acquis V1 portent sur le pipeline
exécutable, les contrôles, la plasticité des scores et leur observation.
La preuve de résilience HELIOS et les adaptateurs LLM restent à réaliser.

## Delivered milestone: executable visual Counter

V1/V2 share a guarded 12-node decision graph. The V3 Counter sample adds
one cue-observation node, with a guarded 13-node graph. The local
editor demo loads the external plugin bundle, executes its visible graph, shows
traces and evolving policy eligibility, reverses the world dynamics, and saves
the harness and policy separately. JSON validation, fresh approval, stale-state
rejection, timeout/cancellation and session identity are covered by tests.

Scope remains deliberately limited to a single acyclic decision graph. A real
LLM adapter, general workflows, production authorization and continuous HELIOS
resilience experiments remain future work. See `docs/VALIDATION.md`.

## Delivered after V1: inherited executable nodes

Business behavior now lives in the concrete `HarnessNode` subclasses through
`execute(input, session)` overrides. `AdaptivePolicyRuntime` only owns the
decision lifecycle; it no longer dispatches stages. `HarnessSession` owns
run-local services and data, while `ExecutionAuthority` enforces authorization
at the capability boundary. Headless and visual paths share the same compiled
core graph. The plugin registers those shared classes.

Graph construction uses core's `RuntimeGraphBuilder`, not a parallel graph
implementation. Hosts inject an explicit driver; the library has no default
scenario. Counter and the illustrative topology live under `examples/`.
Host-built graphs can execute directly without serializing them first.

Trusted factories can override a node or insert an intermediate typed node
without changing the runtime. Tests compare the new execution against the
consolidated V1 trace and verify extensions, session isolation and authorization.
The detailed contract and migration are in
[docs/REFACTORISATION_NOEUDS.md](docs/REFACTORISATION_NOEUDS.md).
This structural milestone preserved V1 learning. The contextual V2 below builds
on its node extension points.

## Delivered: experimental contextual-memory V2

- Learn operating hypotheses from host-defined observed-effect signatures.
- Keep current applicability in a tracker owned by each runtime.
- Revise conditional reliability without penalizing a different attributed mode.
- Retain pending, confirmed, anomalous and revised experience provenance.
- Reuse known skills through A-B-A-B, while retaining bounded demotion.
- Restore version 2 snapshots and preserve unattributed V1 history.
- Show operating modes, dormant skills and real provenance in the Counter demo.

Exact signature matching and deterministic Counter validation are not a general
solution to latent-context discovery or noise. Continuous industrial validation
and real LLM adapters remain future work.

## Delivered: V3 first step, observer 0.1

- Versioned numeric cue schema and first-party adaptive discriminant metric.
- Recent, bounded training examples derived from actual V2 effect attribution.
- Shadow comparison and active pre-action recognition with an uncertain fallback.
- Observation identity, model revision and real prior-experience references.
- Node overrides, host-injected observer service and core builders.
- V3 memory wrapper; non-destructive V1/V2 sample migration without invented cues.
- Visible measurements, relevance weights, candidates and active/shadow controls.
- 89 passing tests plus the browser bundle test on 9 September 2026.

This is a learning and integration baseline, not the final observer. The algorithm,
formulas, evidence, product dependency constraints and remaining work are detailed
in [the observer note](docs/OBSERVATEUR_V0_1.md). A real product scenario must guide
the next representation, rather than choosing CNN/GNN by default.

## Delivered: architecture-independent production benchmark foundation

See [the protocol and metrics](docs/BENCHMARK_PRODUCTION_V1.md).
Ten scenario families define 330 reproducible cases across three disjoint seed
sets. The continuous synthetic plant, public observation contract, common guard,
metrics, failure accounting and JSON exports are independent of the harness.

A simple reactive controller is the floor. An isolated, optional LangGraph
adapter runs the same decision kernel to verify comparator admission. This is
not a product-level ranking or a claim of adaptive superiority.

Next, in order:

1. Delivered: connect real V1, V2, V3 shadow and V3 active graphs to the same
   public contract. Core builders, one-shot host dispatch and real post-action
   learning are implemented. See [the integration note](docs/RACCORDEMENT_GRAPHES_PRODUCTION.md).
   The common reasoner remains deterministic; no LLM performance claim is made.
2. Establish a credible existing-framework configuration, with a bounded and
   recorded integration/tuning effort. LangGraph is a candidate, not an obligation.
3. Reserve parameter ranges, combinations and a second system according to the
   [generalization protocol](docs/GENERALISATION_ET_BANCS.md). New seeds alone do
   not establish generalization. Extend the generator before making that claim.
4. Declare product acceptance thresholds and cost budgets before ranking.
5. Run matched scenarios and controlled provider configurations, retaining
   failures, non-recoveries and qualitative incident traces.
6. Decide whether to keep the harness, retain only memory/observation, adopt
   an existing framework or use simple control. Insufficient evidence remains
   an acceptable conclusion.

Critical product logic remains first-party under the current policy. Any
proposal to adopt a third-party runtime requires an explicit product decision;
the optional comparator does not change that policy. Warm memory, real LLM
metering, process-isolated resource measurements and industrial calibration
remain future work.

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
