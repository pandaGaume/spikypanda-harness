import assert from "node:assert/strict";
import test from "node:test";
import { TopologyMemory, createTopologyHarness } from "../packages/harness/dist/index.js";
import { createTopologyFixture, routingDecision } from "../examples/topology/fixture.mjs";
import { createRoutingSample } from "../examples/topology/world.mjs";

test("actual harness propagates memory, executes one exact invocation and keeps experience in the session", async () => {
    const f = createRoutingSample(), snapshot = JSON.stringify(f.memory.definition);
    const a = await f.step();
    assert.equal(a.source, "policy"); assert.equal(a.decision.invocation.input.route, "a");
    assert.equal(f.counts.executions, 1); assert.equal(f.counts.fallbacks, 0);
    assert.equal(f.activation.inspect().passes, 1);
    assert.equal(f.activation.journal().length, 1);
    assert.equal(f.activation.journal()[0].activation.decisionId, a.decisionId);
    assert.equal(f.activation.journal()[0].arbitration.selected.branchId, "a");
    assert.deepEqual(f.activation.journal()[0].activation.proposals[0].signal.edgeIds, ["x-xy", "xy-a", "y-xy"]);
    f.set({ x: 0, y: 1, z: 1 }); const b = await f.step();
    assert.equal(b.decision.invocation.input.route, "b"); assert.equal(b.source, "policy");
    assert.equal(f.counts.executions, 2); assert.equal(f.activation.inspect().passes, 2);
    assert.equal(f.activation.journal().length, 2);
    assert.equal(JSON.stringify(f.memory.definition), snapshot);
    assert.equal(a.transitionAfter, undefined); assert.equal(a.cues, undefined); assert.equal(a.operatingBefore, undefined);
    f.activation.reset();
    assert.equal(f.activation.inspect().passes, 0); assert.equal(f.activation.journal().length, 2);
    assert.throws(() => { f.activation.journal()[0].evaluation.success = false; }, TypeError);
});

test("ambiguous, missing and cut paths use fallback once, not multiple capability attempts", async () => {
    const cut = createTopologyFixture(); cut.revision = "cut"; cut.edges = cut.edges.filter(e => e.id !== "y-xy");
    for (const options of [
        { features: { x: 1, y: 1, z: 1 } }, { features: { x: 1, z: 0 } },
        { memory: new TopologyMemory(cut) },
    ]) {
        const f = createRoutingSample(options), trace = await f.step();
        assert.equal(trace.source, "fallback"); assert.equal(trace.decision.invocation.input.route, "hold");
        assert.equal(f.counts.executions, 1); assert.equal(f.counts.fallbacks, 1);
        assert.equal(f.activation.journal().length, 1);
    }
});

test("same invocation supported by two paths causes only one real action", async () => {
    const def = createTopologyFixture();
    def.nodes.find(n => n.id === "b").decision = routingDecision("a");
    const f = createRoutingSample({ memory: new TopologyMemory(def), features: { x: 1, y: 1, z: 1 } });
    const trace = await f.step();
    assert.equal(trace.source, "policy"); assert.equal(f.activation.inspect().lastPass.proposals.length, 2);
    assert.equal(f.counts.executions, 1);
});

test("TOP-15 recognized paths never bypass guards, approval or last-moment freshness", async () => {
    for (const failure of ["guard", "approval", "stale", "topology", "expired"]) {
        let f;
        f = createRoutingSample({ replayPolicy: "approval-required", hooks: {
            guard: async () => ({ allowed: failure !== "guard", reason: "host-denied" }),
            approve: async () => {
                if (failure === "expired") f.elapse(3);
                if (failure === "stale") f.set({ x: 0, y: 1, z: 1 });
                if (failure === "topology") f.memory.graph.links[0].enabled = false;
                return failure !== "approval";
            },
        } });
        await assert.rejects(f.step(), /host-denied|Approval|Stale|projection changed|expired/);
        assert.equal(f.counts.executions, 0); assert.equal(f.activation.journal().length, 0);
        assert.equal(f.activation.inspect().passes, 1);
    }
});

