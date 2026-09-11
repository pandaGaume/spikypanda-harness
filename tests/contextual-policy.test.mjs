import assert from "node:assert/strict";
import test from "node:test";
import { ContextualPolicyGraph, OperatingContextTracker, createGraphDriver, createDecisionContext,
    DEFAULT_PLASTICITY_CONFIG } from "../packages/harness/dist/index.js";
import { CounterWorld, createCounterRuntime } from "../examples/counter/world.mjs";
import { counterEffectSignature, createCounterPolicy, createCounterRuntimeV2, createCounterHarnessV2 } from "../examples/counter/contextual.mjs";
import { PolicyGraph } from "../packages/harness/dist/index.js";

const intention = { id: "reach-target", parameters: { target: 3 } };
const scope = createDecisionContext({ id: "below", features: {} }, intention).key;
const invocation = delta => ({ actionId: delta > 0 ? "increment" : "decrement", capabilityId: "counter.move", input: { delta } });
function fixture(policy = createCounterPolicy()) {
    const world = new CounterWorld();
    return { policy, world, ...createCounterRuntimeV2(policy, world) };
}
async function advance(f, count, driver) {
    const traces = [];
    for (let i = 0; i < count; i++) {
        if (f.world.value === f.world.target) f.world.reset();
        traces.push(await f.runtime.step(intention, undefined, driver));
    }
    return traces;
}
const modeWithGain = (f, gain) => f.policy.modes(scope).find(m => m.signature.gain === gain);
const stats = (f, mode, delta) => f.policy.getTransitionStats({ id: "below", features: {} }, intention, invocation(delta), mode.id);

test("A-B-A-B reuses two learned modes and never damages the other mode's mature skill", async () => {
    const f = fixture();
    await advance(f, 24);
    const a = modeWithGain(f, 1), aBefore = stats(f, a, 1);
    f.world.reset(); f.world.invert();
    const [first] = await advance(f, 1);
    assert.equal(first.evaluation.success, false);
    assert.equal(first.operatingBefore.modeId, a.id);
    assert.equal(first.attribution.current.status, "pending");
    assert.equal(first.transitionAfter, undefined);
    assert.deepEqual(stats(f, a, 1), aBefore);
    assert.equal(f.operatingContexts.belief(await f.world.observe(), intention).status, "uncertain");
    await advance(f, 24);
    const b = modeWithGain(f, -1), bBefore = stats(f, b, -1);
    assert.deepEqual(stats(f, a, 1), aBefore);
    assert.equal(f.policy.snapshot().experiences.find(e => e.decisionId === first.decisionId).attribution.current.modeId, b.id);
    f.world.reset(); f.world.invert();
    const calls = f.fallback.calls;
    const [returnA, useA] = await advance(f, 2);
    assert.equal(returnA.operatingAfter.modeId, a.id);
    assert.equal(useA.source, "policy"); assert.equal(useA.decision.action.id, "increment");
    assert.equal(f.fallback.calls, calls);
    assert.deepEqual(stats(f, b, -1), bBefore);
    f.world.reset(); f.world.invert();
    const [returnB, useB] = await advance(f, 2);
    assert.equal(returnB.operatingAfter.modeId, b.id);
    assert.equal(useB.source, "policy"); assert.equal(useB.decision.action.id, "decrement");
    assert.equal(f.policy.modes().length, 2);
    assert.equal(f.fallback.calls, calls);
});

test("hidden inversion changes neither memory nor belief before an observable result", async () => {
    const f = fixture(); await advance(f, 12); f.world.reset();
    const snapshot = f.policy.snapshot(), belief = f.operatingContexts.belief(await f.world.observe(), intention);
    f.world.invert();
    assert.deepEqual(f.policy.snapshot(), snapshot);
    assert.deepEqual(f.operatingContexts.belief(await f.world.observe(), intention), belief);
    assert.equal("direction" in (await f.world.observe()).features, false);
    const [trace] = await advance(f, 1);
    assert.equal(trace.evaluation.success, false, "an unobservable switch cannot be anticipated");
});

