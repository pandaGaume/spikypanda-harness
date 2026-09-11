import { validateConsolidationConfig, type ConsolidationConfig } from "./consolidation.js";
import type { JsonValue, OutcomeEvaluationInput } from "./model.js";

export interface EffectSignatureProvider {
    readonly id: string;
    /** Describe an observable command/effect relation, or return null when ambiguous. */
    describe(input: OutcomeEvaluationInput): JsonValue | null;
}
export interface OperatingContextConfig {
    readonly noveltyConfirmations: number;
    readonly maximumModesPerScope: number;
    readonly consolidation?: ConsolidationConfig;
}
export const DEFAULT_OPERATING_CONTEXT_CONFIG: OperatingContextConfig = Object.freeze({
    noveltyConfirmations: 2, maximumModesPerScope: 8,
});
export function validateOperatingConfig(config: OperatingContextConfig): void {
    if (config.consolidation) {
        validateConsolidationConfig(config.consolidation);
        if (config.consolidation.minimumObservations < config.noveltyConfirmations) throw new Error("Consolidation cannot weaken novelty confirmation");
    }
    if (!Number.isSafeInteger(config.noveltyConfirmations) || config.noveltyConfirmations < 2 || config.noveltyConfirmations > 32 ||
        !Number.isSafeInteger(config.maximumModesPerScope) || config.maximumModesPerScope < 1 || config.maximumModesPerScope > 64) {
        throw new Error("Invalid operating-context configuration");
    }
}
export interface OperatingMode {
    readonly id: string;
    readonly scope: string;
    readonly signature: JsonValue;
    readonly label: string;
    readonly createdAt: number;
    /** Evidence window that first justified durable creation; no live activation is persisted. */
    readonly consolidationSupport?: ReadonlyArray<string>;
}
export interface OperatingBelief {
    readonly scope: string;
    readonly status: "unknown" | "recognized" | "uncertain";
    readonly modeId?: string;
}
export type AttributionStatus = "pending" | "confirmed" | "anomaly" | "unresolved" | "revised" | "transient";
export interface AttributionRevision {
    readonly status: AttributionStatus;
    readonly modeId?: string;
    readonly reason: string;
    readonly sequence: number;
}
export interface OperatingAttribution {
    readonly before: OperatingBelief;
    readonly signature: JsonValue | null;
    readonly current: AttributionRevision;
    readonly revisions: ReadonlyArray<AttributionRevision>;
}
export interface MemoryRelation {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly kind: "appliesTo" | "observedIn" | "executed" | "assumed" | "attributedTo" | "contradicts";
}
export interface OperatingMemorySnapshot {
    readonly modelId: string;
    readonly config: OperatingContextConfig;
    readonly modes: ReadonlyArray<OperatingMode>;
    readonly relations: ReadonlyArray<MemoryRelation>;
}
