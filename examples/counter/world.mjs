import { AdaptivePolicyRuntime, CapabilityRegistry, createGraphDriver, abortable } from "../../packages/harness/dist/index.js";
import { MockReasoningProvider } from "../../packages/provider-mock/dist/index.js";

import { createCounterHarness } from "./harness.mjs";

export class CounterWorld {
    value = 0;
    direction = 1;
    revision = 0;
    target = 3;
    reset() { this.value = 0; this.revision++; }
    invert() { this.direction *= -1; this.revision++; }
    async observe() {
        return { id: this.value < this.target ? "below" : this.value > this.target ? "above" : "at-target",
            features: { value: this.value, target: this.target, revision: this.revision } };
    }
}

/** No reference to the world or its hidden direction: infer effects from observed failures only. */
export function counterReasoner(input) {
    const target = Number(input.intention.parameters?.target ?? input.state.features.target);
    const wanted = Math.sign(target - Number(input.state.features.value)) || 1;
    const evidence = input.recentFailures.find(exp => Number(exp.stateAfter.features.value) !== Number(exp.context.state.features.value));
    const direction = evidence ? Math.sign((Number(evidence.stateAfter.features.value) - Number(evidence.context.state.features.value)) / Number(evidence.decision.invocation.input.delta)) : 1;
    const delta = wanted * direction;
    const actionId = delta > 0 ? "increment" : "decrement";
    return { action: { id: actionId, description: actionId }, invocation: { actionId, capabilityId: "counter.move", input: { delta } },
        rationale: evidence ? "Direction inferred from the most recent observed failed move" : "Initial hypothesis: positive commands increase the counter" };
}

export function createCounterRuntime(policy, world, { onStage, delayMs = 0, operatingContexts, cueObserver, cueMode, driver = createGraphDriver(createCounterHarness(world.target)) } = {}) {
    const capabilities = new CapabilityRegistry();
    capabilities.register({
        descriptor: { id: "counter.move", description: "Send a signed unit command to the counter", replayPolicy: "automatic",
            inputSchema: { type: "object", properties: { delta: { type: "integer", enum: [-1, 1] } }, required: ["delta"], additionalProperties: false } },
        async execute({ delta }, context) {
            context.signal?.throwIfAborted();
            world.value += delta * world.direction;
            world.revision++;
            return { ok: true, output: world.value };
        },
    });
    const fallback = new MockReasoningProvider(async input => {
        if (delayMs) await abortable(() => new Promise(resolve => setTimeout(resolve, delayMs)), input.signal);
        return counterReasoner(input);
    });
    const runtime = new AdaptivePolicyRuntime({ cueObserver, cueMode, operatingContexts, driver, policy, capabilities, fallback, observer: world, onStage,
        safetyGuard: { async validate(_decision, context) { return { allowed: Math.abs(Number(context.state.features.value)) < 20, reason: "Counter safety boundary reached" }; } },
        evaluator: { evaluate({ context, stateAfter, result }) {
            const target = Number(context.intention.parameters.target);
            const success = result.ok && Math.abs(target - Number(stateAfter.features.value)) < Math.abs(target - Number(context.state.features.value));
            return { success, reward: success ? 1 : -1, reason: success ? "Closer to the target" : "No progress towards the target" };
        } },
    });
    return { runtime, fallback };
}
