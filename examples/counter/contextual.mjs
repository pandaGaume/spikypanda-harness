import { ContextualPolicyGraph, OperatingContextTracker, createGraphDriver } from "../../packages/harness/dist/index.js";
import { createCounterHarness } from "./harness.mjs";
import { createCounterRuntime } from "./world.mjs";

/** Only the sample defines how to describe its observed command/effect relation. No world reference. */
export const counterEffectSignature = Object.freeze({
    id: "counter.unit-command-effect.v1",
    describe({ context, decision, stateAfter, result }) {
        const delta = Number(decision.invocation.input?.delta);
        const effect = Number(stateAfter.features.value) - Number(context.state.features.value);
        if (!result.ok || ![-1, 1].includes(delta) || ![-1, 1].includes(effect)) return null;
        return { gain: effect / delta };
    },
});

export function createCounterHarnessV2(target = 3) {
    const definition = createCounterHarness(target);
    return { ...definition, nodes: definition.nodes.map(node => ({
        ...node, type: node.id === "lookup" ? "Harness.Policy:contextual-lookup" :
            node.id === "record" ? "Harness.Learning:contextual-record" : node.type,
    })) };
}
export function createCounterPolicy(snapshot, plasticity, config) {
    const policy = snapshot ? ContextualPolicyGraph.restore(snapshot, counterEffectSignature.id) :
        new ContextualPolicyGraph(counterEffectSignature.id, config, plasticity);
    if (policy.modelId !== counterEffectSignature.id) throw new Error("Cette mémoire utilise un autre modèle d'effets");
    return policy;
}
export function createCounterRuntimeV2(policy, world, options = {}) {
    const operatingContexts = new OperatingContextTracker(policy, counterEffectSignature);
    return { ...createCounterRuntime(policy, world, { ...options, operatingContexts,
        driver: options.driver ?? createGraphDriver(createCounterHarnessV2(world.target)) }), operatingContexts };
}
