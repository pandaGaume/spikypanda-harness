import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LifNeuronNode, Session } from "@spiky-panda/core";
import { TopologyMemory, TopologyActivationSession, TemporalTopologyMemory, TemporalTopologySession,
    DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, DEFAULT_TOPOLOGY_CONFIG, initialTransitionStats } from "../packages/harness/dist/index.js";
import { createTopologyFixture, topologyFrame } from "../examples/topology/fixture.mjs";

const modes = ["continuous", "spikes", "spikes-modulated"];
const A = { x: 1, y: 1, z: 0 }, B = { x: 0, y: 1, z: 1 };
function fixture(mode = "continuous", edit = () => {}, patch = {}) {
    const def = createTopologyFixture(); edit(def);
    const memory = new TemporalTopologyMemory(def, { ...DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, mode,
        resetAlpha: mode === "spikes-modulated" ? 0.8 : 0, ...patch });
    const session = new TemporalTopologySession(memory);
    return { memory, session, run: (t, features = A, overrides) => session.activate(topologyFrame(memory, features, t, overrides)) };
}
const dyn = (p, id = "a") => p.temporal.branches.find(b => b.branchId === id);
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, a + " != " + b);
function warm(f, last = 6) { let pass; for (let t = 0; t <= last; t++) pass = f.run(t); return pass; }

test("28 T1 reference passages remain byte-identical after the extension hooks", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/topology-t1-baseline.json", import.meta.url)));
    const results = [];
    for (const cut of [false, true]) for (const kind of ["and", "or"]) {
        const def = createTopologyFixture(); def.nodes.find(n => n.id === "xy").kind = kind;
        if (cut) def.edges = def.edges.filter(e => e.id !== "y-xy");
        const m = new TopologyMemory(def), s = new TopologyActivationSession(m); let tick = 0;
        for (const features of [A, B, { x: 1, y: 1, z: 1 }, { x: 1, z: 0 }, { x: 0.4, y: 1, z: 0 }, { x: 0.9, y: 0.8, z: 0.6 }, {}]) {
            const pass = s.activate(topologyFrame(m, features, ++tick)); results.push({ pass, arbitration: s.arbitrate(pass) });
        }
    }
    assert.equal(results.length, golden.passes);
    assert.equal(createHash("sha256").update(JSON.stringify(results)).digest("hex"), golden.sha256);
});

test("each terminal branch executes a real Core LIF unit in its own session state", () => {
    const f = fixture(), p = f.run(0);
    assert.equal(f.memory.graph.nodes.length, 8); assert.equal(f.memory.memoryGraph.nodes.length, 7);
    assert.ok(f.memory.branches.every(b => b.neuron instanceof LifNeuronNode));
    for (const b of f.memory.branches) assert.ok(f.session.session.nodeStateOf(b).integrator instanceof Session);
    assert.equal(p.work.nodeFirings, 12); assert.equal(p.work.relationDeliveries, 11); assert.equal(p.work.spikeEvents, 0);
    assert.equal(p.temporal.integratorNodeFirings, 4); assert.equal(p.temporal.integratorDeliveries, 2);
    assert.equal(p.proposals.length, 0);
    assert.equal(dyn(p).charge, 0); assert.equal(dyn(p).potential, 0);
    assert.throws(() => new TopologyActivationSession(f.memory).activate(topologyFrame(f.memory, A)), /temporal activation session/);
});

test("continuous integration follows the analytic solution on regular and irregular measurement clocks", () => {
    for (const times of [[0, 1, 2, 3, 4, 5, 6], [0, 0.25, 0.9, 2.1, 2.8, 4.6, 6]]) {
        const f = fixture();
        for (const t of times) {
            const p = f.run(t); approx(dyn(p).potential, 3 * (1 - Math.exp(-t / 3)));
            assert.equal(p.work.spikeEvents, 0);
        }
    }
});

test("clock cadence changes threshold quantization, not a constant signal's continuous potential", () => {
    const finals = [];
    for (const dt of [0.25, 0.5, 1]) {
        const f = fixture(); let first = null, p;
        for (let t = 0; t <= 6; t += dt) {
            p = f.run(t);
            if (f.session.arbitrate(p).selected && first === null) first = t;
        }
        const theoretical = -3 * Math.log(1 - 1.5 / 3);
        assert.ok(first >= theoretical && first < theoretical + dt);
        finals.push(dyn(p).potential);
    }
    finals.forEach(p => approx(p, finals[0]));
});

test("measurement time, not decision processing latency, determines integration", () => {
    const a = fixture(), b = fixture();
    for (let t = 0; t <= 5; t++) {
        const p = a.run(t);
        const delay = t % 2 ? 0.6 : 0.2;
        const q = b.run(t, A, { availableAtSeconds: t + delay, timeSeconds: t + delay });
        assert.deepEqual(q.temporal, p.temporal);
    }
});

