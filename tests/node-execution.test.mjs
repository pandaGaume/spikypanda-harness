import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AdaptivePolicyRuntime, CapabilityRegistry, PolicyGraph, PolicyMetrics, HarnessSession, HarnessNode,
    PolicyLookupNode, CapabilityExecutorNode, OutcomeObserverNode, createHarnessNode, harnessPort, createGraphDriver, createRuntimeGraphDriver, compileHarnessGraph,
    createDecisionContext } from "../packages/harness/dist/index.js";
import { CounterWorld, createCounterRuntime, counterReasoner } from "../examples/counter/world.mjs";

import * as harness from "../packages/harness/dist/index.js";
import { RuntimeGraph, RuntimeGraphBuilder } from "@spiky-panda/core";
import { createCounterHarness } from "../examples/counter/harness.mjs";

const intention = { id: "reach-target", parameters: { target: 3 } };
const baseline = JSON.parse(await readFile(new URL("./fixtures/v1-counter-trace.json", import.meta.url), "utf8"));
const decision = { action: { id: "increment", description: "increment" },
    invocation: { actionId: "increment", capabilityId: "counter.move", input: { delta: 1 } }, source: "fallback" };

function fixture(guard = { async validate() { return { allowed: true }; } }) {
    const world = new CounterWorld(), policy = new PolicyGraph(), capabilities = new CapabilityRegistry();
    let executions = 0;
    capabilities.register({ descriptor: { id: "counter.move", description: "Move", replayPolicy: "automatic" },
        async execute({ delta }) { executions++; world.value += delta; world.revision++; return { ok: true, output: world.value }; } });
    const services = { policy, observer: world, fallback: { resolve: async input => counterReasoner(input) },
        evaluator: { evaluate: () => ({ success: true, reward: 1 }) }, metrics: new PolicyMetrics() };
    return { world, policy, capabilities, services, executions: () => executions,
        runtime: new AdaptivePolicyRuntime({ driver: createGraphDriver(createCounterHarness()), ...services, capabilities, safetyGuard: guard }),
        session(graph) { return new HarnessSession(graph, { frame: { decisionId: crypto.randomUUID() }, startedAt: 0,
            signal: new AbortController().signal, intention, services, capabilities, guard, clock: () => 1 }); } };
}

test("node-based execution preserves the consolidated V1 trace over two inversions", async () => {
    const policy = new PolicyGraph(), world = new CounterWorld();
    const { runtime } = createCounterRuntime(policy, world);
    const rows = [];
    for (let i = 0; i < 36; i++) {
        if (world.value >= world.target) world.reset();
        if (i === 12 || i === 24) world.invert();
        const trace = await runtime.step(intention);
        const { lastUsedAt, ...stats } = trace.transitionAfter;
        rows.push({ source: trace.source, action: trace.decision.action.id, before: trace.stateBefore.features.value,
            after: trace.stateAfter.features.value, evaluation: trace.evaluation, stats });
    }
    assert.equal(baseline.baseline, "da8f9f5");
    assert.deepEqual(rows, baseline.rows);
    assert.equal("runStage" in runtime, false);
});

test("the library has no sample graph and refuses execution without an explicit driver", async () => {
    assert.equal("createCounterHarness" in harness, false);
    assert.equal("headlessDriver" in harness, false);
    const f = fixture();
    const runtime = new AdaptivePolicyRuntime({ ...f.services, capabilities: f.capabilities });
    await assert.rejects(runtime.step(intention), /No harness graph configured/);
    assert.equal(f.executions(), 0);
    assert.equal(f.policy.snapshot().experiences.length, 0);
    const ownIntention = { id: "host-defined-goal", parameters: { target: 3 } };
    const trace = await runtime.step(ownIntention, undefined, createGraphDriver(createCounterHarness()));
    assert.equal(trace.intention.id, "host-defined-goal");
    assert.equal(f.executions(), 1);
});

