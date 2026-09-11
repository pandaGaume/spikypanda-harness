import assert from "node:assert/strict";
import test from "node:test";
import { TemporalCueObserver } from "../packages/harness/dist/index.js";
import { CounterCueWorld, createCounterCueMemory, createCounterRuntimeV3 } from "../examples/counter/perceptive.mjs";
const intention = { id: "reach-target", parameters: { target: 3 } };
for (const propagation of ["continuous", "spikes", "spikes-modulated"]) test(propagation + ": learned temporal eligibility follows the real graph and cannot bypass safety", async () => {
    const world = new CounterCueWorld(), base = createCounterCueMemory();
    const training = createCounterRuntimeV3(base, world, { cueMode: "active" });
    for (const direction of [1, -1]) {
        if (world.direction !== direction) world.invert();
        for (let i = 0; i < 24; i++) { world.reset(); await training.runtime.step(intention); }
    }
    world.invert();
    let time = 0;
    const observer = new TemporalCueObserver(base, propagation, () => time);
    const { runtime } = createCounterRuntimeV3(observer, world, { cueMode: "active" });
    const dormant = base.policy.modes().find(m => m.signature.gain === -1);
    const dormantStats = () => base.policy.snapshot().transitions.filter(t =>
        base.policy.snapshot().contexts.some(c => c.key === t.contextKey && c.operatingContextId === dormant.id));
    const before = dormantStats(), traces = [];
    for (let i = 0; i < 8; i++) {
        time++; world.reset(); traces.push(await runtime.step(intention));
    }
    assert.equal(traces[0].cues.assessment.temporal.reason, "integrating");
    assert.ok(traces.some(t => t.cues.basis === "cues" && t.source === "policy" && t.evaluation.success));
    assert.deepEqual(dormantStats(), before);
    assert.ok(observer.inspect().nodeFirings > 0);
    if (propagation !== "continuous") assert.ok(observer.inspect().spikeEvents > 0);
    world.value = -21; world.revision++; time++;
    const memory = base.policy.snapshot();
    await assert.rejects(runtime.step(intention), /Counter safety boundary/);
    assert.deepEqual(base.policy.snapshot(), memory);
    assert.equal(world.value, -21);
    observer.network.session.reset();
    assert.deepEqual(base.policy.snapshot(), memory);
});
