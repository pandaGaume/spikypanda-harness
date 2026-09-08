import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePolicyRuntime, CapabilityRegistry, PolicyGraph, DEFAULT_PLASTICITY_CONFIG } from "../packages/harness/dist/index.js";
import { createCounterHarness, createGraphDriver, parseHarnessDefinition } from "../packages/plugin-harness/dist/index.js";
import { CounterWorld, createCounterRuntime } from "../examples/counter/world.mjs";

const intention = { id: "reach-target", parameters: { target: 3 } };
const decision = () => ({ action: { id: "move", description: "Move" }, invocation: { actionId: "move", capabilityId: "move", input: { delta: 1 } } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
    let executions = 0;
    const world = { value: 0, async observe() { return { id: "same", features: { value: this.value } }; } };
    const policy = new PolicyGraph();
    const registry = new CapabilityRegistry(overrides.registryOptions);
    registry.register({ descriptor: { id: "move", description: "Move", replayPolicy: overrides.replayPolicy ?? "automatic",
        inputSchema: { type: "object", properties: { delta: { const: 1 } }, required: ["delta"], additionalProperties: false } },
        async execute(input, context) { executions++; if (overrides.execute) return overrides.execute(input, context); world.value++; return { ok: true }; },
        isAvailable: overrides.isAvailable,
    });
    const events = [];
    const runtime = new AdaptivePolicyRuntime({ policy, capabilities: registry, observer: world,
        fallback: { resolve: overrides.resolve ?? (async () => decision()) },
        evaluator: { evaluate: () => ({ success: true, reward: 1 }) },
        safetyGuard: overrides.safetyGuard, timeoutMs: overrides.timeoutMs, onStage: event => events.push(event),
    });
    return { runtime, policy, registry, world, events, executions: () => executions };
}

test("graph and headless drivers produce identical decisions and learning through two inversions", async () => {
    const policies = [new PolicyGraph(), new PolicyGraph()];
    const worlds = [new CounterWorld(), new CounterWorld()];
    const runtimes = worlds.map((w, i) => createCounterRuntime(policies[i], w).runtime);
    const visited = [];
    const driver = createGraphDriver(createCounterHarness(), (_id, stage) => visited.push(stage));
    const sources = [];
    for (let i = 0; i < 36; i++) {
        worlds.forEach(w => { if (w.value >= w.target) w.reset(); if (i === 12 || i === 24) w.invert(); });
        visited.length = 0;
        const a = await runtimes[0].step(intention);
        const b = await runtimes[1].step(intention, undefined, driver);
        assert.deepEqual(a.decision, b.decision);
        assert.equal(a.evaluation.success, b.evaluation.success);
        assert.equal(a.transitionAfter.confidence, b.transitionAfter.confidence);
        assert.equal(visited.at(-1), "record");
        assert.equal(visited.includes("reason"), b.source === "fallback");
        assert.equal(policies[1].snapshot().experiences.at(-1).decisionId, b.decisionId);
        sources.push(b.source);
    }
    assert.ok(sources.slice(6, 12).every(source => source === "policy"));
    assert.ok(sources.slice(12, 18).includes("fallback"));
    assert.ok(sources.slice(30).every(source => source === "policy"));
});

test("all incomplete, duplicate and guard-bypass graphs fail before side effects", async () => {
    const graph = createCounterHarness();
    for (let i = 0; i < graph.edges.length; i++) {
        const copy = structuredClone(graph); copy.edges.splice(i, 1);
        assert.throws(() => createGraphDriver(copy), /Missing/);
    }
    const duplicate = structuredClone(graph); duplicate.edges.push(duplicate.edges[0]);
    assert.throws(() => createGraphDriver(duplicate), /duplicate/);
    const disabled = structuredClone(graph); disabled.nodes.find(n => n.id === "guard").enabled = false;
    assert.throws(() => createGraphDriver(disabled), /Disabled/);
    const bypass = structuredClone(graph); bypass.edges.find(e => e.to === "execute").from = "merge";
    assert.throws(() => createGraphDriver(bypass), /Incompatible/);
    const f = fixture();
    await assert.rejects(f.runtime.step(intention, undefined, async (runtime, frame) => runtime.runStage("execute", frame)), /Invalid stage order/);
    assert.equal(f.executions(), 0);
});

test("malformed proposals and invalid arguments never execute or train", async () => {
    for (const proposal of [null, {}, { ...decision(), invocation: { ...decision().invocation, actionId: "other" } },
        { ...decision(), invocation: { ...decision().invocation, input: { delta: 99 } } },
        { ...decision(), invocation: { ...decision().invocation, input: { delta: 1, extra: true } } },
        { ...decision(), invocation: { ...decision().invocation, input: { delta: NaN } } },
        { ...decision(), invocation: { ...decision().invocation, capabilityId: "unauthorized" } }]) {
        const f = fixture({ resolve: async () => proposal });
        await assert.rejects(f.runtime.step(intention));
        assert.equal(f.executions(), 0);
        assert.equal(f.policy.snapshot().experiences.length, 0);
    }
});

test("guard denial does not become negative policy evidence", async () => {
    const f = fixture({ safetyGuard: { async validate() { return { allowed: false, reason: "denied" }; } } });
    await assert.rejects(f.runtime.step(intention), /denied/);
    assert.equal(f.executions(), 0);
    assert.equal(f.policy.snapshot().transitions.length, 0);
    assert.equal(f.events.at(-1).status, "error");
});

test("approval-required capabilities need fresh host approval even after consolidation", async () => {
    const noApproval = fixture({ replayPolicy: "approval-required" });
    await assert.rejects(noApproval.runtime.step(intention), /allowlist/);
    let approvals = 0;
    const f = fixture({ replayPolicy: "approval-required", registryOptions: { approve: async () => ++approvals < 5 } });
    for (let i = 0; i < 4; i++) await f.runtime.step(intention);
    await assert.rejects(f.runtime.step(intention), /Approval/);
    assert.equal(approvals, 5);
    assert.equal(f.executions(), 4);
    assert.equal(f.policy.snapshot().experiences.length, 4);
});

test("forbidden replay policy also applies to direct registry execution", async () => {
    const f = fixture({ replayPolicy: "never" });
    await assert.rejects(f.registry.execute(decision(), { decisionId: "x", state: await f.world.observe(), intention }), /forbidden/);
    assert.equal(f.executions(), 0);
});

test("world changes during reasoning or approval invalidate the proposal", async () => {
    for (const stage of ["reason", "approval"]) {
        const wait = deferred();
        const entered = deferred();
        const callback = async () => { entered.resolve(); await wait.promise; return stage === "reason" ? decision() : true; };
        const f = fixture(stage === "reason" ? { resolve: callback } : { replayPolicy: "approval-required", registryOptions: { approve: callback } });
        const result = f.runtime.step(intention);
        await entered.promise;
        f.world.value++;
        wait.resolve();
        await assert.rejects(result, /Stale decision/);
        assert.equal(f.executions(), 0);
        assert.equal(f.policy.snapshot().experiences.length, 0);
    }
});

test("pre-cancel, timeout and late provider completion never execute", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const f = fixture();
    await assert.rejects(f.runtime.step(intention, controller.signal), /cancelled/);
    const wait = deferred();
    const late = fixture({ timeoutMs: 25, resolve: () => wait.promise });
    await assert.rejects(late.runtime.step(intention), /timeout/);
    wait.resolve(decision());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(late.executions(), 0);
    assert.equal(late.policy.snapshot().experiences.length, 0);
});

