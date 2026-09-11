import assert from "node:assert/strict";
import test from "node:test";
import { ContextualPolicyGraph, OperatingContextTracker, AdaptiveCueObserver, createDecisionContext,
    DEFAULT_OPERATING_CONTEXT_CONFIG, DEFAULT_CONSOLIDATION_CONFIG, advanceConsolidation } from "../packages/harness/dist/index.js";

const config = { ...DEFAULT_CONSOLIDATION_CONFIG, minimumObservations: 3, minimumDurationMs: 2000, maximumGapMs: 1100, maximumPendingObservations: 8 };
const intention = { id: "service" }, state = { id: "working", features: { sensor: 1 } };
const invocation = { actionId: "move", capabilityId: "move", input: {} };
const provider = { id: "observed-test-effect", describe: input => input.stateAfter.features.effect };
const schema = { id: "test-cue", version: 1, fields: [{ id: "sensor", path: ["sensor"], scale: 1 }] };
function fixture(policy = new ContextualPolicyGraph(provider.id, { ...DEFAULT_OPERATING_CONTEXT_CONFIG, consolidation: config })) {
    const tracker = new OperatingContextTracker(policy, provider);
    let index = policy.snapshot().experiences.length;
    return { policy, tracker, add(effect, time, success = true, inputState = state, goal = intention) {
        return tracker.record({ experienceId: "e" + (++index), observedAt: time, stateBefore: inputState, intention: goal,
            decision: { source: "fallback", action: { id: "move", description: "Move" }, invocation },
            stateAfter: { ...inputState, features: { ...inputState.features, effect } }, result: { ok: true },
            evaluation: { success, reward: success ? 1 : -1 } });
    } };
}
const stats = (f, mode) => f.policy.getTransitionStats(state, intention, invocation, mode.id);

test("short plateaus leave traces but never create durable modes or cue training labels", () => {
    const f = fixture();
    for (const [effect, time] of [[1, 0], [1, 1000], [2, 2000], [2, 3000], [3, 4000], [3, 5000]]) f.add(effect, time);
    assert.equal(f.policy.modes().length, 0);
    assert.equal(f.policy.snapshot().transitions.length, 0);
    assert.deepEqual(f.policy.snapshot().experiences.map(e => e.attribution.current.status),
        ["transient", "transient", "transient", "transient", "pending", "pending"]);
    const observer = new AdaptiveCueObserver(f.policy, schema);
    assert.equal(observer.assess(createDecisionContext(state, intention)).status, "learning");
    const last = f.add(3, 6000);
    assert.equal(f.policy.modes().length, 1); assert.equal(last.after.status, "recognized");
    assert.deepEqual(f.policy.modes()[0].consolidationSupport, ["e5", "e6", "e7"]);
    assert.equal(stats(f, f.policy.modes()[0]).totalUsageCount, 3);
});

test("returning transient signatures are not retrospectively promoted by later consolidation", () => {
    const f = fixture();
    f.add(1, 0); f.add(1, 1000); f.add(2, 2000);
    f.add(1, 3000); f.add(1, 4000); f.add(1, 5000);
    assert.equal(f.policy.evidence("e1").attribution.current.status, "transient");
    assert.equal(f.policy.evidence("e2").attribution.current.status, "transient");
    assert.deepEqual(f.policy.modes()[0].consolidationSupport, ["e4", "e5", "e6"]);
    assert.equal(stats(f, f.policy.modes()[0]).totalUsageCount, 3);
});

test("elapsed time, minimum observations and continuity are all required", () => {
    const f = fixture();
    f.add(1, 0); f.add(1, 0); f.add(1, 0);
    assert.equal(f.policy.modes().length, 0, "a burst does not simulate persistence");
    f.add(1, 5000);
    assert.equal(f.policy.modes().length, 0, "unobserved time is not supporting evidence");
    assert.equal(f.policy.evidence("e1").attribution.current.status, "transient");
    f.add(1, 6000); f.add(1, 7000);
    assert.equal(f.policy.modes().length, 1);
    const sparse = fixture();
    sparse.add(1, 0); sparse.add(1, 2000); sparse.add(1, 4000);
    assert.equal(sparse.policy.modes().length, 0);
});

