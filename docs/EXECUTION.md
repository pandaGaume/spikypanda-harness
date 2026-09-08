# Execution contract, executable nodes after V1

## Shared pipeline

`AdaptivePolicyRuntime.step(intention, signal?, driver?)` opens a decision session.
The host must supply a driver in runtime options or to each step. No scenario
or default graph is embedded in the library. The headless Counter example and
its editor compile the same sample topology:

```text
observe > context > lookup > gate
                               policy ------------------+
                               fallback > request > reason
                                                        |
                    merge <-----------------------------+
                      > guard > execute > observe-after > evaluate > record
```

`createGraphDriver(definition, onNode?, factory?)` compiles saved nodes and edges
using core's `RuntimeGraphBuilder.withNodes`, `withChannel` and `build`.
`createRuntimeGraphDriver(graph, onNode?)` accepts a host-built core graph
directly, with the same harness validation and no JSON round trip.
`HarnessNode` overrides asynchronous execution and delegates business behavior
to each subclass's protected `execute(input, session)` method. A trusted host
factory can replace a built-in node with a subclass or insert additional typed
nodes. Stage strings label diagnostic events; they never dispatch behavior.

`AdaptivePolicyRuntime` owns decision IDs, deadlines, cancellation and the
single-run lifecycle. `HarnessSession extends Session` holds the run's services,
immutable packets, execution authority and final trace. Nodes do not retain
decision state in their `bag`. The same compiled, stateless graph can serve
distinct runtimes with separate sessions. Do not mutate its topology during a run.

Each wire carries an opaque, single-use packet whose typed payload belongs to
the current session. The merge consumes either the policy branch or the reasoning
branch, never both. Authorization receipts are bound to the exact approved
decision and its session. A differently wired node cannot manufacture a usable
receipt by emitting an object with the right port type.

The core owns ordering and dispatch. A small `HarnessSession.publish` adapter
delivers queued messages during the current core's asynchronous topological
pass, using its public APIs. This compatibility bridge does not duplicate a
graph engine or modify upstream. Delayed links, nested graphs, cycles, multiple
actions and parallel branches remain outside this version.

The provider receives an immutable snapshot of observations, intention,
available capabilities, candidates and recent failures, plus `decisionId` and
an AbortSignal. Ajv checks the proposal and capability input schema. Identical
action and invocation IDs are required. Unknown capabilities and extra arguments
are rejected. Schemas are compiled once at registration, with strict mode.

## Authorization and observation freshness

- `never` capabilities are not proposed or executed by the harness.
- `approval-required` capabilities need the host registry's `approve` callback,
  called on every invocation, including learned replays.
- `SafetyGuard` remains a host service, separate from learned confidence.
- `ExecutionAuthority.authorize` validates the decision and arguments, invokes
  that guard and issues a session-local receipt for the frozen proposal.
- `ExecutionAuthority.execute` consumes the receipt and permits at most one
  dispatch per decision. Overriding a node does not disable these checks.
- Capabilities recheck availability before execution.
- After any approval delay, the authority observes again and compares the full
  observation with the original frozen one. A stale proposal is rejected.
- The recorder checks the completed execution against the authority's receipt
  history before learning. A fabricated execution or substituted result is rejected.

Freshness is not the same as policy similarity. Counter deliberately groups
states into `below`, `above` and `at-target` for learning. Its numeric value and
revision still participate in the freshness check. Hosts should include a
revision in observations when a change followed by a return to identical sensor
values must invalidate a proposal.

This check is not an atomic transaction with a remote actuator. Use revision
preconditions at the actuator when the world can change between checking and
acting. The runtime is also not a security boundary against malicious adapters
executing arbitrary JavaScript in the same process.

## Failure semantics

Only a completed execution with a valid observation and evaluation records an
Experience. A capability may return `{ok:false}` for a known, observed failure;
the evaluator then supplies the learning signal. Invalid proposals, denied
permissions, stale responses, adapter exceptions, invalid evaluations, timeouts
and cancellations reject the step without adding learning evidence.

`onStage` receives start, complete and error events carrying the same decision
ID. A successful DecisionTrace and its Experience also retain that ID. Event
callbacks cannot interrupt execution. The fallback's own call counter measures
all provider calls; decision metrics describe resolved decisions reaching merge.

The default timeout is 10 seconds for the entire decision. Pending work receives
an AbortSignal, but an adapter may ignore it. A late reasoning response can no
longer execute or train. An already dispatched physical action cannot be undone
by a Promise timeout. While that adapter promise is unsettled, the registry
rejects further execution. Once it settles, the host must reconcile uncertain
effects before retrying, especially if the underlying remote operation continues
after the adapter reports a timeout. There is no exactly-once or durable
transaction guarantee in this milestone.

## Persistence

`HarnessDefinition` version 1 stores typed node IDs, positions, enabled states,
edges and the intention. It contains neither the policy nor runtime services.
Incomplete drafts can be saved. Execution validates port types, complete wiring,
enabled nodes, one observation source, one experience sink and an acyclic graph.
The default palette still has 12 nodes, but the compiler no longer requires
exactly that count or a hardcoded predecessor table. All declared ports require
one wire; the built-in merge is ready with either of its alternative inputs.
Source and sink extensions must inherit `StateObserverNode` and
`ExperienceRecorderNode`. This is not an unrestricted workflow engine.

Consolidated V1 documents keep their version, node IDs and port names. Custom
types require the host to supply their factory on parsing and compilation; JSON
does not contain executable code. Factories must create fresh nodes and avoid
side effects, as document validation may also instantiate nodes.

`PolicySnapshot` version 1 stores contexts, actions, capability descriptors,
transitions, experiences and the plasticity configuration. Older snapshots
without `plasticity` use the original defaults. Existing contexts without goal
parameters preserve their old keys. New goal parameters participate in matching.
Snapshots are detached, deeply frozen plain data. Imports validate identity,
endpoints, duplicate IDs and bounded statistics. A custom StateMatcher is a host
service and must be explicitly reattached when restoring a policy.

Configuration cannot disable exponential updating by setting an alpha to zero.
Audit totals never participate in eligibility; effective evidence remains capped.
Reloading does not promote, demote or otherwise rewrite learned statistics.

Neither file stores adapter functions or their credentials. Hosts must still
redact sensitive observation/action payloads before recording them. This version
does not implement journal compaction, encrypted storage or concurrent writers.

## External plugin loading

`npm run build:demo` creates `packages/plugin-harness/bundle/SpkPluginHarness.js`.
The host must expose `globalThis.SpikypandaHarness`, built against the same core
instance as its editor, before loading it. The demo also exposes
`globalThis.SpikypandaCore`. The bundle exports `globalThis.SpkPluginHarness`
and only registers/re-exports the shared executable nodes; it does not embed a
second harness runtime. The demo uses `loadPluginFromUrl`, the real editor
NodeRegistry and GraphViewer. The bundle smoke test checks both core and harness
class identity. Node Editor remains a locally linked private upstream package.

The browser builder explicitly loads `reflect-metadata`. Upstream Node-only
dataset helpers are not supported in the browser; calls to those builtins throw
instead of silently succeeding. The Node ESM loader and async Session adapter
are temporary compatibility bridges that should be removed after upstream fixes.

See [the refactoring note](REFACTORISATION_NOEUDS.md) for extension examples and
the migration from `runStage`, `selectedSource` and node-bound services.
