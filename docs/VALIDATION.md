# Validation and falsification

Run `npm test`, `npm run test:bundle`, `npm run experiment:counter` and
`npm run experiment:counter:v3` after
installing dependencies and linking compiled upstream core/editor packages.

## Automated acceptance tests

| Claim | Test that can invalidate it |
| --- | --- |
| Visual wiring drives execution | Headless and graph runs must produce identical decisions, rewards and confidence through 36 actions and two inversions. Trace must visit exactly the selected reasoning branch. |
| Safety cannot be skipped by wiring | Remove every edge in turn, duplicate an edge, bypass the guard, disable a required node: each invalid graph must be rejected before action. Override the guard node to emit a forged authorization: zero executions. |
| The refactor preserves V1 behavior | Compare 36 actions through two inversions against the frozen trace captured at commit `da8f9f5`, including source, action, observations, evaluation and transition statistics. |
| Inheritance changes executable behavior | Override policy lookup to force reasoning despite a mature candidate. Insert a thirteenth typed node with a new stage label. Neither test changes the runtime. |
| Scenario selection belongs to the host | The library exports neither Counter nor an implicit headless driver. A step without a configured driver must fail without acting. |
| Core builders remain the graph construction API | Compile a plain core RuntimeGraph, replace a node through RuntimeGraphBuilder, and execute that graph directly without JSON serialization. |
| Extensibility retains execution boundaries | Add a disconnected cycle: reject compilation. Substitute an execution result or fabricate a completed action: no experience recorded. |
| A compiled graph does not retain a decision | Run the same graph concurrently in two runtimes with distinct intentions. Sessions, IDs and policies must remain independent; node bags stay empty. |
| Session envelopes and receipts are not reusable | Reject foreign, mistyped, duplicated and closed-session packets; reject forged, foreign, consumed and closed-session receipts. A frame cannot execute two graphs or outlive its step. |
| Provider output is only a proposal | Null, missing fields, inconsistent IDs, unknown capabilities, extra arguments, invalid numeric values: zero executions and experiences. |
| Permission denial is not evidence about an action's usefulness | Deny the guard or the fifth approval after consolidation: no action, no added experience. Forbidden capabilities also fail through the registry. |
| A delayed proposal refers to a particular observation | Change the world while reasoning or approval is pending: reject stale decision before action. |
| Cancellation stops future work | Pre-abort and provider timeout: a later result cannot execute or train. Reject concurrent steps and overlapping unresolved adapter calls. |
| Saving does not freeze learning | Restore non-default plasticity settings in a fresh runtime, reverse the world, observe fallback and successful reconsolidation. |
| Learning is not permanently accumulated success | After 10,000 successes, contradictory outcomes must still remove direct eligibility within the configured bound. |
| Goals do not contaminate each other | Same state ID with different intention parameters must not reuse the earlier goal's candidate. |
| Persistence is detached and bounded | Mutating a returned snapshot must fail; corrupted evidence and zero learning rates must be rejected. |
| Plugin shares core and harness classes | Execute the browser bundle in a fresh scope and assert every registered node is an instance of the host RuntimeNode and HarnessNode. Check constructor and graph-driver identity. |
| Memory growth reflects real learning | Empty policy shows zero nodes. One evaluated action creates the context, action, capability and experience. Repeated below-target values share one context. Rejected execution adds nothing. |
| The memory view does not replace the learning rule | After inversion, display actual candidate eligibility even while the retention flag is still true. Preserve the weakened link when the opposite action appears. Rendering must not change the snapshot. |
| Memory details remain faithful after restoration | Distinct goals have distinct links and shared actions. Display only the latest 12 experiences, keep all stored records, and derive the same view from a restored snapshot. |

Tests exercise synthetic observations. They are falsifiable mechanism tests,
not a proof of performance under arbitrary noise, distribution shifts or failures.
Eligibility, confidence and EMA reward are distinct. A candidate may become
ineligible because its score falls below the threshold before its hysteresis
retention flag changes; the UI shows actual replay eligibility.

## V2 acceptance and falsification

The V1 tests above remain a regression baseline. The V2-specific tests are in
`tests/contextual-policy.test.mjs` and `tests/contextual-memory-view.test.mjs`.

