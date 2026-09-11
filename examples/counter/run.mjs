import { createGraphDriver } from "../../packages/harness/dist/index.js";
import { createCounterHarnessV2, createCounterPolicy, createCounterRuntimeV2 } from "./contextual.mjs";
import { CounterWorld } from "./world.mjs";

const world = new CounterWorld();
const { runtime, fallback } = createCounterRuntimeV2(createCounterPolicy(), world);
const definition = createCounterHarnessV2();
const driver = createGraphDriver(definition);
const rows = [];
for (let episode = 1; episode <= 25; episode++) {
    if (episode === 11 || episode === 16 || episode === 21) world.invert();
    world.reset();
    const before = runtime.metrics.snapshot();
    const calls = fallback.calls;
    let steps = 0;
    while (world.value !== world.target && steps < 20) {
        await runtime.step(definition.intention, undefined, driver);
        steps++;
    }
    rows.push({ episode, phase: world.direction === 1 ? "normal" : "reversed", success: world.value === world.target,
        steps, fallbackCalls: fallback.calls - calls, policyHits: runtime.metrics.snapshot().policyHits - before.policyHits });
}
console.table(rows);
if (rows.some(row => !row.success)) process.exitCode = 1;