test("an isolated anomaly does not create a mode and eventually penalizes the assumed skill", async () => {
    const f = fixture(); await advance(f, 24);
    const a = modeWithGain(f, 1), before = stats(f, a, 1);
    f.world.reset(); f.world.invert();
    const [anomaly] = await advance(f, 1);
    f.world.invert();
    await advance(f, 1);
    const evidence = f.policy.snapshot().experiences.find(e => e.decisionId === anomaly.decisionId);
    assert.equal(f.policy.modes().length, 1);
    assert.equal(evidence.attribution.current.status, "anomaly");
    assert.equal(evidence.attribution.current.modeId, a.id);
    assert.ok(stats(f, a, 1).confidence < before.confidence);
    assert.equal(stats(f, a, 1).totalFailureCount, 1);
});

test("10,000 successes still permit bounded demotion under ambiguous failures in a known context", () => {
    const policy = createCounterPolicy(), tracker = new OperatingContextTracker(policy, counterEffectSignature);
    const state = { id: "below", features: { value: 0, target: 3 } };
    const input = { stateBefore: state, intention, decision: { action: { id: "increment", description: "Move" },
        invocation: invocation(1), source: "policy" }, stateAfter: { ...state, features: { value: 1, target: 3 } },
        result: { ok: true }, evaluation: { success: true, reward: 1 } };
    for (let i = 0; i < 10000; i++) tracker.record({ ...input, experienceId: "long-" + i, observedAt: i });
    const mode = policy.modes()[0];
    for (let i = 0; i < 4; i++) tracker.record({ ...input, stateAfter: i < 3 ? input.stateAfter : state, evaluation: { success: false, reward: -1 },
        experienceId: "failed-" + i, observedAt: 10000 + i });
    const final = policy.getTransitionStats(state, intention, invocation(1), mode.id);
    assert.equal(final.directEligible, false);
    assert.ok(final.effectiveEvidence <= DEFAULT_PLASTICITY_CONFIG.maximumEffectiveEvidence);
    assert.equal(final.totalFailureCount, 4);
    assert.equal(policy.modes().length, 1);
});

test("ambiguity and inconsistent novel effects do not proliferate hypotheses", () => {
    const policy = createCounterPolicy(), tracker = new OperatingContextTracker(policy, counterEffectSignature);
    for (let i = 0; i < 12; i++) {
        const effect = i % 3 === 2 ? 0 : i % 3 === 0 ? 1 : -1;
        tracker.record({ stateBefore: { id: "below", features: { value: 0 } }, intention,
            decision: { action: { id: "increment", description: "Move" }, invocation: invocation(1), source: "fallback" },
            stateAfter: { id: "below", features: { value: effect } }, result: { ok: true },
            evaluation: { success: effect > 0, reward: effect > 0 ? 1 : -1 }, experienceId: "noise-" + i, observedAt: i });
    }
    assert.equal(policy.modes().length, 0);
    assert.equal(policy.snapshot().transitions.length, 0);
    assert.ok(policy.snapshot().experiences.every(e => e.attribution.current.status === "unresolved"));
});

test("a configured mode cap cannot be bypassed by repeated novelty", async () => {
    const f = fixture(new ContextualPolicyGraph(counterEffectSignature.id, { noveltyConfirmations: 2, maximumModesPerScope: 1 }));
    await advance(f, 24);
    const a = modeWithGain(f, 1), before = stats(f, a, 1);
    f.world.reset(); f.world.invert(); await advance(f, 2);
    assert.equal(f.policy.modes().length, 1);
    assert.ok(stats(f, a, 1).confidence < before.confidence);
    assert.equal(f.policy.snapshot().experiences.at(-1).attribution.current.status, "anomaly");
});

test("attribution corrections preserve revisions and remove evidence from the former branch", async () => {
    const f = fixture(); await advance(f, 24);
    const a = modeWithGain(f, 1), before = stats(f, a, 1);
    f.world.reset(); f.world.invert(); const [trace] = await advance(f, 1);
    f.world.invert(); await advance(f, 1);
    f.world.invert(); await advance(f, 4);
    const b = modeWithGain(f, -1), id = f.policy.snapshot().experiences.find(e => e.decisionId === trace.decisionId).id;
    f.policy.attribute(id, "revised", b.id, "Reviewed against additional command/effect evidence");
    assert.deepEqual(stats(f, a, 1), before);
    const revised = f.policy.evidence(id);
    assert.deepEqual(revised.attribution.revisions.map(r => r.status), ["pending", "anomaly", "revised"]);
    assert.equal(revised.attribution.before.modeId, a.id);
    assert.deepEqual(ContextualPolicyGraph.restore(f.policy.snapshot()).snapshot(), f.policy.snapshot());
});

