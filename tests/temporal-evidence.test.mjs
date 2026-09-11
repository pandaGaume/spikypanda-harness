import assert from "node:assert/strict";
import test from "node:test";
import { Session } from "@spiky-panda/core";
import { TemporalEvidenceNetwork, TemporalCueObserver, DEFAULT_TEMPORAL_EVIDENCE_CONFIG,
    validateTemporalEvidenceConfig, AdaptiveCueObserver } from "../packages/harness/dist/index.js";

const config = DEFAULT_TEMPORAL_EVIDENCE_CONFIG;
const advance = (network, t, rate = 1, winner = "A", scope = "context") =>
    network.advance(scope, ["A", "B"], winner, rate, t);
for (const mode of ["continuous", "spikes", "spikes-modulated"]) {
    test(mode + ": duration integrates in a real core graph and output is only eligibility", () => {
        const n = new TemporalEvidenceNetwork(mode);
        assert.equal(advance(n, 0).modeId, null);
        assert.equal(advance(n, 1).modeId, null);
        assert.equal(advance(n, 2).modeId, null);
        assert.equal(advance(n, 3).modeId, "A");
        const graph = n.inspect().graphs[0];
        assert.equal(graph.engine, "spikypanda-core");
        assert.equal(graph.builder, "RuntimeGraphBuilder");
        assert.equal(graph.nodes.length, 6); assert.equal(graph.edges.length, 4);
        assert.ok(graph.nodes.some(n => n.implementation === (mode === "spikes-modulated" ? "ModulatedResetLif" : mode === "spikes" ? "CountedLif" : "ContinuousEvidenceNode")));
    });
    test(mode + ": no false persistence from duplicate times or isolated pulses", () => {
        const n = new TemporalEvidenceNetwork(mode);
        advance(n, 0);
        const before = n.inspect();
        assert.throws(() => advance(n, 0), /increasing clock/);
        assert.throws(() => advance(n, -1), /Invalid temporal/);
        assert.deepEqual(n.inspect(), before);
        assert.equal(advance(n, 1).modeId, null);
        assert.equal(advance(n, 2, 0, null).modeId, null);
        assert.equal(advance(n, 3).modeId, null);
    });
    test(mode + ": missing samples, long gaps and a different winner invalidate the latch", () => {
        const n = new TemporalEvidenceNetwork(mode);
        for (let t = 0; t <= 3; t++) advance(n, t);
        assert.equal(advance(n, 4, 1, "B").modeId, null);
        for (let t = 5; t <= 7; t++) advance(n, t, 1, "B");
        assert.equal(advance(n, 8, 1, "A").modeId, null);
        assert.equal(advance(n, 20).modeId, null);
        n.forget("context");
        assert.equal(advance(n, 21).modeId, null);
    });
    test(mode + ": sample cadence changes do not multiply the evidence rate", () => {
        for (const dt of [0.25, 0.5, 1, 2]) {
            const n = new TemporalEvidenceNetwork(mode);
            let first = null;
            for (let i = 0; i * dt <= 8; i++) {
                const t = i * dt;
                if (advance(n, t).modeId && first === null) first = t;
            }
            const crossing = -config.timeConstantSeconds * Math.log(1 - config.threshold / config.timeConstantSeconds);
            assert.ok(first >= crossing && first < crossing + dt + 1e-9, String(first));
        }
    });
    test(mode + ": scope, topology and runtime state remain isolated and bounded", () => {
        const n = new TemporalEvidenceNetwork(mode, { ...config, maximumScopes: 2 });
        for (let t = 0; t <= 3; t++) advance(n, t);
        assert.equal(advance(n, 4, 1, "A", "other").modeId, null);
        assert.equal(advance(new TemporalEvidenceNetwork(mode), 4).modeId, null);
        assert.equal(n.advance("context", ["A", "B", "C"], "A", 1, 4).modeId, null);
        advance(n, 5, 1, "A", "third");
        assert.equal(n.inspect().scopes, 2);
        assert.equal(n.inspect().evictions, 1);
        assert.throws(() => n.advance("x", ["A", "A"], "A", 1, 10), /Invalid temporal/);
    });
}
test("continuous level and LIF have the same first crossing, but only LIF resets and sparsifies output", () => {
    const continuous = new TemporalEvidenceNetwork("continuous"), spikes = new TemporalEvidenceNetwork("spikes");
    for (let t = 0; t < 30; t++) {
        const a = advance(continuous, t), b = advance(spikes, t);
        assert.equal(a.modeId, b.modeId);
        if (t < 3) assert.equal(a.units[0].potential, b.units[0].potential);
        if (t === 3) { assert.ok(a.units[0].potential > 0); assert.equal(b.units[0].potential, 0); }
    }
    assert.equal(continuous.inspect().spikeEvents, 0);
    assert.ok(spikes.inspect().spikeEvents > 0);
    assert.ok(spikes.inspect().outputEvents < continuous.inspect().outputEvents);
    assert.equal(spikes.inspect().integratorFirings, continuous.inspect().integratorFirings);
});
test("a weak persistent cue exposes spike expiry rather than an immortal activation", () => {
    const n = new TemporalEvidenceNetwork("spikes"), recognized = [];
    for (let t = 0; t < 30; t++) recognized.push(advance(n, t, 0.6).modeId);
    assert.ok(recognized.slice(10).includes(null));
    assert.ok(recognized.slice(10).includes("A"));
});
test("invalid temporal parameters fail before creating a graph", () => {
    for (const patch of [{ threshold: 3 }, { threshold: -1 }, { timeConstantSeconds: NaN },
        { maximumScopes: 0 }, { maximumModes: 1.5 }, { surprise: 1 }]) {
        assert.throws(() => validateTemporalEvidenceConfig({ ...config, ...patch }), /Invalid temporal/);
    }
});

