import type { DecisionContext } from "./model.js";
import type { PolicySnapshot } from "./policy-graph.js";

export interface CueField {
    readonly id: string;
    /** Explicit allowlist, relative to State.features. No world/service access. */
    readonly path: ReadonlyArray<string>;
    readonly scale: number;
}
export interface CueSchema {
    readonly id: string;
    readonly version: number;
    readonly fields: ReadonlyArray<CueField>;
}
export interface CueConfig {
    readonly samplesPerMode: number;
    readonly minimumSamples: number;
    readonly recencyDecay: number;
    readonly minimumRelevance: number;
    readonly maximumDistance: number;
    readonly minimumMargin: number;
    readonly minimumCoverage: number;
}
export const DEFAULT_CUE_CONFIG: CueConfig = Object.freeze({
    samplesPerMode: 24, minimumSamples: 3, recencyDecay: 0.92,
    minimumRelevance: 0.1, maximumDistance: 0.35, minimumMargin: 0.2, minimumCoverage: 0.8,
});
export type CueRunMode = "shadow" | "active";
export type CueStatus = "learning" | "missing" | "ambiguous" | "novel" | "recognized";
export interface CueFeature {
    readonly id: string;
    readonly value: number | null;
    readonly relevance: number;
    readonly sourceRef: string;
}
export interface CueCandidate {
    readonly modeId: string;
    readonly distance: number;
    readonly experienceIds: ReadonlyArray<string>;
}
export interface CueAssessment {
    readonly encoder: string;
    readonly schemaKey: string;
    readonly modelRevision: number;
    readonly observationKey: string;
    readonly scope: string;
    readonly status: CueStatus;
    readonly modeId?: string;
    readonly features: ReadonlyArray<CueFeature>;
    readonly embedding: ReadonlyArray<number | null>;
    readonly coverage: number;
    readonly candidates: ReadonlyArray<CueCandidate>;
}
export interface CueDecision {
    readonly mode: CueRunMode;
    readonly basis: "cues" | "effect-history" | "uncertain" | "shadow";
    readonly assessment: CueAssessment;
}
export interface CueMemorySnapshot {
    readonly version: 3;
    readonly policy: PolicySnapshot;
    readonly observer: { readonly encoder: "harness.adaptive-metric.v1"; readonly schema: CueSchema; readonly config: CueConfig };
}
/** Host extension point. Implementations receive observed data, never the simulator. */
export interface CueObserver {
    readonly policy: import("./contextual-policy.js").ContextualPolicyGraph;
    assess(context: DecisionContext): CueAssessment;
    validateAssessment(context: DecisionContext, assessment: CueAssessment): void;
}
