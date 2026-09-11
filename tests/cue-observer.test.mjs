import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveCueObserver, DEFAULT_CUE_CONFIG, OperatingContextTracker, createDecisionContext } from "../packages/harness/dist/index.js";
import { createCounterPolicy, counterEffectSignature } from "../examples/counter/contextual.mjs";
import { counterCueSchema, createCounterCueMemory, createCounterRuntimeV3, CounterCueWorld } from "../examples/counter/perceptive.mjs";

const intention = { id: "reach-target", parameters: { target: 3 } };
const state = (signal, ambient = 0) => ({ id: "below", features: { value: 0, target: 3, telemetry: { driveResponse: signal, ambient } } });
const context = (signal, ambient = 0) => createDecisionContext(state(signal, ambient), intention);
const clone = value => JSON.parse(JSON.stringify(value));
function data() {
    const policy = createCounterPolicy(), tracker = new OperatingContextTracker(policy, counterEffectSignature);
    const observer = new AdaptiveCueObserver(policy, counterCueSchema);
    let count = 0;
    return { policy, observer, add(gain, signal = gain * 0.7, ambient = 0, cues) {
        const before = state(signal, ambient);
        return tracker.record({ experienceId: "sample-" + count, observedAt: count++, stateBefore: before, intention,
            decision: { source: "fallback", action: { id: "increment", description: "Move" },
                invocation: { actionId: "increment", capabilityId: "counter.move", input: { delta: 1 } } },
            stateAfter: { ...before, features: { ...before.features, value: gain } }, result: { ok: true },
            evaluation: { success: gain > 0, reward: gain > 0 ? 1 : -1 }, cues }).experience;
    } };
}
function learned(count = 24) {
    const f = data();
    for (const gain of [1, -1]) for (let i = 0; i < count; i++) f.add(gain, gain * 0.7, Math.sin(i * 2.71));
    return f;
}
async function trainRuntime() {
    const world = new CounterCueWorld(), observer = createCounterCueMemory();
    const { runtime, operatingContexts } = createCounterRuntimeV3(observer, world, { cueMode: "active" });
    for (const gain of [1, -1]) {
        if (gain !== world.direction) world.invert();
        for (let i = 0; i < 24; i++) {
            if (world.value === world.target) world.reset();
            await runtime.step(intention);
        }
    }
    world.reset();
    return { observer, world, runtime, operatingContexts };
}

test("cue metric learns useful feature relevance without predefined mode labels", () => {
    const f = learned(), before = f.policy.snapshot();
    const a = f.observer.assess(context(0.7)), b = f.observer.assess(context(-0.7));
    assert.equal(a.status, "recognized"); assert.equal(b.status, "recognized");
    assert.equal(f.policy.mode(a.modeId).signature.gain, 1);
    assert.equal(f.policy.mode(b.modeId).signature.gain, -1);
    assert.ok(a.features[0].relevance > 0.9);
    assert.equal(a.features[1].relevance, 0);
    assert.equal(a.embedding[0], 0.7 * Math.sqrt(a.features[0].relevance));
    assert.deepEqual(f.policy.snapshot(), before, "inspection must never train or create a mode");
    assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.features[0]));
    assert.equal(a.candidates[0].experienceIds.length, 3);
});

test("cue observations report cold start, missing data, ambiguity and novelty separately", () => {
    assert.equal(data().observer.assess(context(0.7)).status, "learning");
    const f = learned();
    assert.equal(f.observer.assess(context(null, null)).status, "missing");
    assert.equal(f.observer.assess(context(null, 0)).status, "missing");
    assert.equal(f.observer.assess(context(5)).status, "novel");
    const overlap = data();
    for (const gain of [1, -1]) for (let i = 0; i < 8; i++) overlap.add(gain, 0);
    assert.equal(overlap.observer.assess(context(0)).status, "ambiguous");
    const close = data();
    for (const gain of [1, -1]) for (let i = 0; i < 8; i++) close.add(gain, gain * 0.2);
    assert.equal(close.observer.assess(context(0)).status, "ambiguous");
});

