import assert from "node:assert/strict";
import test from "node:test";
import { PolicyGraph } from "../packages/harness/dist/index.js";

const state = { id: "counter:0", features: { value: 0 } };
const stateAfter = { id: "counter:1", features: { value: 1 } };
const intention = { id: "reach:4" };
const decision = {
    source: "fallback",
    action: { id: "increment", description: "Increment" },
    invocation: { actionId: "increment", capabilityId: "counter.increment", input: null },
};

function record(policy, success, reward = success ? 1 : -1) {
    policy.recordExperience({
        stateBefore: state,
        intention,
        decision,
        stateAfter,
        result: { ok: success },
        evaluation: { success, reward },
    });
}

test("an unknown context misses, then three successes consolidate it", () => {
    const policy = new PolicyGraph();
    assert.equal(policy.findCandidateActions(state, intention).length, 0);
    record(policy, true);
    assert.equal(policy.findCandidateActions(state, intention)[0].eligible, false);
    record(policy, true);
    record(policy, true);
    const candidate = policy.findCandidateActions(state, intention)[0];
    assert.equal(candidate.eligible, true);
    assert.ok(candidate.confidence < 1);
});

test("ten thousand successes do not make a transition irreversible", () => {
    const policy = new PolicyGraph();
    for (let i = 0; i < 10_000; i += 1) record(policy, true);
    assert.equal(policy.findCandidateActions(state, intention)[0].eligible, true);
    record(policy, false);
    assert.equal(policy.findCandidateActions(state, intention)[0].eligible, true);
    record(policy, false);
    record(policy, false);
    const candidate = policy.findCandidateActions(state, intention)[0];
    assert.equal(candidate.eligible, false);
    assert.equal(candidate.stats.totalSuccessCount, 10_000);
    assert.equal(candidate.stats.totalFailureCount, 3);
});

test("intentions isolate policies for the same observable state", () => {
    const policy = new PolicyGraph();
    record(policy, true);
    const otherIntention = { id: "reach:-4" };
    assert.equal(policy.findCandidateActions(state, otherIntention).length, 0);
});

test("a snapshot round-trip retains both evidence and plasticity", () => {
    const policy = new PolicyGraph();
    record(policy, true);
    record(policy, true);
    record(policy, true);
    const restored = PolicyGraph.fromSnapshot(JSON.parse(JSON.stringify(policy.snapshot())));
    assert.equal(restored.findCandidateActions(state, intention)[0].eligible, true);

    const restoredDecision = { ...decision, source: "policy" };
    for (let i = 0; i < 3; i += 1) {
        restored.recordExperience({
            stateBefore: state,
            intention,
            decision: restoredDecision,
            stateAfter: state,
            result: { ok: false },
            evaluation: { success: false, reward: -1 },
        });
    }
    assert.equal(restored.findCandidateActions(state, intention)[0].eligible, false);
});