test("V2 restoration preserves hypotheses and reliability but starts with unknown applicability", async () => {
    const f = fixture(); await advance(f, 24);
    f.world.reset(); f.world.invert(); await advance(f, 24);
    const snapshot = f.policy.snapshot(), restored = ContextualPolicyGraph.restore(snapshot);
    assert.deepEqual(restored.snapshot(), snapshot);
    const next = fixture(restored);
    assert.equal(next.operatingContexts.belief(await next.world.observe(), intention).status, "unknown");
    const b = modeWithGain(next, -1), bBefore = stats(next, b, -1);
    const [observe, reuse] = await advance(next, 2);
    assert.equal(observe.operatingAfter.modeId, modeWithGain(next, 1).id);
    assert.equal(reuse.source, "policy");
    assert.deepEqual(stats(next, b, -1), bBefore);
});

test("legacy V1 imports stay unattributed and never invent a mode or transfer old scores", async () => {
    const legacy = new PolicyGraph(), world = new CounterWorld(), runtime = createCounterRuntime(legacy, world).runtime;
    for (let i = 0; i < 12; i++) { if (world.value === world.target) world.reset(); await runtime.step(intention); }
    const before = legacy.snapshot(), migrated = createCounterPolicy(before);
    assert.equal(migrated.snapshot().version, 2);
    assert.equal(migrated.modes().length, 0);
    assert.equal(migrated.findCandidateActions(await world.observe(), intention).length, 0);
    assert.deepEqual(migrated.snapshot().experiences, before.experiences);
    const f = fixture(migrated); await advance(f, 3);
    for (const old of before.transitions) assert.deepEqual(migrated.snapshot().transitions.find(t => t.key === old.key), old);
    assert.deepEqual(legacy.snapshot(), before);
});

test("V2 graph contains real context and experience provenance edges", async () => {
    const f = fixture(); await advance(f, 12);
    f.world.reset(); f.world.invert(); await advance(f, 2);
    const snapshot = f.policy.snapshot(), graph = f.policy.graphView();
    for (const relation of snapshot.operatingMemory.relations) {
        const link = graph.links.find(l => l.id === relation.id);
        assert.ok(link);
        assert.equal(link.oini.id, relation.from); assert.equal(link.ofin.id, relation.to);
    }
    for (const kind of ["appliesTo", "observedIn", "executed", "assumed", "attributedTo", "contradicts"]) {
        assert.ok(snapshot.operatingMemory.relations.some(r => r.kind === kind));
    }
});

test("corrupt hypotheses, attribution history, learned statistics and provenance are rejected", async () => {
    const f = fixture(); await advance(f, 6);
    const snapshot = f.policy.snapshot();
    const corruptions = [
        s => { s.operatingMemory.modes.push(s.operatingMemory.modes[0]); },
        s => { s.operatingMemory.config.noveltyConfirmations = 1; },
        s => { s.experiences[0].attribution.current.modeId = "foreign"; },
        s => { s.experiences[0].attribution.revisions[0].sequence = 0; },
        s => { s.transitions[0].stats.confidence = 0.4; },
        s => { s.operatingMemory.relations[0].to = "missing"; },
    ];
    for (const corrupt of corruptions) {
        const copy = structuredClone(snapshot); corrupt(copy);
        assert.throws(() => ContextualPolicyGraph.restore(copy));
    }
    assert.throws(() => new OperatingContextTracker(f.policy, { id: "another-model", describe: () => null }), /model/);
});

