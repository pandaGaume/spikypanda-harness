export type TopologyTemporalMode = "continuous" | "spikes" | "spikes-modulated";
export interface TopologyTemporalConfig {
    readonly version: 1;
    readonly mode: TopologyTemporalMode;
    readonly timeConstantSeconds: number;
    readonly threshold: number;
    readonly maximumGapSeconds: number;
    readonly resetAlpha: number;
}
export const DEFAULT_TOPOLOGY_TEMPORAL_CONFIG: TopologyTemporalConfig = Object.freeze({
    version: 1, mode: "continuous", timeConstantSeconds: 3, threshold: 1.5, maximumGapSeconds: 2, resetAlpha: 0,
});
export interface TopologyBranchDynamics {
    readonly branchId: string;
    readonly observedAtSeconds: number;
    readonly elapsedSeconds: number;
    readonly rawSupport: number;
    readonly corroboratedRate: number;
    readonly charge: number;
    readonly previousPotential: number;
    readonly potentialBeforeReset: number;
    readonly potential: number;
    readonly lastResetPotential: number | null;
    readonly active: boolean;
    readonly spiked: boolean;
    readonly spikes: number;
    readonly resetReason: "gap" | "contradiction" | null;
}
export interface TopologyTemporalPass {
    readonly kind: "branch-temporal-v1";
    readonly config: TopologyTemporalConfig;
    readonly branches: ReadonlyArray<TopologyBranchDynamics>;
    readonly integratorNodeFirings: number;
    readonly integratorDeliveries: number;
}
