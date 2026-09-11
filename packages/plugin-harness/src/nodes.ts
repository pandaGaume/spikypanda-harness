/** Compatibility exports. Executable behavior belongs to the DOM-free harness package. */
export {
    HarnessNode, StateObserverNode, DecisionContextNode, PolicyLookupNode, ConfidenceGateNode,
    FallbackRequestNode, ReasoningProviderNode, DecisionMergeNode, SafetyGuardNode, CapabilityExecutorNode,
    OutcomeObserverNode, OutcomeEvaluatorNode, ExperienceRecorderNode, HARNESS_NODES, createHarnessNode, harnessPort,
} from "@spiky-panda/harness";
export type { HarnessNodeFactory } from "@spiky-panda/harness";

export { ContextualPolicyLookupNode, ContextualExperienceRecorderNode } from "@spiky-panda/harness";

export { CueObserverNode, CuePolicyLookupNode } from "@spiky-panda/harness";