test("core RuntimeGraphBuilder can replace a node and execute directly without serialization", async () => {
    let lookups = 0;
    class AlwaysReasonLookup extends PolicyLookupNode {
        async execute(context) { lookups++; return { slot: "candidates", value: { context, candidates: [] } }; }
    }
    const original = compileHarnessGraph(createCounterHarness());
    assert.equal(Object.getPrototypeOf(original), RuntimeGraph.prototype);
    const lookup = original.nodes.find(node => node.id === "lookup");
    const replacement = new AlwaysReasonLookup();
    replacement.id = lookup.id; replacement.type = lookup.type;
    const graph = new RuntimeGraphBuilder(original).replaceNode(lookup, replacement).build();
    assert.equal(graph.mode, "static");
    assert.ok(graph.links.every(link => link.oini !== lookup && link.ofin !== lookup));
    const driver = createRuntimeGraphDriver(graph);
    const f = fixture();
    for (let i = 0; i < 5; i++) {
        f.world.reset();
        assert.equal((await f.runtime.step(intention, undefined, driver)).source, "fallback");
    }
    assert.equal(lookups, 5);
    assert.equal(f.executions(), 5);
    assert.equal(f.policy.snapshot().transitions[0].stats.directEligible, true);
});

test("a lookup subclass changes behavior without runtime dispatch changes", async () => {
    let lookups = 0;
    class AlwaysReasonLookup extends PolicyLookupNode {
        async execute(context, session) {
            lookups++;
            const output = await super.execute(context, session);
            return { ...output, value: { ...output.value, candidates: [] } };
        }
    }
    const def = structuredClone(createCounterHarness());
    def.nodes.find(n => n.id === "lookup").type = "Custom:always-reason";
    const factory = type => type === "Custom:always-reason" ? new AlwaysReasonLookup() : createHarnessNode(type);
    const driver = createGraphDriver(def, undefined, factory);
    const f = fixture();
    for (let i = 0; i < 5; i++) {
        f.world.reset();
        assert.equal((await f.runtime.step(intention, undefined, driver)).source, "fallback");
    }
    assert.equal(lookups, 5);
    assert.equal(f.executions(), 5);
    assert.equal(f.policy.snapshot().transitions[0].stats.directEligible, true);
});

test("a new intermediate node runs through the same core graph without a stage enum or fixed count", async () => {
    const visited = [];
    class ContextInspectionNode extends HarnessNode {
        constructor() { super("inspect-context", [harnessPort("in", "context")], [harnessPort("out", "context")]); }
        async execute(context) { assert.equal(context.intention.id, "reach-target"); return { slot: "out", value: context }; }
    }
    const def = structuredClone(createCounterHarness());
    def.nodes.push({ id: "inspect", type: "Custom:inspect", x: 400, y: 400 });
    def.edges.find(e => e.from === "context").to = "inspect";
    def.edges.find(e => e.from === "context").input = "in";
    def.edges.push({ from: "inspect", output: "out", to: "lookup", input: "context" });
    const factory = type => type === "Custom:inspect" ? new ContextInspectionNode() : createHarnessNode(type);
    const f = fixture();
    await f.runtime.step(intention, undefined, createGraphDriver(def, (_id, stage) => visited.push(stage), factory));
    assert.equal(f.executions(), 1);
    assert.equal(visited[visited.indexOf("context") + 1], "inspect-context");
    assert.equal(visited[visited.indexOf("inspect-context") + 1], "lookup");
    assert.equal(visited.at(-1), "record");
});

test("one graph instance can serve concurrent runtimes without node-bound decision state", async () => {
    const sessions = new Set();
    class SessionLookup extends PolicyLookupNode {
        async execute(context, session) { sessions.add(session); return super.execute(context, session); }
    }
    const graph = compileHarnessGraph(createCounterHarness(), type =>
        type === "Harness.Policy:lookup" ? new SessionLookup() : createHarnessNode(type));
    const driver = (runtime, frame) => runtime.executeGraph(graph, frame);
    const worlds = [new CounterWorld(), new CounterWorld()];
    worlds[1].target = 5;
    const policies = [new PolicyGraph(), new PolicyGraph()];
    const runtimes = worlds.map((world, i) => createCounterRuntime(policies[i], world, { delayMs: 15 }).runtime);
    const traces = await Promise.all(runtimes.map((runtime, i) => runtime.step(
        { id: "reach-target", parameters: { target: worlds[i].target } }, undefined, driver)));
    assert.equal(sessions.size, 2);
    assert.notEqual(traces[0].decisionId, traces[1].decisionId);
    assert.deepEqual(traces.map(t => t.intention.parameters.target), [3, 5]);
    assert.deepEqual(policies.map(p => p.snapshot().experiences.length), [1, 1]);
    assert.ok(graph.nodes.every(node => node.bag === undefined));
});