test("zero and modulated reset share every potential before the first emission", () => {
    const a = fixture("spikes"), b = fixture("spikes-modulated");
    for (let t = 0; t <= 3; t++) {
        const p = dyn(a.run(t)), q = dyn(b.run(t));
        approx(p.potentialBeforeReset, q.potentialBeforeReset);
        assert.equal(p.spiked, q.spiked);
        if (t < 3) approx(p.potential, q.potential);
        else { assert.equal(p.potential, 0); approx(q.potential, 1.2); }
    }
    assert.equal(dyn(a.run(4)).spiked, false); assert.equal(dyn(b.run(4)).spiked, true);
});

test("modulated residual uses current support, never lifetime confidence", () => {
    const high = fixture("spikes-modulated"), low = fixture("spikes-modulated", d => {
        for (const n of d.nodes) if (n.kind === "branch") { n.stats = initialTransitionStats(); n.experienceIds = []; }
    });
    let emitted = false;
    for (let t = 0; t <= 10; t++) {
        const p = high.run(t, { x: 0.8, y: 1, z: 0 }), q = low.run(t, { x: 0.8, y: 1, z: 0 });
        assert.deepEqual(p.temporal, q.temporal);
        if (dyn(p).spiked) {
            emitted = true; approx(dyn(p).lastResetPotential, 1.5 * 0.8 * 0.8);
            assert.equal(low.session.arbitrate(q).reason, "unreliable");
        }
    }
    assert.equal(emitted, true);
});

test("alpha zero reproduces the zero-reset trajectory exactly", () => {
    const a = fixture("spikes"), b = fixture("spikes-modulated", () => {}, { resetAlpha: 0 });
    for (let t = 0; t <= 20; t += 0.5) {
        const p = a.run(t), q = b.run(t);
        assert.deepEqual(q.temporal.branches, p.temporal.branches);
        assert.deepEqual(q.work, p.work); assert.deepEqual(q.proposals, p.proposals);
    }
});

test("a spike is usable only in its current passage, with no three-second carry-over", () => {
    const f = fixture("spikes");
    for (let t = 0; t <= 3; t++) f.run(t);
    const before = f.session.inspect().lastPass;
    assert.equal(before.proposals.length, 1);
    const after = f.run(4);
    assert.equal(after.proposals.length, 0); assert.equal(after.work.spikeEvents, 0);
    assert.throws(() => f.session.arbitrate(before), /stale/);
});

test("missing, zero or blocked current evidence cannot turn a residual into a proposal", () => {
    for (const mode of modes) for (const features of [{}, { x: 0, y: 1, z: 0 }]) {
        const f = fixture(mode); warm(f, 6);
        const previous = f.session.inspect().integrators.find(b => b.branchId === "a").potential;
        const p = f.run(7, features), d = dyn(p);
        assert.equal(p.proposals.length, 0); assert.equal(p.work.spikeEvents, 0);
        assert.equal(d.charge, 0); approx(d.potential, previous * Math.exp(-1 / 3));
    }
});

test("a blocking contradiction clears the local residual while unknown data only leaks", () => {
    const f = fixture("continuous", d => { d.nodes.find(n => n.id === "x").vetoOnMismatch = true; });
    warm(f); const p = f.run(7, { x: 0, y: 1, z: 0 });
    assert.equal(dyn(p).potential, 0); assert.equal(dyn(p).resetReason, "contradiction");
    assert.equal(p.proposals.length, 0);
});

test("gaps do not invent corroborated duration; a short missing interval is not bridged either", () => {
    for (const mode of modes) {
        const f = fixture(mode); warm(f);
        const p = f.run(10);
        assert.equal(dyn(p).resetReason, "gap"); assert.equal(dyn(p).potential, 0); assert.equal(dyn(p).charge, 0);
        assert.equal(p.proposals.length, 0);
        f.run(11, {}); const next = f.run(12);
        assert.equal(dyn(next).charge, 0);
    }
});

test("duplicate frames do not integrate twice, and relabelled simultaneous measurements are rejected", () => {
    const f = fixture("spikes-modulated");
    const p = f.run(0), cached = f.run(1);
    const snapshot = f.session.inspect();
    assert.equal(f.run(1), cached);
    assert.deepEqual(f.session.inspect(), snapshot);
    assert.throws(() => f.run(2, A, { observedAtSeconds: 1, availableAtSeconds: 2 }), /measurement clock/);
    assert.throws(() => f.run(2, A, { observationId: p.observationId }), /Repeated/);
    assert.deepEqual(f.session.inspect(), snapshot);
});

