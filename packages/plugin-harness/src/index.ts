import type { IPortDescriptor } from "@spiky-panda/core";
import {
    CapabilityExecutorNode,
    ConfidenceGateNode,
    ExperienceRecorderNode,
    PolicyLookupNode,
    ReasoningProviderNode,
    SafetyGuardNode,
} from "./nodes.js";
import type { HarnessPlugin, HarnessPluginContext } from "./plugin-types.js";

export * from "./nodes.js";
export * from "./plugin-types.js";

type NodeConstructor = new () => {
    inputPorts: ReadonlyArray<IPortDescriptor>;
    outputPorts: ReadonlyArray<IPortDescriptor>;
};

function register(ctx: HarnessPluginContext, type: string, label: string, category: string, ctor: NodeConstructor): void {
    const sample = new ctor();
    ctx.nodes.register(type, () => new ctor() as never, {
        label,
        category,
        inputPorts: sample.inputPorts,
        outputPorts: sample.outputPorts,
    });
}

const policySubPlugin: HarnessPlugin = {
    activate(ctx): void {
        register(ctx, "Harness.Policy:lookup", "Policy Lookup", "Harness.Policy", PolicyLookupNode);
        register(ctx, "Harness.Policy:confidence-gate", "Confidence Gate", "Harness.Policy", ConfidenceGateNode);
    },
};

const reasoningSubPlugin: HarnessPlugin = {
    activate(ctx): void {
        register(ctx, "Harness.Reasoning:provider", "Reasoning Provider", "Harness.Reasoning", ReasoningProviderNode);
    },
};

const safetySubPlugin: HarnessPlugin = {
    activate(ctx): void {
        register(ctx, "Harness.Safety:guard", "Safety Guard", "Harness.Safety", SafetyGuardNode);
    },
};

const executionSubPlugin: HarnessPlugin = {
    activate(ctx): void {
        register(ctx, "Harness.Execution:capability", "Capability Executor", "Harness.Execution", CapabilityExecutorNode);
    },
};

const learningSubPlugin: HarnessPlugin = {
    activate(ctx): void {
        register(ctx, "Harness.Learning:record", "Experience Recorder", "Harness.Learning", ExperienceRecorderNode);
    },
};

const plugin: HarnessPlugin = {
    activate(_ctx): void {},
    subPlugins: {
        "Harness.Policy": policySubPlugin,
        "Harness.Reasoning": reasoningSubPlugin,
        "Harness.Safety": safetySubPlugin,
        "Harness.Execution": executionSubPlugin,
        "Harness.Learning": learningSubPlugin,
    },
};

export default plugin;

