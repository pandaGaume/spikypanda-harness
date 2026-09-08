import {
    AdaptivePolicyRuntime,
    CapabilityRegistry,
    PolicyGraph,
} from "../../packages/harness/dist/index.js";
import { MockReasoningProvider } from "../../packages/provider-mock/dist/index.js";

class CounterWorld {
    value = 0;
    target = 4;
    inverted = false;

    reset() {
        this.value = 0;
    }

    async observe() {
        return {
            id: `counter:${this.value}`,
            features: { value: this.value, target: this.target },
        };
    }
}

const world = new CounterWorld();
const capabilities = new CapabilityRegistry();
capabilities.register({
    descriptor: { id: "counter.increment", description: "Increment counter" },
    async execute() {
        world.value += world.inverted ? -1 : 1;
        return { ok: true, output: world.value };
    },
});
capabilities.register({
    descriptor: { id: "counter.decrement", description: "Decrement counter" },
    async execute() {
        world.value += world.inverted ? 1 : -1;
        return { ok: true, output: world.value };
    },
});

const policy = new PolicyGraph();
const fallback = new MockReasoningProvider(({ state }) => {
    const value = Number(state.features.value);
    const target = Number(state.features.target);
    const logicalDirection = value < target ? "increment" : "decrement";
    const physicalDirection = world.inverted
        ? logicalDirection === "increment" ? "decrement" : "increment"
        : logicalDirection;
    return {
        action: { id: physicalDirection, description: `${physicalDirection} counter` },
        invocation: {
            actionId: physicalDirection,
            capabilityId: `counter.${physicalDirection}`,
            input: null,
        },
    };
});

const runtime = new AdaptivePolicyRuntime({
    policy,
    fallback,
    capabilities,
    observer: world,
    evaluator: {
        evaluate({ context, stateAfter, result }) {
            const before = Number(context.state.features.value);
            const after = Number(stateAfter.features.value);
            const target = Number(context.state.features.target);
            const improved = Math.abs(target - after) < Math.abs(target - before);
            return { success: result.ok && improved, reward: result.ok && improved ? 1 : -1 };
        },
    },
});

const intention = { id: "reach-target", description: "Reach target counter value" };
const rows = [];
for (let episode = 1; episode <= 20; episode += 1) {
    world.inverted = episode >= 11;
    world.reset();
    const before = runtime.metrics.snapshot();
    let steps = 0;
    while (world.value !== world.target && steps < 30) {
        await runtime.step(intention);
        steps += 1;
    }
    const after = runtime.metrics.snapshot();
    rows.push({
        episode,
        phase: world.inverted ? "reversed" : "normal",
        success: world.value === world.target,
        steps,
        fallbackCalls: after.fallbackCalls - before.fallbackCalls,
        policyHits: after.policyHits - before.policyHits,
    });
}

console.table(rows);