test("two runtimes can share conditional knowledge without sharing their current hypothesis", async () => {
    const a = fixture(); await advance(a, 12);
    const b = fixture(a.policy); b.world.invert(); await advance(b, 8);
    a.world.reset(); b.world.reset();
    assert.notEqual(a.operatingContexts.belief(await a.world.observe(), intention).modeId,
        b.operatingContexts.belief(await b.world.observe(), intention).modeId);
    const [[ta], [tb]] = await Promise.all([advance(a, 1), advance(b, 1)]);
    assert.equal(ta.decision.action.id, "increment"); assert.equal(tb.decision.action.id, "decrement");
    assert.equal(ta.evaluation.success, true); assert.equal(tb.evaluation.success, true);
});

test("headless and explicitly compiled V2 graphs give identical conditional learning", async () => {
    const a = fixture(), b = fixture(), driver = createGraphDriver(createCounterHarnessV2());
    for (let i = 0; i < 36; i++) {
        if (i === 12 || i === 24) { a.world.reset(); b.world.reset(); a.world.invert(); b.world.invert(); }
        const [ta] = await advance(a, 1), [tb] = await advance(b, 1, driver);
        assert.equal(ta.source, tb.source); assert.deepEqual(ta.decision, tb.decision);
        assert.deepEqual(ta.operatingAfter, tb.operatingAfter);
        assert.equal(ta.transitionAfter?.confidence, tb.transitionAfter?.confidence);
    }
});

test("V2 guard refusal adds neither evidence nor an operating mode", async () => {
    const f = fixture(); f.world.value = 20;
    await assert.rejects(f.runtime.step(intention), /boundary/);
    assert.equal(f.policy.snapshot().experiences.length, 0); assert.equal(f.policy.modes().length, 0);
});

test("a pending tracker cannot undo an attribution established by shared knowledge", async () => {
    const a = fixture(), b = fixture(a.policy);
    const [first] = await advance(a, 1);
    await advance(b, 2);
    const id = a.policy.snapshot().experiences.find(e => e.decisionId === first.decisionId).id;
    assert.equal(a.policy.evidence(id).attribution.current.status, "confirmed");
    await advance(a, 1);
    assert.equal(a.policy.evidence(id).attribution.current.status, "confirmed");
    assert.equal(a.policy.modes().length, 1);
});

test("conditional skills remain isolated when intention parameters change", async () => {
    const f = fixture(); await advance(f, 12);
    const before = f.policy.snapshot();
    f.world.reset(); f.world.target = 5;
    const other = { id: "reach-target", parameters: { target: 5 } };
    const trace = await f.runtime.step(other);
    assert.equal(trace.source, "fallback");
    assert.equal(trace.attribution.current.status, "pending");
    assert.deepEqual(f.policy.snapshot().transitions, before.transitions);
});

test("a known-signature outlier can temporarily switch applicability without duplicating modes", async () => {
    const f = fixture(); await advance(f, 12);
    f.world.reset(); f.world.invert(); await advance(f, 12);
    f.world.reset(); f.world.invert(); await advance(f, 3);
    const count = f.policy.modes().length;
    f.world.reset(); f.world.invert();
    const [outlier] = await advance(f, 1);
    assert.equal(outlier.operatingAfter.modeId, modeWithGain(f, -1).id);
    f.world.invert();
    const [correction] = await advance(f, 1);
    assert.equal(correction.operatingAfter.modeId, modeWithGain(f, 1).id);
    assert.equal(f.policy.modes().length, count);
});

test("restoration rejects an operating hypothesis unsupported by observed effects", () => {
    const snapshot = structuredClone(createCounterPolicy().snapshot());
    snapshot.operatingMemory.modes.push({ id: "mode:" + JSON.stringify([scope, { gain: 1 }]),
        scope, signature: { gain: 1 }, label: "M1", createdAt: 0 });
    assert.throws(() => ContextualPolicyGraph.restore(snapshot), /support/);
});

test("repeated graph views do not accumulate provenance links on shared mode nodes", async () => {
    const f = fixture(); await advance(f, 6);
    const first = f.policy.graphView();
    const mode = first.nodes.find(n => n.type === "Harness.Memory:operating-mode");
    const linksBefore = mode.onsc().length + mode.opsc().length;
    const second = f.policy.graphView();
    assert.equal(mode.onsc().length + mode.opsc().length, linksBefore);
    assert.equal(first.links.length, second.links.length);
    assert.equal(f.policy.modes().length, 1);
});