test("only allowed current measurements are encoded, without future results or hidden simulator state", () => {
    const f = learned();
    const first = context(0.7), second = clone(first);
    second.state.features.secretDirection = -1; second.state.features.episode = 1000;
    const a = f.observer.assess(first), b = f.observer.assess(second);
    assert.deepEqual(a.embedding, b.embedding);
    assert.equal(a.modeId, b.modeId);
    assert.deepEqual(a.candidates, b.candidates);
    assert.notEqual(a.observationKey, b.observationKey, "full observation identity still tracks freshness");
    assert.deepEqual(a.features.map(f => f.sourceRef), ["state.features/telemetry/driveResponse", "state.features/telemetry/ambient"]);
});

test("10,000 old successes cannot freeze cue associations after sensor drift", () => {
    const f = data();
    for (let i = 0; i < 10000; i++) f.add(1);
    for (let i = 0; i < 24; i++) f.add(-1);
    const before = f.observer.assess(context(0.7));
    assert.equal(f.policy.mode(before.modeId).signature.gain, 1);
    for (const gain of [1, -1]) for (let i = 0; i < 24; i++) f.add(gain, -gain * 0.7);
    const after = f.observer.assess(context(0.7));
    assert.equal(after.status, "recognized");
    assert.equal(f.policy.mode(after.modeId).signature.gain, -1);
    assert.ok(after.modelRevision > before.modelRevision);
    assert.equal(f.policy.modes().length, 2);
});

test("a mistaken cue prediction never becomes a training target", () => {
    const f = learned();
    for (let i = 0; i < 24; i++) {
        const assessment = f.observer.assess(context(0.7));
        f.add(-1, 0.7, 0, { mode: "active", basis: assessment.status === "recognized" ? "cues" : "uncertain", assessment });
    }
    assert.notEqual(f.observer.assess(context(0.7)).status, "recognized",
        "identical observed signals now belong to contradictory actual effects");
});

test("attribution revisions immediately affect the derived observer instead of leaving a stale index", () => {
    const f = learned();
    const modeB = f.policy.modes().find(m => m.signature.gain === -1);
    const before = f.observer.assess(context(0.7));
    for (const e of f.policy.snapshot().experiences.filter(e => e.attribution.current.modeId !== modeB.id)) {
        f.policy.attribute(e.id, "revised", modeB.id, "Host reconsiders attribution");
    }
    const after = f.observer.assess(context(0.7));
    assert.ok(after.modelRevision > before.modelRevision);
    assert.equal(after.status, "learning", "a revised attribution contradicting its effect cannot train a cue label");
});

test("schema, model and observation changes invalidate an earlier assessment", () => {
    const f = learned(), observation = context(0.7), assessment = f.observer.assess(observation);
    f.observer.validateAssessment(observation, assessment);
    assert.throws(() => f.observer.validateAssessment(context(-0.7), assessment), /Stale or foreign/);
    const altered = clone(assessment); altered.features[0].relevance = 0;
    assert.throws(() => f.observer.validateAssessment(observation, altered), /Stale or foreign/);
    f.add(1);
    assert.throws(() => f.observer.validateAssessment(observation, assessment), /Stale or foreign/);
    const alternative = new AdaptiveCueObserver(f.policy, { ...counterCueSchema, version: 2 });
    assert.throws(() => alternative.validateAssessment(observation, assessment), /Stale or foreign/);
});

test("intentions and goals isolate cue learning just as they isolate conditional skills", () => {
    const f = learned(), altered = { ...intention, parameters: { target: 9 } };
    assert.equal(f.observer.assess(createDecisionContext(state(0.7), altered)).status, "learning");
    assert.equal(f.observer.assess(createDecisionContext({ ...state(0.7), id: "above" }, intention)).status, "learning");
});

