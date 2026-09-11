import type { DecisionContext, PolicyDecision, TransitionStats, Experience } from "./model.js";

export interface TopologyCondition {
    readonly id: string; readonly kind: "condition"; readonly path: ReadonlyArray<string>;
    readonly center: number; readonly tolerance: number; readonly vetoOnMismatch?: boolean;
}
export interface TopologyCombination {
    readonly id: string; readonly kind: "and" | "or"; readonly inputs: ReadonlyArray<string>;
}
export interface TopologyBranch {
    readonly id: string; readonly kind: "branch"; readonly inputs: readonly ["support"];
    readonly decision: PolicyDecision; readonly stats: TransitionStats;
    readonly experienceIds: ReadonlyArray<string>;
}
export type TopologyNodeDefinition = TopologyCondition | TopologyCombination | TopologyBranch;
export interface TopologyEdge { readonly id: string; readonly from: string; readonly to: string; readonly input: string; }
export interface TopologyDefinition {
    readonly version: 1; readonly revision: string; readonly schemaVersion: string;
    readonly contextKey: string;
    readonly nodes: ReadonlyArray<TopologyNodeDefinition>;
    readonly edges: ReadonlyArray<TopologyEdge>;
}
export interface TopologyConfig {
    readonly minimumSupport: number; readonly minimumMargin: number; readonly minimumConfidence: number;
    readonly maximumNodes: number; readonly maximumEdges: number; readonly maximumPasses: number;
    readonly maximumObservationAgeSeconds: number;
}
export const DEFAULT_TOPOLOGY_CONFIG: TopologyConfig = Object.freeze({
    minimumSupport: 0.6, minimumMargin: 0.15, minimumConfidence: 0.75,
    maximumNodes: 256, maximumEdges: 1024, maximumPasses: 10000, maximumObservationAgeSeconds: 2,
});
export interface TopologyFrame {
    readonly observationId: string; readonly decisionId: string;
    readonly observedAtSeconds: number; readonly availableAtSeconds: number; readonly timeSeconds: number;
    readonly memoryRevision: string; readonly schemaVersion: string; readonly context: DecisionContext;
}
export interface TopologyEvidence {
    readonly observationId: string; readonly path: ReadonlyArray<string>;
}
export interface TopologySignal {
    readonly known: boolean; readonly support: number;
    readonly evidence: ReadonlyArray<TopologyEvidence>;
    readonly blockers: ReadonlyArray<string>; readonly missing: ReadonlyArray<string>;
    readonly nodeIds: ReadonlyArray<string>; readonly edgeIds: ReadonlyArray<string>;
}
export interface TopologyProposal {
    readonly branchId: string; readonly support: number; readonly decision: PolicyDecision;
    readonly stats: TransitionStats; readonly experienceIds: ReadonlyArray<string>;
    readonly signal: TopologySignal;
}
export interface TopologyNodeTrace {
    readonly nodeId: string; readonly implementation: string; readonly signal: TopologySignal;
}
export interface TopologyPass {
    readonly temporal?: import("./topology-temporal-types.js").TopologyTemporalPass;
    readonly kind: "topology-activation"; readonly version: 1; readonly completed: true;
    readonly observationId: string; readonly decisionId: string; readonly memoryRevision: string;
    readonly schemaVersion: string; readonly timeSeconds: number; readonly contextKey: string;
    readonly observedAtSeconds: number; readonly availableAtSeconds: number;
    readonly proposals: ReadonlyArray<TopologyProposal>; readonly trace: ReadonlyArray<TopologyNodeTrace>;
    readonly work: {
        readonly sourceFirings: number; readonly nodeFirings: number; readonly relationDeliveries: number;
        readonly positiveOutputs: number; readonly completionOnlyOutputs: number; readonly spikeEvents: number;
    };
}
export interface TopologyArbitration {
    readonly reason: "selected" | "empty" | "insufficient" | "ambiguous" | "unreliable";
    readonly groups: ReadonlyArray<{ invocationKey: string; support: number; branchIds: ReadonlyArray<string> }>;
    readonly selected?: TopologyProposal;
}

/** Audited outcome plus the observation passage, without assigning learning credit. */
export interface TopologyExperience extends Experience {
    readonly activation: TopologyPass;
    readonly arbitration: TopologyArbitration;
}
