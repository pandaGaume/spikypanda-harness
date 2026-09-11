import assert from "node:assert/strict";
import test from "node:test";
import { TemporalTopologyMemory, createTemporalTopologyHarness, DEFAULT_TOPOLOGY_TEMPORAL_CONFIG,
    createTopologyHarness, TopologyActivationSession, TopologyMemory } from "../packages/harness/dist/index.js";
import { createRoutingSample } from "../examples/topology/world.mjs";
import { createTopologyFixture } from "../examples/topology/fixture.mjs";
const A = { x: 1, y: 1, z: 0 }, B = { x: 0, y: 1, z: 1 };
const modes = ["continuous", "spikes", "spikes-modulated"];
function fixture(mode, options = {}) {
    const memory = new TemporalTopologyMemory(createTopologyFixture(),
        { ...DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, mode, resetAlpha: mode === "spikes-modulated" ? 0.8 : 0 });
    return createRoutingSample({ memory, createHarness: createTemporalTopologyHarness, ...options });
}
async function warm(f, count = 6) {
    for (let i = 0; i < count; i++) { await f.step(); f.set(A); }
}

test("each variant executes exactly one action per completed decision and journals the temporal provenance", async () => {
    const expected = { continuous: 8, spikes: 3, "spikes-modulated": 8 };
    for (const mode of modes) {
        const f = fixture(mode), snapshot = JSON.stringify(f.memory.definition);
        let policy = 0;
        for (let i = 0; i <= 10; i++) {
            const trace = await f.step();
            if (trace.source === "policy") { policy++; assert.equal(trace.decision.invocation.input.route, "a"); }
            else assert.equal(trace.decision.invocation.input.route, "hold");
            f.set(A);
        }
        assert.equal(policy, expected[mode]);
        assert.equal(f.counts.executions, 11); assert.equal(f.counts.fallbacks, 11 - policy);
        assert.equal(f.activation.inspect().passes, 11); assert.equal(f.activation.journal().length, 11);
        assert.ok(f.activation.journal().every(e => e.activation.temporal.config.mode === mode));
        assert.equal(JSON.stringify(f.memory.definition), snapshot);
        f.activation.reset();
        assert.ok(f.activation.inspect().integrators.every(b => b.potential === 0));
        assert.equal(f.activation.journal().length, 11);
    }
});

test("a just-recognized temporal branch still respects refusal, approval, expiry and Core revision checks", async () => {
    for (const mode of modes) for (const fault of ["guard", "approval", "expired", "changed-neuron"]) {
        let armed = false, f;
        f = fixture(mode, { replayPolicy: "approval-required", hooks: {
            guard: async () => ({ allowed: !armed || fault !== "guard", reason: "host-denied" }),
            approve: async () => {
                if (armed && fault === "expired") f.elapse(3);
                if (armed && fault === "changed-neuron") f.memory.branches[0].neuron.membraneTimeConstant += 1;
                return !armed || fault !== "approval";
            },
        } });
        await warm(f); armed = true;
        await assert.rejects(f.step(), /host-denied|Approval|expired|integrator projection/);
        assert.equal(f.counts.executions, 6); assert.equal(f.activation.journal().length, 6);
        assert.equal(f.activation.inspect().lastPass.proposals[0].branchId, "a");
    }
});

test("missing evidence and a switch cannot reuse a previously emitted invocation", async () => {
    for (const mode of modes) {
        const f = fixture(mode); await warm(f);
        f.set({});
        const missing = await f.step();
        assert.equal(missing.source, "fallback");
        assert.equal(f.activation.inspect().lastPass.work.spikeEvents, 0);
        f.set(B);
        const switched = await f.step();
        assert.equal(switched.source, "fallback"); assert.equal(switched.decision.invocation.input.route, "hold");
        assert.equal(f.activation.inspect().lastPass.proposals.length, 0);
    }
});

test("parallel temporal harnesses may share a memory but never share membrane states", async () => {
    const a = fixture("spikes-modulated"), b = createRoutingSample({
        memory: a.memory, createHarness: createTemporalTopologyHarness, features: B,
    });
    for (let i = 0; i < 5; i++) {
        const [ta, tb] = await Promise.all([a.step(), b.step()]);
        if (i >= 3) {
            assert.equal(ta.decision.invocation.input.route, "a");
            assert.equal(tb.decision.invocation.input.route, "b");
        }
        a.set(A); b.set(B);
    }
    assert.equal(a.activation.journal().length, 5); assert.equal(b.activation.journal().length, 5);
    assert.equal(a.activation.inspect().integrators.find(b => b.branchId === "b").potential, 0);
    assert.equal(b.activation.inspect().integrators.find(b => b.branchId === "a").potential, 0);
});

test("a foreign activation session is rejected instead of silently mixing memory and dynamics", () => {
    const memory = new TopologyMemory(createTopologyFixture());
    const activation = new TopologyActivationSession(new TopologyMemory(createTopologyFixture()));
    assert.throws(() => createTopologyHarness({ memory, activation }), /Foreign topology activation/);
});
