# Execution contract, visual milestone 01

## Shared pipeline

`AdaptivePolicyRuntime.step(intention, signal?, driver?)` opens a decision session.
The default driver runs the same stages used by the plugin's RuntimeNodes:

```text
observe > context > lookup > gate
                               policy ------------------+
                               fallback > request > reason
                                                        |
                    merge <-----------------------------+
                      > guard > execute > observe-after > evaluate > record
```

`createGraphDriver(definition, onNode?)` compiles actual saved nodes and edges to
core `RuntimeNode`, `Channel`, `RuntimeGraph` and `Session` instances. A small
Session adapter delivers queued messages during the current core's asynchronous
topological pass. It uses public core APIs; it does not duplicate a graph engine
or modify the upstream repository. Delayed links, nested graphs, cycles,
multiple actions and parallel branches are intentionally outside this version.

Every runtime node passes an opaque `DecisionFrame`. The runtime keeps the
observation, proposal, results and stage state privately. Rewiring a decision
straight into an executor cannot manufacture an authorization. Exact stage
order, one token per selected branch and one session per decision are enforced.
The merge consumes either the policy branch or the reasoning branch, never both.

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
- Capabilities recheck availability before execution.
- After any approval delay, the runtime observes again and compares the full
  observation with the original frozen one. A stale proposal is rejected.

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
Incomplete drafts can be saved; execution validates the complete 12-stage graph.

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
It expects the host's shared `globalThis.SpikypandaCore` and exports
`globalThis.SpkPluginHarness`. The demo uses `loadPluginFromUrl`, the real editor
NodeRegistry and GraphViewer. The bundle smoke test checks `instanceof` against
the host core. Node Editor remains a locally linked private upstream package.

The browser builder explicitly loads `reflect-metadata`. Upstream Node-only
dataset helpers are not supported in the browser; calls to those builtins throw
instead of silently succeeding. The Node ESM loader and async Session adapter
are temporary compatibility bridges that should be removed after upstream fixes.
