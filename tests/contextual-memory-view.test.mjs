import assert from "node:assert/strict";
import test from "node:test";
import { CounterWorld } from "../examples/counter/world.mjs";
import { createCounterPolicy, createCounterRuntimeV2 } from "../examples/counter/contextual.mjs";
import { projectMemory } from "../examples/editor/memory-model.mjs";
import { ContextualPolicyGraph } from "../packages/harness/dist/index.js";

const intention = { id: "reach-target", parameters: { target: 3 } };
function fixture() {
    const policy = createCounterPolicy(), world = new CounterWorld();
    return { policy, world, ...createCounterRuntimeV2(policy, world) };
}
async function step(f) {
    if (f.world.value === f.world.target) f.world.reset();
    return f.runtime.step(intention);
}
test("V2 pending evidence is visible without inventing a learned transition", async () => {
    const f = fixture(); await step(f);
    const before = f.policy.snapshot(), view = projectMemory(f.policy, 12, f.operatingContexts);
    assert.equal(view.modeCount, 0); assert.equal(view.transitions.length, 0);
    assert.equal(view.experiences[0].transitionId, undefined);
    assert.equal(view.experiences[0].attributionStatus, "pending");
    assert.ok(view.nodes.some(n => n.kind === "experience"));
    assert.ok(view.relations.some(r => r.kind === "executed"));
    assert.deepEqual(f.policy.snapshot(), before);
});
test("V2 memory projection distinguishes a dormant reliable skill from an applicable one", async () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) await step(f);
    const before = projectMemory(f.policy, 12, f.operatingContexts);
    const reliable = before.transitions.find(t => t.eligible);
    f.world.reset(); f.world.invert();
    for (let i = 0; i < 8; i++) await step(f);
    const snapshot = f.policy.snapshot(), view = projectMemory(f.policy, 12, f.operatingContexts);
    const dormant = view.transitions.find(t => t.id === reliable.id);
    assert.equal(dormant.applicability, "dormant");
    assert.equal(dormant.conditionalEligible, true); assert.equal(dormant.eligible, false);
    assert.deepEqual(dormant.stats, reliable.stats);
    assert.ok(view.transitions.some(t => t.eligible && t.modeId !== dormant.modeId));
    assert.deepEqual(f.policy.snapshot(), snapshot);
    const restored = ContextualPolicyGraph.restore(snapshot);
    assert.ok(projectMemory(restored).transitions.every(t => !t.eligible));
    assert.equal(projectMemory(restored).modeCount, 2);
});
test("V2 view retains the original hypothesis and follows the revised experience attribution", async () => {
    const f = fixture(); for (let i = 0; i < 6; i++) await step(f);
    f.world.reset(); f.world.invert();
    const trace = await step(f);
    const id = "experience:experience:" + trace.decisionId;
    assert.equal(projectMemory(f.policy).experiences.find(e => e.id === id).attributionStatus, "pending");
    await step(f);
    const view = projectMemory(f.policy, 12, f.operatingContexts), e = view.experiences.find(e => e.id === id);
    assert.equal(e.modeBefore, "M1"); assert.equal(e.modeAfter, "M2");
    assert.equal(e.attributionStatus, "confirmed");
    assert.ok(view.transitions.some(t => t.id === e.transitionId && t.modeLabel === "M2"));
    assert.ok(view.relations.some(r => r.from === id && r.kind === "contradicts"));
});