test("missing effects and host interruption break consolidation without creating evidence", () => {
    const f = fixture();
    f.add(1, 0); f.add(1, 1000); f.add(null, 2000);
    assert.equal(f.policy.evidence("e1").attribution.current.status, "transient");
    assert.equal(f.policy.evidence("e3").attribution.current.status, "unresolved");
    f.add(1, 3000); f.add(1, 4000);
    f.tracker.interrupt(state, intention, 4500);
    assert.equal(f.policy.snapshot().experiences.length, 5);
    assert.equal(f.policy.evidence("e4").attribution.current.status, "transient");
    f.add(1, 5000);
    assert.equal(f.tracker.consolidation(state, intention).observations, 1);
    assert.equal(f.policy.modes().length, 0);
});

test("a transient contradiction does not penalize an unrelated mature branch", () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) f.add(1, i * 1000);
    const a = f.policy.modes()[0], before = stats(f, a);
    f.add(2, 12000, false); f.add(2, 13000, false);
    assert.deepEqual(stats(f, a), before);
    f.add(1, 14000);
    assert.equal(f.policy.evidence("e13").attribution.current.status, "transient");
    assert.equal(stats(f, a).totalFailureCount, before.totalFailureCount);
    assert.equal(f.policy.modes().length, 1);
});

test("durable A-B-A reuses knowledge, preserves dormant reliability and still learns genuine failures", () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) f.add(1, i * 1000);
    const a = f.policy.modes()[0], aBefore = stats(f, a);
    for (let i = 12; i < 24; i++) f.add(2, i * 1000);
    const b = f.policy.modes().find(m => m.signature === 2), bBefore = stats(f, b);
    assert.deepEqual(stats(f, a), aBefore);
    const back = f.add(1, 24000);
    assert.equal(back.after.modeId, a.id);
    assert.deepEqual(stats(f, b), bBefore);
    for (let i = 25; i < 29; i++) f.add(1, i * 1000, false);
    assert.equal(stats(f, a).directEligible, false);
    assert.equal(stats(f, a).totalFailureCount, 4);
    assert.equal(f.policy.modes().length, 2);
});

test("consolidation is independent of success: a durable failing regime is also learned", () => {
    const f = fixture();
    f.add(7, 0, false); f.add(7, 1000, false); f.add(7, 2000, false);
    assert.equal(f.policy.modes().length, 1);
    const learned = stats(f, f.policy.modes()[0]);
    assert.equal(learned.totalFailureCount, 3); assert.equal(learned.directEligible, false);
});

test("snapshot restores durable support, not an unfinished consolidation or active hypothesis", () => {
    const f = fixture();
    f.add(1, 0); f.add(1, 1000); f.add(1, 2000); f.add(2, 3000); f.add(2, 4000);
    const snapshot = new AdaptiveCueObserver(f.policy, schema).snapshot();
    const restored = AdaptiveCueObserver.restore(snapshot);
    assert.deepEqual(restored.snapshot(), snapshot);
    const next = fixture(restored.policy);
    assert.equal(next.tracker.belief(state, intention).status, "unknown");
    assert.equal(next.tracker.consolidation(state, intention), undefined);
    next.add(2, 5000);
    assert.equal(next.policy.modes().length, 1, "pending evidence from another runtime is not borrowed");
});