test("concurrent decisions and overlapping uncertain capability calls are refused", async () => {
    const wait = deferred();
    const entered = deferred();
    const f = fixture({ timeoutMs: 60, execute: async () => { entered.resolve(); await wait.promise; return { ok: true }; } });
    const pending = f.runtime.step(intention);
    await entered.promise;
    await assert.rejects(f.runtime.step(intention), /already running/);
    await assert.rejects(pending, /timeout/);
    await assert.rejects(f.runtime.step(intention), /still in flight/);
    wait.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.executions(), 1);
    assert.equal(f.policy.snapshot().experiences.length, 0);
});

test("save/reload retains bounded plasticity but contains no services", async () => {
    const config = { ...DEFAULT_PLASTICITY_CONFIG, rewardAlpha: 0.4 };
    const policy = new PolicyGraph(undefined, config);
    const world = new CounterWorld();
    const { runtime } = createCounterRuntime(policy, world);
    const graph = createCounterHarness();
    for (let i = 0; i < 9; i++) { world.reset(); await runtime.step(intention, undefined, createGraphDriver(graph)); }
    const graphJson = JSON.stringify(graph);
    const policyJson = JSON.stringify(policy.snapshot());
    assert.ok(!graphJson.includes('"confidence":'));
    assert.ok(!graphJson.includes("runtime"));
    const restored = PolicyGraph.fromSnapshot(JSON.parse(policyJson));
    assert.equal(restored.plasticity.rewardAlpha, 0.4);
    const freshWorld = new CounterWorld(); freshWorld.invert();
    const fresh = createCounterRuntime(restored, freshWorld).runtime;
    const traces = [];
    for (let i = 0; i < 8; i++) { freshWorld.reset(); traces.push(await fresh.step(intention, undefined, createGraphDriver(JSON.parse(graphJson)))); }
    assert.equal(traces[0].source, "policy");
    assert.ok(traces.some(t => t.source === "fallback"));
    assert.equal(traces.at(-1).evaluation.success, true);
    assert.equal(traces.at(-1).source, "policy");
    assert.throws(() => parseHarnessDefinition({ ...graph, runtime: {} }), /services/);
});

test("snapshots cannot alias live policy and corrupted stats/config are rejected", async () => {
    const f = fixture(); await f.runtime.step(intention);
    const snapshot = f.policy.snapshot();
    assert.throws(() => { snapshot.transitions[0].stats.confidence = 0; }, TypeError);
    const copy = structuredClone(snapshot); copy.transitions[0].stats.effectiveEvidence = 100000;
    assert.throws(() => PolicyGraph.fromSnapshot(copy), /statistics/);
    assert.throws(() => new PolicyGraph(undefined, { ...DEFAULT_PLASTICITY_CONFIG, rewardAlpha: 0 }), /plasticity/);
    assert.equal(f.policy.findCandidateActions(await f.world.observe(), { ...intention, parameters: { target: 99 } }).length, 0);
});