test("additional nodes cannot hide a disconnected cycle from core validation", () => {
    class PassThroughNode extends HarnessNode {
        constructor() { super("pass", [harnessPort("in", "context")], [harnessPort("out", "context")]); }
        async execute(context) { return { slot: "out", value: context }; }
    }
    const def = structuredClone(createCounterHarness());
    def.nodes.push(...["a", "b"].map(id => ({ id, type: "Custom:pass", x: 0, y: 0 })));
    def.edges.push({ from: "a", output: "out", to: "b", input: "in" }, { from: "b", output: "out", to: "a", input: "in" });
    assert.throws(() => compileHarnessGraph(def, type => type === "Custom:pass" ? new PassThroughNode() : createHarnessNode(type)), /not statically schedulable/);
});

test("the recorder rejects fabricated executions and substituted results", async () => {
    class FictionalExecutor extends CapabilityExecutorNode {
        async execute(_receipt, session) {
            return { slot: "result", value: { context: createDecisionContext(await session.services.observer.observe(), session.intention),
                decision, result: { ok: true } } };
        }
    }
    class AlteredResultObserver extends OutcomeObserverNode {
        async execute(input, session) {
            return super.execute({ ...input, result: { ...input.result, ok: false } }, session);
        }
    }
    for (const [type, ctor, expectedExecutions] of [
        ["Harness.Execution:capability", FictionalExecutor, 0],
        ["Harness.Observation:outcome", AlteredResultObserver, 1],
    ]) {
        const f = fixture();
        const driver = createGraphDriver(createCounterHarness(), undefined, key => key === type ? new ctor() : createHarnessNode(key));
        await assert.rejects(f.runtime.step(intention, undefined, driver), /completed execution/);
        assert.equal(f.executions(), expectedExecutions);
        assert.equal(f.policy.snapshot().experiences.length, 0);
    }
});

test("decision packets are session-owned, typed, single-use and invalidated on close", () => {
    const graph = compileHarnessGraph(createCounterHarness());
    const f = fixture(), a = f.session(graph), b = f.session(graph);
    const packet = a.packet("harness.state", { id: "below", features: { value: 0 } });
    assert.throws(() => b.take(packet, "harness.state"), /foreign/);
    assert.throws(() => a.take(packet, "harness.result"), /mistyped/);
    assert.throws(() => a.take({ decisionId: a.frame.decisionId }, "harness.state"), /foreign/);
    assert.equal(a.take(packet, "harness.state").id, "below");
    assert.throws(() => a.take(packet, "harness.state"), /duplicated/);
    a.close(); b.close();
    assert.throws(() => a.packet("harness.state", {}), /closed/);
});

test("execution receipts cannot be forged, transferred, replayed or redeemed after close", async () => {
    const f = fixture(), graph = compileHarnessGraph(createCounterHarness());
    const a = f.session(graph), b = f.session(graph);
    const selected = { context: createDecisionContext(await f.world.observe(), intention), decision };
    await assert.rejects(a.authority.execute({ authorizationId: "forged" }), /authorization/);
    const receipt = await a.authority.authorize(selected);
    await assert.rejects(b.authority.execute(receipt), /authorization/);
    await a.authority.execute(receipt);
    await assert.rejects(a.authority.execute(receipt), /authorization/);
    assert.equal(f.executions(), 1);
    b.close(); a.close();
    await assert.rejects(a.authority.execute(receipt), /closed/);
});

test("the authority enforces the host guard even when called outside the guard node", async () => {
    const f = fixture({ async validate() { return { allowed: false, reason: "host denied" }; } });
    const session = f.session(compileHarnessGraph(createCounterHarness()));
    await assert.rejects(session.authority.authorize({
        context: createDecisionContext(await f.world.observe(), intention), decision,
    }), /host denied/);
    assert.equal(f.executions(), 0);
    session.close();
});

test("a decision frame cannot start a second graph or outlive its runtime call", async () => {
    const f = fixture(), graph = compileHarnessGraph(createCounterHarness());
    let saved;
    await f.runtime.step(intention, undefined, async (runtime, frame) => {
        saved = frame;
        await runtime.executeGraph(graph, frame);
        await assert.rejects(runtime.executeGraph(graph, frame), /already started/);
    });
    await assert.rejects(f.runtime.executeGraph(graph, saved), /closed/);
    assert.equal(f.executions(), 1);
});