test("invalid cue schemas, disabling decay and malformed sensor values are rejected", () => {
    for (const change of [{ samplesPerMode: 10000 }, { minimumSamples: 1 }, { recencyDecay: 1 }, { recencyDecay: 0 },
        { maximumDistance: 0 }, { minimumCoverage: 0 }, { minimumMargin: 0 }, { minimumRelevance: NaN }, { unexpected: true }]) {
        assert.throws(() => new AdaptiveCueObserver(createCounterPolicy(), counterCueSchema, { ...DEFAULT_CUE_CONFIG, ...change }));
    }
    for (const fields of [[], [counterCueSchema.fields[0], counterCueSchema.fields[0]],
        [{ id: "unsafe", path: ["__proto__"], scale: 1 }], [{ id: "zero", path: ["sensor"], scale: 0 }],
        [{ id: "bad", path: ["sensor"], scale: 1, secret: true }]]) {
        assert.throws(() => new AdaptiveCueObserver(createCounterPolicy(), { ...counterCueSchema, fields }));
    }
    for (const invalid of [NaN, Infinity, "0.7", {}, 1e100]) assert.throws(() => data().observer.assess(context(invalid)));
});

test("V3 restores observable learning and pre-action provenance without persisting an active belief", async () => {
    const f = await trainRuntime(), snapshot = f.observer.snapshot();
    const restored = AdaptiveCueObserver.restore(snapshot);
    assert.deepEqual(restored.snapshot(), snapshot);
    assert.deepEqual(restored.assess(createDecisionContext(f.world.current(), intention)),
        f.observer.assess(createDecisionContext(f.world.current(), intention)));
    const tracker = new OperatingContextTracker(restored.policy, counterEffectSignature);
    assert.equal(tracker.belief(f.world.current(), intention).status, "unknown");
    const trace = await createCounterRuntimeV3(restored, f.world, { cueMode: "active" }).runtime.step(intention);
    assert.equal(trace.cues.basis, "cues");
    assert.equal(trace.evaluation.success, true);
});

test("V3 rejects corrupted encoders, cue values, embeddings and future evidence references", async () => {
    const f = await trainRuntime(), snapshot = f.observer.snapshot();
    const changes = [
        s => { s.observer.encoder = "foreign"; },
        s => { s.policy.experiences.at(-1).cues.basis = "shadow"; },
        s => { s.observer.schema.fields[0].scale = 0; },
        s => { s.policy.experiences[0].cues.assessment.features[0].value = 300; },
        s => { s.policy.experiences[0].cues.assessment.modelRevision = 999999; },
        s => { s.policy.experiences.at(-1).cues.assessment.embedding[0] = 999; },
        s => { s.policy.experiences.at(-1).cues.assessment.candidates[0].experienceIds = ["missing"]; },
        s => { s.policy.experiences.at(-1).cues.assessment.candidates[0].experienceIds = [s.policy.experiences.at(-1).id]; },
        s => { s.policy.experiences.at(-1).cues.assessment.observationKey = "{}"; },
    ];
    for (const change of changes) { const bad = clone(snapshot); change(bad); assert.throws(() => AdaptiveCueObserver.restore(bad)); }
});

test("the core graph contains real cue provenance without adding fictional learning evidence", () => {
    const f = learned(), before = f.policy.snapshot();
    const first = f.observer.graphView(context(0.7)), second = f.observer.graphView(context(0.7));
    assert.equal(first.nodes.filter(n => n.type === "Harness.Memory:cue").length, 2);
    assert.equal(first.links.filter(l => l.type === "Harness.Memory:measured").length, 2);
    assert.ok(first.links.some(l => l.type === "Harness.Memory:resembles" && l.ofin.type === "Harness.Policy:experience"));
    assert.ok(first.links.every(l => first.nodes.includes(l.oini) && first.nodes.includes(l.ofin)));
    assert.equal(first.links.length, second.links.length);
    assert.deepEqual(f.policy.snapshot(), before);
});
