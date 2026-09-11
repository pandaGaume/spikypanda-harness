import assert from "node:assert/strict";
import test from "node:test";
import { createGraphDriver, createDecisionContext } from "../packages/harness/dist/index.js";
import { createCounterHarness } from "../examples/counter/harness.mjs";
import { createCounterHarnessV2, createCounterRuntimeV2, createCounterPolicy } from "../examples/counter/contextual.mjs";
import { CounterWorld } from "../examples/counter/world.mjs";
import { CounterCueWorld, createCounterHarnessV3, createCounterCueMemory, createCounterRuntimeV3, upgradeCounterHarnessV3 } from "../examples/counter/perceptive.mjs";
import { projectCues } from "../examples/editor/cue-model.mjs";
import { projectMemory } from "../examples/editor/memory-model.mjs";
const intention = { id: "reach-target", parameters: { target: 3 } };
async function trained() {
    const observer = createCounterCueMemory(), world = new CounterCueWorld();
    const { runtime, operatingContexts } = createCounterRuntimeV3(observer, world, { cueMode: "active" });
    for (const gain of [1, -1]) {
        if (world.direction !== gain) world.invert();
        for (let i = 0; i < 24; i++) { if (world.value === 3) world.reset(); await runtime.step(intention); }
    }
    world.reset(); return { observer, world, operatingContexts };
}

test("Counter graph migration preserves V1/V2 node identity, layout and wiring without mutating saves", () => {
    for (const original of [createCounterHarness(), createCounterHarnessV2()]) {
        const saved = JSON.stringify(original), next = upgradeCounterHarnessV3(original);
        assert.equal(next.nodes.length, original.nodes.length + 1);
        for (const old of original.nodes) {
            const n = next.nodes.find(n => n.id === old.id);
            assert.equal(n.x, old.x); assert.equal(n.y, old.y); assert.equal(n.enabled, old.enabled);
        }
        for (const old of original.edges.filter(e => e.to !== "lookup" || e.input !== "context")) assert.ok(next.edges.some(e => JSON.stringify(e) === JSON.stringify(old)));
        createGraphDriver(next);
        assert.equal(JSON.stringify(original), saved);
        assert.deepEqual(upgradeCounterHarnessV3(next), next);
    }
});

test("Counter upgrade avoids node ID collisions and rejects ambiguous or incomplete old graphs", () => {
    const collision = structuredClone(createCounterHarnessV2());
    collision.nodes[0].id = "cues";
    collision.edges = collision.edges.map(e => e.from === "observe" ? { ...e, from: "cues" } : e);
    // Use the actual original first-node ID rather than assuming its name.
    const original = createCounterHarnessV2(), firstId = original.nodes[0].id;
    collision.edges = original.edges.map(e => e.from === firstId ? { ...e, from: "cues" } : e);
    const next = upgradeCounterHarnessV3(collision);
    assert.ok(next.nodes.some(n => n.id === "cues-v3")); createGraphDriver(next);
    const incomplete = { ...original, edges: original.edges.filter(e => e.to !== "lookup" || e.input !== "context") };
    assert.throws(() => upgradeCounterHarnessV3(incomplete));
    const ambiguous = { ...original, nodes: [...original.nodes, { id: "extra", type: "Harness.Policy:contextual-lookup", x: 0, y: 0 }] };
    assert.throws(() => upgradeCounterHarnessV3(ambiguous));
    assert.deepEqual(upgradeCounterHarnessV3(createCounterHarnessV3()), createCounterHarnessV3());
});

test("V2 snapshots migrate without invented sensor measurements or destructive writes", async () => {
    const policy = createCounterPolicy(), world = new CounterWorld();
    const { runtime } = createCounterRuntimeV2(policy, world);
    for (let i = 0; i < 6; i++) { if (world.value === 3) world.reset(); await runtime.step(intention); }
    const original = policy.snapshot(), observer = createCounterCueMemory(original);
    assert.deepEqual(observer.policy.snapshot(), original);
    assert.equal(observer.snapshot().version, 3);
    assert.ok(observer.policy.snapshot().experiences.every(e => !e.cues && !e.context.state.features.telemetry));
    const assessment = observer.assess(createDecisionContext(new CounterCueWorld().current(), intention));
    assert.equal(assessment.status, "learning");
});

test("preview points to actual earlier experiences and changes applicability without changing confidence", async () => {
    const f = await trained(), policy = f.observer.policy, before = policy.snapshot();
    f.world.invert();
    const view = projectCues(f.observer, f.world.current(), intention, "active", f.operatingContexts);
    assert.equal(view.basis, "cues");
    assert.equal(policy.mode(view.assessment.modeId).signature.gain, 1);
    assert.ok(view.candidates.every(c => c.examples.every(e => before.experiences[e.number - 1].id === e.id)));
    const memory = projectMemory(policy, 12, view.memoryTracker);
    assert.ok(memory.transitions.some(t => t.eligible && t.modeId === view.assessment.modeId));
    assert.ok(memory.transitions.filter(t => t.modeId !== view.assessment.modeId).every(t => !t.eligible));
    assert.deepEqual(policy.snapshot(), before);
});

test("shadow and missing-cue previews show the actual selection policy, not an invented green branch", async () => {
    const f = await trained(), policy = f.observer.policy;
    f.world.invert();
    const shadow = projectCues(f.observer, f.world.current(), intention, "shadow", f.operatingContexts);
    assert.equal(shadow.basis, "shadow");
    const belief = shadow.memoryTracker.belief(f.world.current(), intention);
    assert.notEqual(belief.modeId, shadow.assessment.modeId);
    f.world.setCueVisibility("hidden");
    const missing = projectCues(f.observer, f.world.current(), intention, "active", f.operatingContexts);
    assert.equal(missing.basis, "uncertain");
    assert.ok(projectMemory(policy, 12, missing.memoryTracker).transitions.every(t => !t.eligible));
});
