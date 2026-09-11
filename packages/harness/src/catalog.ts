import { CueObserverNode, CuePolicyLookupNode } from "./cue-nodes.js";
import { StateObserverNode, DecisionContextNode, PolicyLookupNode, ConfidenceGateNode, FallbackRequestNode,
    ReasoningProviderNode, DecisionMergeNode, SafetyGuardNode, CapabilityExecutorNode, OutcomeObserverNode,
    OutcomeEvaluatorNode, ExperienceRecorderNode, HarnessNode } from "./nodes.js";
import { ContextualPolicyLookupNode, ContextualExperienceRecorderNode } from "./contextual-nodes.js";

export const V1_HARNESS_NODES = [
    { type: "Harness.Observation:state", label: "Observer", ctor: StateObserverNode },
    { type: "Harness.Policy:context", label: "Contexte + intention", ctor: DecisionContextNode },
    { type: "Harness.Policy:lookup", label: "Chercher une policy", ctor: PolicyLookupNode },
    { type: "Harness.Policy:confidence-gate", label: "Confiance suffisante ?", ctor: ConfidenceGateNode },
    { type: "Harness.Reasoning:request", label: "Construire la demande", ctor: FallbackRequestNode },
    { type: "Harness.Reasoning:provider", label: "Raisonneur (mock)", ctor: ReasoningProviderNode },
    { type: "Harness.Policy:merge", label: "Fusion des branches", ctor: DecisionMergeNode },
    { type: "Harness.Safety:guard", label: "Valider + autoriser", ctor: SafetyGuardNode },
    { type: "Harness.Execution:capability", label: "Executer la capacite", ctor: CapabilityExecutorNode },
    { type: "Harness.Observation:outcome", label: "Observer le resultat", ctor: OutcomeObserverNode },
    { type: "Harness.Learning:evaluate", label: "Evaluer le progres", ctor: OutcomeEvaluatorNode },
    { type: "Harness.Learning:record", label: "Apprendre", ctor: ExperienceRecorderNode },
] as const;

export const HARNESS_NODES = [...V1_HARNESS_NODES,
    { type: "Harness.Observation:cues", label: "Observer les indices", ctor: CueObserverNode },
    { type: "Harness.Policy:cue-lookup", label: "Reconnaître les conditions", ctor: CuePolicyLookupNode },
    { type: "Harness.Policy:contextual-lookup", label: "Chercher selon le fonctionnement", ctor: ContextualPolicyLookupNode },
    { type: "Harness.Learning:contextual-record", label: "Attribuer et apprendre", ctor: ContextualExperienceRecorderNode },
] as const;

export type HarnessNodeFactory = (type: string) => HarnessNode;

export function createHarnessNode(type: string): HarnessNode {
    const entry = HARNESS_NODES.find(n => n.type === type);
    if (!entry) throw new Error(`Unknown harness node type: ${type}`);
    const node = new entry.ctor();
    node.type = type;
    return node;
}
