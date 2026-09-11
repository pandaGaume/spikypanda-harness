import assert from "node:assert/strict";
import { createCounterCueMemory, createCounterRuntimeV3, CounterCueWorld } from "./perceptive.mjs";
const intention = { id: "reach-target", parameters: { target: 3 } };
const rows = [];
for (const mode of ["shadow", "active"]) {
    const world = new CounterCueWorld(), observer = createCounterCueMemory();
    const { runtime, fallback } = createCounterRuntimeV3(observer, world, { cueMode: mode });
    for (let episode = 1; episode <= 25; episode++) {
        if ([9, 17, 22].includes(episode)) world.invert();
        world.reset();
        const calls = fallback.calls;
        let steps = 0, failures = 0, cueSelections = 0;
        while (world.value !== world.target && steps < 20) {
            const trace = await runtime.step(intention);
            steps++; if (!trace.evaluation.success) failures++;
            if (trace.cues.basis === "cues") cueSelections++;
        }
        assert.equal(world.value, world.target);
        rows.push({ mode, episode, steps, failures, fallback: fallback.calls - calls, cueSelections });
    }
}
console.table(rows.filter(r => [1, 9, 17, 22].includes(r.episode)));
console.table(["shadow", "active"].map(mode => ({
    mode, episodes: rows.filter(r => r.mode === mode).length,
    actions: rows.filter(r => r.mode === mode).reduce((n, r) => n + r.steps, 0),
    failures: rows.filter(r => r.mode === mode).reduce((n, r) => n + r.failures, 0),
    fallback: rows.filter(r => r.mode === mode).reduce((n, r) => n + r.fallback, 0),
})));
for (const episode of [17, 22]) assert.equal(rows.find(r => r.mode === "active" && r.episode === episode).failures, 0);