test("forbidden, unavailable and malformed capabilities fail without action or reinforcement", async () => {
    for (const options of [
        { replayPolicy: "never" },
        { hooks: { available: () => false } },
        { features: {}, hooks: { fallback: () => routingDecision("invalid-schema-value") } },
    ]) {
        const f = createRoutingSample(options);
        await assert.rejects(f.step());
        assert.equal(f.counts.executions, 0); assert.equal(f.activation.journal().length, 0);
    }
});

test("a failed real outcome is journaled, not assigned to dormant or active branches in T1", async () => {
    let failures;
    const f = createRoutingSample({ hooks: { evaluate: () => ({ success: false, reward: -1 }),
        fallback: input => { failures = input.recentFailures; return routingDecision("hold"); } } });
    const snapshot = JSON.stringify(f.memory.definition);
    const trace = await f.step();
    assert.equal(trace.evaluation.success, false); assert.equal(f.activation.journal()[0].evaluation.success, false);
    assert.equal(JSON.stringify(f.memory.definition), snapshot);
    f.set({ x: 1, y: 1, z: 1 });
    await f.step();
    assert.equal(failures.length, 1);
    assert.equal(f.activation.journal().length, 2);
    assert.equal(f.counts.executions, 2);
    assert.equal(f.activation.journal()[1].arbitration.reason, "ambiguous");
    assert.equal(f.activation.journal()[1].decision.source, "fallback");
    assert.equal(JSON.stringify(f.memory.definition), snapshot);
});

test("duplicate observation identities block a second decision before the actuator", async () => {
    const f = createRoutingSample({ hooks: { identify: (_context, session) => ({
        observationId: "same-sensor-frame", observedAtSeconds: session.now() / 1000, availableAtSeconds: session.now() / 1000,
    }) } });
    await f.step(); f.set({ x: 0, y: 1, z: 1 });
    await assert.rejects(f.step(), /Repeated/);
    assert.equal(f.counts.executions, 1); assert.equal(f.activation.journal().length, 1);
});

test("separate interaction sessions safely share the same compiled memory concurrently", async () => {
    const memory = new TopologyMemory(createTopologyFixture());
    const a = createRoutingSample({ memory }), b = createRoutingSample({ memory, features: { x: 0, y: 1, z: 1 } });
    const [ta, tb] = await Promise.all([a.step(), b.step()]);
    assert.equal(ta.decision.invocation.input.route, "a"); assert.equal(tb.decision.invocation.input.route, "b");
    assert.equal(a.activation.journal().length, 1); assert.equal(b.activation.journal().length, 1);
    assert.notEqual(a.activation.session, b.activation.session);
});

test("activation reset and overlapping runtime decisions are refused while approval is pending", async () => {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const f = createRoutingSample({ replayPolicy: "approval-required",
        hooks: { approve: () => { entered(); return new Promise(resolve => { release = resolve; }); } } });
    const pending = f.step(); await waiting;
    assert.throws(() => f.activation.reset(), /active/);
    await assert.rejects(f.step(), /already running/);
    release(true); await pending;
    assert.equal(f.counts.executions, 1);
});

test("model/schema timing failures stop the flow before fallback or action", async () => {
    const f = createRoutingSample({ hooks: { identify: () => ({
        observationId: "old", observedAtSeconds: 0, availableAtSeconds: 0,
    }) } });
    f.set({ x: 1, y: 1, z: 0 }); f.set({ x: 1, y: 1, z: 0 });
    await assert.rejects(f.step(), /stale/);
    assert.equal(f.counts.executions, 0); assert.equal(f.counts.fallbacks, 0);
    for (const foreign of ["policy", "driver", "operatingContexts", "cueObserver", "cueMode"])
        assert.throws(() => createTopologyHarness({ [foreign]: null }), /Foreign services/);
});
