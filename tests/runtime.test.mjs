import assert from "node:assert/strict";
import test from "node:test";
import {
    AdaptivePolicyRuntime,
    createGraphDriver,
    CapabilityRegistry,
    PolicyGraph,
} from "../packages/harness/dist/index.js";
import { MockReasoningProvider } from "../packages/provider-mock/dist/index.js";

import { createCounterHarness } from "../examples/counter/harness.mjs";

test("fallback use decreases while counter success stays stable", async () => {
    const world = {
        value: 0,
        target: 3,
        async observe() {
            return { id: `counter:${this.value}`, features: { value: this.value, target: this.target } };
        },
    };
    const capabilities = new CapabilityRegistry();
    capabilities.register({
        descriptor: { id: "counter.increment", description: "Increment" },
        async execute() {
            world.value += 1;
            return { ok: true, output: world.value };
        },
    });
    const fallback = new MockReasoningProvider(() => ({
        action: { id: "increment", description: "Increment" },
        invocation: { actionId: "increment", capabilityId: "counter.increment", input: null },
    }));
    const runtime = new AdaptivePolicyRuntime({
        driver: createGraphDriver(createCounterHarness()),
        policy: new PolicyGraph(),
        fallback,
        capabilities,
        observer: world,
        evaluator: {
            evaluate({ context, stateAfter }) {
                const success = Number(stateAfter.features.value) > Number(context.state.features.value);
                return { success, reward: success ? 1 : -1 };
            },
        },
    });
    const intention = { id: "reach-target" };
    const episodeFallbacks = [];
    for (let episode = 0; episode < 8; episode += 1) {
        world.value = 0;
        const before = runtime.metrics.snapshot().fallbackCalls;
        while (world.value < world.target) await runtime.step(intention);
        episodeFallbacks.push(runtime.metrics.snapshot().fallbackCalls - before);
    }
    assert.ok(episodeFallbacks.at(-1) < episodeFallbacks[0]);
    assert.equal(world.value, world.target);
});