test("cutting a required path prevents accumulation as well as proposals", () => {
    const f = fixture("continuous", d => { d.edges = d.edges.filter(e => e.id !== "y-xy"); });
    for (let t = 0; t <= 10; t++) {
        const p = f.run(t); assert.equal(dyn(p).potential, 0); assert.equal(p.proposals.length, 0);
        assert.equal(p.work.relationDeliveries, 10);
    }
});

test("OR alternatives and shared conditions keep their topology semantics under local dynamics", () => {
    const f = fixture("continuous", d => { d.nodes.find(n => n.id === "xy").kind = "or"; });
    let pass;
    for (let t = 0; t <= 6; t++) pass = f.run(t, { x: 1, z: 0 });
    assert.equal(f.session.arbitrate(pass).selected.branchId, "a");
    const both = fixture(); for (let t = 0; t <= 6; t++) pass = both.run(t, { x: 1, y: 1, z: 1 });
    assert.equal(both.session.arbitrate(pass).reason, "ambiguous");
    assert.equal(pass.trace.filter(n => n.nodeId === "y").length, 1);
});

test("definition order does not affect temporal results, provenance or arbitration", () => {
    const a = fixture("spikes-modulated"), b = fixture("spikes-modulated", d => { d.nodes.reverse(); d.edges.reverse(); });
    for (let t = 0; t <= 10; t++) {
        const features = t < 4 ? A : t < 7 ? B : { x: 1, y: 1, z: 1 };
        const p = a.run(t, features), q = b.run(t, features);
        assert.deepEqual(q.temporal, p.temporal); assert.deepEqual(q.proposals, p.proposals);
        assert.deepEqual(b.session.arbitrate(q), a.session.arbitrate(p));
    }
});

test("shared definitions never share potentials; reset is session-local", () => {
    const a = fixture(), b = new TemporalTopologySession(a.memory), saved = JSON.stringify(a.memory.definition);
    warm(a);
    const p = b.activate(topologyFrame(a.memory, A, 0));
    assert.equal(dyn(p).potential, 0);
    assert.ok(a.session.inspect().integrators[0].potential > 0);
    a.session.reset();
    assert.equal(a.session.inspect().integrators[0].potential, 0); assert.equal(b.inspect().passes, 1);
    assert.equal(JSON.stringify(a.memory.definition), saved);
    assert.equal(dyn(a.run(0)).charge, 0);
});

test("partial work invalidates all potentials and leaves no actionable result or journal entry", () => {
    const f = fixture(); warm(f);
    assert.throws(() => f.session.activate(topologyFrame(f.memory, A, 7), { maximumNodeFirings: 11 }), /budget/);
    assert.equal(f.session.inspect().lastPass, null); assert.equal(f.session.journal().length, 0);
    assert.ok(f.session.inspect().integrators.every(b => b.potential === 0 && b.failureResets === 1));
    const p = f.run(8); assert.equal(dyn(p).charge, 0); assert.equal(p.proposals.length, 0);
});

test("aborts and invalid frames before starting never erase existing dynamics", () => {
    const f = fixture(); warm(f); const before = f.session.inspect(), abort = new AbortController();
    abort.abort(new Error("cancelled"));
    assert.throws(() => f.session.activate(topologyFrame(f.memory, A, 7), { signal: abort.signal }), /cancelled/);
    assert.throws(() => f.run(7, A, { memoryRevision: "foreign" }), /revision/);
    assert.deepEqual(f.session.inspect(), before);
});

test("changing a nested Core neuron or channel invalidates the memory revision", () => {
    for (const mutate of [
        b => { b.neuron.threshold += 1; },
        b => { b.integratorGraph.links[0].enabled = false; },
        b => { b.neuron.alpha = 0.1; },
    ]) {
        const f = fixture("spikes-modulated"); const pass = warm(f);
        mutate(f.memory.branches[0]);
        assert.throws(() => f.session.arbitrate(pass), /integrator projection/);
        assert.throws(() => f.run(7), /integrator projection/);
    }
});

test("invalid temporal configs and mismatched memory/session types fail explicitly", () => {
    for (const patch of [{ mode: "lif" }, { version: 2 }, { threshold: 0 }, { threshold: 3 },
        { timeConstantSeconds: NaN }, { maximumGapSeconds: 0 }, { resetAlpha: 1 }, { resetAlpha: -1 },
        { mode: "spikes", resetAlpha: 0.8 }, { surprise: true }]) assert.throws(() => fixture("continuous", () => {}, patch));
    assert.throws(() => new TemporalTopologySession(new TopologyMemory(createTopologyFixture())), /temporal topology/);
    assert.throws(() => new TemporalTopologyMemory(createTopologyFixture(), DEFAULT_TOPOLOGY_TEMPORAL_CONFIG,
        { ...DEFAULT_TOPOLOGY_CONFIG, maximumNodes: 1 }));
});
