import { PolicyGraph } from "../../packages/harness/dist/index.js";
import { createCounterHarness, createGraphDriver } from "../../packages/plugin-harness/dist/index.js";
import { CounterWorld, createCounterRuntime } from "./world.mjs";

const world = new CounterWorld();
const { runtime, fallback } = createCounterRuntime(new PolicyGraph(), world);
const definition = createCounterHarness();
const driver = createGraphDriver(definition);
const rows = [];
for (let episode = 1; episode <= 20; episode++) {
    if (episode === 11 || episode === 16) world.invert();
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