test("temporal support is validated on restore and cannot be forged from a short or foreign window", () => {
    const f = fixture(); f.add(1, 0); f.add(1, 1000); f.add(1, 2000);
    const snapshot = f.policy.snapshot();
    for (const change of [
        s => { delete s.operatingMemory.modes[0].consolidationSupport; },
        s => { s.operatingMemory.modes[0].consolidationSupport = ["e1", "e1", "e3"]; },
        s => { s.operatingMemory.modes[0].consolidationSupport = ["e1", "e2", "missing"]; },
        s => { s.operatingMemory.config.consolidation.minimumDurationMs = 3000; },
        s => { s.operatingMemory.config.consolidation.maximumGapMs = 500; },
        s => { s.operatingMemory.modes[0].createdAt = 10000; },
    ]) {
        const copy = structuredClone(snapshot); change(copy);
        assert.throws(() => ContextualPolicyGraph.restore(copy));
    }
});

test("clock reversal is rejected before appending or mutating evidence", () => {
    const f = fixture(); f.add(1, 1000);
    const before = f.policy.snapshot(), progress = f.tracker.consolidation(state, intention);
    assert.throws(() => f.add(1, 900), /monotonic/);
    assert.deepEqual(f.policy.snapshot(), before); assert.deepEqual(f.tracker.consolidation(state, intention), progress);
});

test("context, intention and live trackers do not pool temporal persistence", () => {
    const f = fixture(), other = { id: "elsewhere", features: state.features }, goal = { id: "service", parameters: { target: 9 } };
    f.add(1, 0); f.add(1, 1000, true, other); f.add(1, 2000, true, state, goal);
    assert.equal(f.policy.modes().length, 0);
    const separate = new OperatingContextTracker(f.policy, provider);
    assert.equal(separate.consolidation(state, intention), undefined);
    assert.equal(separate.belief(state, intention).status, "unknown");
});

test("bounded pending windows do not grow forever when the clock is stalled", () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.add(1, 0);
    const statuses = f.policy.snapshot().experiences.map(e => e.attribution.current.status);
    assert.ok(statuses.filter(s => s === "pending").length <= config.maximumPendingObservations);
    assert.equal(f.policy.modes().length, 0);
});

test("mode capacity never grants replay to an unrepresented stable regime", () => {
    const f = fixture(new ContextualPolicyGraph(provider.id, { noveltyConfirmations: 2, maximumModesPerScope: 1, consolidation: config }));
    f.add(1, 0); f.add(1, 1000); f.add(1, 2000);
    const before = stats(f, f.policy.modes()[0]);
    f.add(2, 3000); f.add(2, 4000); const result = f.add(2, 5000);
    assert.equal(result.after.status, "uncertain");
    assert.deepEqual(stats(f, f.policy.modes()[0]), before);
    assert.ok(f.policy.findCandidateActions(state, intention).every(c => !c.eligible));
});

test("invalid consolidation configurations are rejected without changing V2 defaults", () => {
    for (const change of [{ minimumObservations: 1 }, { minimumDurationMs: 0 }, { maximumGapMs: Infinity },
        { maximumPendingObservations: 2 }, { maximumPendingObservations: 100000 }, { extra: true }]) {
        assert.throws(() => new ContextualPolicyGraph(provider.id, { ...DEFAULT_OPERATING_CONTEXT_CONFIG, consolidation: { ...config, ...change } }));
    }
    const legacy = fixture(new ContextualPolicyGraph(provider.id));
    legacy.add(1, 0); legacy.add(1, 1);
    assert.equal(legacy.policy.modes().length, 1);
    assert.equal(legacy.policy.modes()[0].consolidationSupport, undefined);
    assert.equal(advanceConsolidation(undefined, "effect", 0, config).status, "pending");
});

test("a sustained known regime is not consolidated again on every observation", () => {
    const f = fixture();
    f.add(1, 0); f.add(1, 1000); f.add(1, 2000);
    const first = f.policy.modes()[0];
    for (let i = 3; i < 30; i++) f.add(1, i * 1000);
    assert.deepEqual(f.policy.modes(), [first]);
    assert.equal(f.policy.snapshot().experiences.length, 30);
});