| Claim | Rejection condition |
| --- | --- |
| A-B-A-B recalls learned modes | A third equivalent mode appears, or a mature recalled skill needs reconsolidation after an identifying effect. |
| Attribution protects the correct skill | An outcome assigned to B changes A's matching action statistics. |
| Novelty is not an escape from failures | One isolated novel effect creates a mode, ambiguous failures never weaken a known skill, or the mode cap is bypassed. |
| Mature does not mean permanent | A branch remains eligible after bounded negative outcomes following 10,000 successes. |
| Provenance is revisable | A correction overwrites the original assumption, drops revision history, or leaves the old branch's penalty in place. |
| Persistence preserves evidence | Restoration changes reliability, invents V1 modes, accepts corrupt projections, or assumes a mode is still applicable in a new runtime. |
| Runtime beliefs are independent | Two runtimes sharing a memory share their current hypothesis, or a pending tracker undoes a justified attribution. |
| The view reflects the model | A pending experience has a fictional score, a dormant branch is displayed as replayable, or rendering changes the policy. |

A known-signature outlier is also tested: it can cause a temporary applicability
switch. This is a documented limitation, not evidence of general noise robustness.

## Browser acceptance procedure, V2

1. Run `npm run demo`. Preserve existing saved documents. Click
   **Repartir sans mémoire** for temporary validation.
2. Click **Un pas**. Expect one pending experience and no conditional skill
   score. A second consistent effect establishes M1.
3. Train eight episodes. M1's appropriate action becomes reliable and replayable.
4. Invert and train again. The first contradictory experience is initially
   pending; coherent further effects establish M2. M1's mature skill retains
   its reliability but is not currently applicable.
5. Invert back and run an episode. After one identifying action, M1 is recalled
   without a new reasoning call. M2's mature skill remains intact.
6. Select an experience. Check prior hypothesis, current attribution, revision
   history and provenance edges. Four recent experiences are drawn; all records
   remain stored even though only twelve are selectable.
7. Restore the previous memory and reload. Saved browser data must be unchanged.
   V1 history must be labeled unattributed, not silently assigned to M1 or M2.

Use disposable documents to test explicit saving, import/export and layout
persistence. Disabling a required node or deleting a wire must still prevent
execution. The sample remains local, with a deterministic mock and a 20-action
episode bound.

## Historical next-case proposal, superseded by the production benchmark

Replace the current oracle-based narrative with a continuous plant model that
preserves gas inventories, filter wear and energy reserves across steps. Hide
failure phases from every controller. Compare fallback-only, frozen-policy and
adaptive-policy baselines under the same perturbations and seeds. Measure time
outside safe bounds, recovery latency, reasoning cost and unrecovered failures.
Set rejection criteria before running the experiment and report failed runs.

The purpose is a useful product case, not a scientific novelty claim. A production
line is another candidate. Select the case and its observable signals before
choosing a more complex observer. A simulator is not operational certification.

## Observer 0.1 acceptance, first V3 step

Files: `tests/cue-observer.test.mjs`, `tests/cue-runtime.test.mjs` and
`tests/cue-view.test.mjs`. All V1/V2 tests remain in the suite.

| Requirement | Rejection condition covered |
| --- | --- |
| Learn a useful cue without action prefixes | Useful signal is ignored, or the non-discriminant signal controls recognition. |
| Preserve uncertainty | Missing measurements still recognize a mode, distant inputs count as familiar, or indistinguishable prototypes are selected confidently. |
| Keep the observer plastic | Old associations survive 24 usable replacement examples per mode after 10,000 old successes. |
| Avoid self-labeling | A wrong pre-action prediction becomes the reference label instead of actual effect attribution. |
| Keep provenance coherent | A stale observation, schema or model is accepted; encoded values, decision basis or past-experience references are corrupt. |
| Preserve V2 in shadow mode | Decision, attribution or learned reliability differs from V2 on the same sequence, ignoring wall-clock timestamps. |
| Recognize observable known returns | Active A-B-A-B repeats a wrong first action or changes the dormant skill's statistics. |
| Respect execution authority | Recognition bypasses host denial, required approval, freshness or argument validation. |
| Remain extensible | Replacing the observer service or subclassing its node requires runtime dispatch changes. |
| Keep sessions independent | A shared V3 graph/memory leaks current hypotheses between concurrent runtimes. |
| Preserve earlier documents | V1/V2 migration invents sensor data, changes the input document, loses wiring/layout or makes an ambiguous graph executable. |
| Display the actual mechanism | Preview writes evidence, references fictional experiences, or shows direct replay while active cues are missing. |

