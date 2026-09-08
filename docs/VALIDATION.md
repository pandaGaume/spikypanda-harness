# Validation and falsification

Run `npm test`, `npm run test:bundle` and `npm run experiment:counter` after
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

## Browser acceptance procedure

When checking an existing browser profile, preserve its saved documents. Use
**Repartir sans mémoire** for temporary learning, then restore the previous
memory and reload. Only exercise saving/layout persistence with disposable
documents or after explicitly backing up the user's saved state.

1. Start `npm run demo`. Confirm all 12 flow nodes and their wires are visible
   below the memory view. If a saved policy was loaded, click **Repartir sans mémoire**.
2. Run eight episodes. With default settings, 24 successful actions use three
   reasoning calls; subsequent actions replay the learned policy.
3. Invert the dynamics and run eight more episodes. Observe initial failures,
   loss of increment eligibility, fallback, and consolidation of decrement.
4. Save both documents and reload the page. Graph layout and both transitions
   must remain, while the runtime's counters and the world reset. The old policy
   must again adapt to the normal world without clearing its memory.
5. Disable the guard or delete a wire, then try a step. There must be no action.
   Restore it and retry. Move a node, save and reload: its position must persist.
6. Start with an empty graph, add the 12 catalogue nodes, wire corresponding
   typed ports, including both inputs to merge. An episode must run normally.
7. Export and import harness/policy independently. Invalid JSON, unknown types,
   impossible stats and incompatible ports must be reported. Failed imports
   should leave the existing working document intact.

For the memory-specific visual check, start with an empty memory and click
**Un pas**. Expect three entity nodes, one learned link, one capability binding
and experience #1. With default settings the confidence is rounded to 63%.
After training, invert the dynamics and advance one action at a time. The old
link stays visible as confidence drops to about 75%, then 56%; the second failure
makes it ineligible. The next action creates the opposite branch. Select a failed
experience: its original link, not the newest alternative, must be highlighted.
Click **Retrouver la mémoire précédente**, then **Recharger**: the original
memory must be recovered and browser storage must not have changed. In a long
run only 12 experience buttons remain visible, while the total continues growing.

The demo is local and uses a deterministic reasoning mock. It never calls a real
LLM. Stop does not rewind completed actions. Each episode is bounded at 20 actions.

## Next scientific milestone: continuous HELIOS

Replace the current oracle-based narrative with a continuous plant model that
preserves gas inventories, filter wear and energy reserves across steps. Hide
failure phases from every controller. Compare fallback-only, frozen-policy and
adaptive-policy baselines under the same perturbations and seeds. Measure time
outside safe bounds, recovery latency, reasoning cost and unrecovered failures.
Set rejection criteria before running the experiment and report failed runs.

Only after that experiment can the project claim evidence about a resilience
use case. This milestone establishes an executable, inspectable test instrument.