function fixture(propagation) {
    let time = 0, status = "recognized", gap = 0.2, revision = 0;
    const context = { key: "context", state: { id: "observed", features: { measured: 0 } }, intention: { id: "service" } };
    const raw = () => ({ encoder: "harness.adaptive-metric.v1", schemaKey: "schema", modelRevision: revision,
        scope: "context", observationKey: JSON.stringify(context.state), status,
        ...(status === "recognized" ? { modeId: "A" } : {}),
        features: [], embedding: [], coverage: 1,
        candidates: [{ modeId: "A", distance: 0, experienceIds: [] }, { modeId: "B", distance: gap, experienceIds: [] }] });
    const base = { policy: { snapshot: () => ({ experiences: [] }) }, schema: {}, config: { maximumDistance: 0.35, minimumMargin: 0.2 },
        assess: raw, validateAssessment(_c, assessment) { assert.deepEqual(assessment, raw()); } };
    const observer = new TemporalCueObserver(base, propagation, () => time);
    return { observer, context, set(t, s = status, g = gap) { time = t; status = s; gap = g; }, revise() { revision++; } };
}
for (const propagation of ["continuous", "spikes", "spikes-modulated"]) {
    test(propagation + ": validating or re-reading a cue never fires the graph twice", () => {
        const f = fixture(propagation);
        for (let t = 0; t <= 3; t++) {
            f.set(t); const a = f.observer.assess(f.context), before = f.observer.inspect();
            f.observer.validateAssessment({ ...f.context, cues: { assessment: a } }, a);
            assert.equal(f.observer.assess(f.context), a);
            assert.deepEqual(f.observer.inspect(), before);
        }
        const a = f.observer.assess(f.context);
        assert.equal(a.status, "recognized");
        assert.throws(() => f.observer.validateAssessment(f.context, { ...a, modeId: "B" }), /foreign/);
        f.revise();
        assert.throws(() => f.observer.validateAssessment(f.context, a));
    });
    test(propagation + ": temporal readout can recognize sustained sub-margin cues, not a single hint", () => {
        const f = fixture(propagation);
        f.set(0, "ambiguous", 0.12);
        assert.equal(f.observer.assess(f.context).status, "ambiguous");
        for (let t = 1; t <= 6; t++) { f.set(t); f.observer.assess(f.context); }
        assert.equal(f.observer.assess(f.context).status, "recognized");
        assert.equal(f.observer.assess(f.context).temporal.instantaneousStatus, "ambiguous");
        f.set(7, "missing");
        assert.equal(f.observer.assess(f.context).status, "missing");
        f.set(8, "recognized");
        assert.equal(f.observer.assess(f.context).status, "ambiguous");
        f.set(9, "learning");
        assert.equal(f.observer.assess(f.context).status, "learning");
        f.set(10, "novel");
        assert.equal(f.observer.assess(f.context).status, "novel");
        assert.throws(() => AdaptiveCueObserver.restore(f.observer.snapshot()), /Invalid V3/);
    });
}

test("the session owns every mutable temporal state and reset leaves durable memory untouched", () => {
    const f = fixture("spikes"), durable = f.observer.policy.snapshot();
    for (let t = 0; t <= 3; t++) { f.set(t); f.observer.assess(f.context); }
    const network = f.observer.network, session = network.session;
    assert.ok(session instanceof Session);
    assert.equal(session.nodeStates[0].banks.size, 1);
    assert.ok(session.nodeStates[0].cueCache);
    assert.ok(session.nodeStates[0].counts.outputEvents > 0);
    const isolated = new Session(session.graph);
    assert.equal(isolated.nodeStates[0].banks.size, 0);
    assert.equal(isolated.nodeStates[0].cueCache, undefined);
    const bank = [...session.nodeStates[0].banks.values()][0];
    const parallel = new Session(bank.session.graph);
    assert.equal(parallel.nodeStates.find(s => "spikeCount" in s).spikeCount, 0);
    for (const node of bank.session.graph.nodes) {
        assert.equal(Object.hasOwn(node, "amplitude"), false);
        assert.equal(Object.hasOwn(node, "counts"), false);
        assert.equal(Object.hasOwn(node, "lastActivation"), false);
    }
    session.reset();
    assert.equal(network.inspect().scopes, 0);
    assert.equal(network.inspect().nodeFirings, 0);
    assert.equal(network.sessionState.cueCache, undefined);
    assert.deepEqual(f.observer.policy.snapshot(), durable);
    assert.equal(f.observer.assess(f.context).status, "ambiguous");
});