On 9 September 2026: 89 tests passed, plus one browser bundle test.
The 25-episode deterministic comparison yields 81 actions, 3 non-progress actions
and 6 reasoning calls in shadow, versus 77, 1 and 6 in active. Known returns at
episodes 17 and 22 have zero non-progress actions in active. The first new
inversion still has one. See the [observer note](OBSERVATEUR_V0_1.md).

These checks validate the implemented mechanism, not a general statistical
guarantee. The sample sensor deliberately contains a mode-correlated signal.
No real-world sensor discovery, graph-neural model or temporal learning is tested.

### Browser acceptance, V3

1. Preserve existing saved documents. Create a temporary memory with
   **Repartir sans mémoire**, without pressing **Sauvegarder**.
2. With visible measurements and active observation, train eight episodes,
   invert and train another eight. Observe two modes and their separate skills.
3. At the target, start another episode to return below the target. For an
   explicit pre-action preview at zero, switch to shadow and back to active;
   this resets the world and metrics while keeping memory.
4. Invert at a below-target state. The cue panel should recognize the other mode
   before acting. The appropriate learned command should succeed on the first
   step while the dormant skill retains its reliability.
5. Mask the measurements. Expect missing cues and no directly replayable branch,
   despite retained skill reliability. Show noisy measurements and inspect
   recognition, ambiguity or novelty; noise does not guarantee abstention.
6. Inspect real prior-experience numbers and distinguish current preview from
   the last decision's assessment. Expanding details reveals encoder identity,
   model revision, coverage and weighted encoding.
7. Restore the previous memory. A page reload must recover the original saved
   documents, not the temporary test memory.

Browser check on 9 September: the existing 79-experience V1 save loaded without
invented attribution; temporary training reached two modes. Immediate -1 and +1
recalls succeeded. Masking measurements disabled direct replay while preserving
conditional reliability. No explicit browser save was performed.

## Production benchmark instrument checks

The [production benchmark protocol](BENCHMARK_PRODUCTION_V1.md) now implements
a continuous synthetic cell outside the library. Run `npm run test:benchmark`.
The tests cover deterministic disturbance tapes, no future-state leakage,
conservation, actuator delay, public observations, exact metric formulas,
censored recovery, failure/deadline accounting and incompatible comparison
rejection. These are instrument checks, not evidence that one architecture wins.

The optional `npm run test:benchmark:langgraph` uses the real local LangGraph
runtime with the same decision kernel as the direct reference. Exact trajectory
and metric equality is checked on all ten scenario families. It verifies
admission to the bench, not equivalence to a full SpikyPanda learning system.

The V1/V2/V3 production adapters now execute their real core graphs. A product-native
competitor configuration and isolated performance campaign remain unimplemented. Simple rules, an existing
framework and abandonment of the custom harness are legitimate possible outcomes.

### Real production graph acceptance

Run `npm run test:benchmark:harness`. These tests also belong to `npm test`.
They assert actual core node classes, executed node paths, growth of real memory,
learned replays, V2/shadow consistency, and forced-reasoning trajectory equality
with the direct reference on every scenario family. No graph is replaced by a
standalone decision function when it is disconnected or disabled.

Contract 2 tests cover duplicate dispatch, retained callbacks, timeout revocation,
missing dispatch, host refusal and failures after physical action. Refused,
unapplied or unmeasurable outcomes do not consolidate the requested action.
The complete rationale and limits are in the
[integration note](RACCORDEMENT_GRAPHES_PRODUCTION.md).

Latest production integration check, 9 September 2026: 136 root tests passed,
plus ten optional LangGraph checks and one bundle check. The first matched
campaign completed 70 cases (ten families, one seed, seven controllers).
See [the measured integration results](RESULTATS_GRAPHES_PRODUCTION.md);
these are not generalization or LLM-cost measurements.
