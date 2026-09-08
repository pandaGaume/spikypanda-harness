import type { OutcomeEvaluation, TransitionStats } from "./model.js";

export interface PlasticityConfig {
    readonly rewardAlpha: number;
    readonly confidenceAlpha: number;
    readonly initialConfidence: number;
    readonly minimumEvidence: number;
    readonly maximumEffectiveEvidence: number;
    readonly promotionConfidence: number;
    readonly demotionConfidence: number;
    readonly promotionReward: number;
    readonly demotionReward: number;
    readonly maximumConsecutiveFailures: number;
    readonly scoreThreshold: number;
}

export const DEFAULT_PLASTICITY_CONFIG: PlasticityConfig = Object.freeze({
    rewardAlpha: 0.25,
    confidenceAlpha: 0.25,
    initialConfidence: 0.5,
    minimumEvidence: 3,
    maximumEffectiveEvidence: 8,
    promotionConfidence: 0.75,
    demotionConfidence: 0.55,
    promotionReward: 0.35,
    demotionReward: 0,
    maximumConsecutiveFailures: 3,
    scoreThreshold: 0.55,
});

export function initialTransitionStats(config: PlasticityConfig = DEFAULT_PLASTICITY_CONFIG): TransitionStats {
    return {
        totalUsageCount: 0,
        totalSuccessCount: 0,
        totalFailureCount: 0,
        rewardEma: 0,
        confidence: config.initialConfidence,
        effectiveEvidence: 0,
        consecutiveFailures: 0,
        directEligible: false,
    };
}

export function updateTransitionStats(
    previous: TransitionStats,
    observation: OutcomeEvaluation,
    observedAt: number,
    config: PlasticityConfig = DEFAULT_PLASTICITY_CONFIG
): TransitionStats {
    const reward = Math.max(-1, Math.min(1, observation.reward));
    const successSignal = observation.success ? 1 : 0;
    const rewardEma = previous.rewardEma * (1 - config.rewardAlpha) + reward * config.rewardAlpha;
    const confidence = previous.confidence * (1 - config.confidenceAlpha) + successSignal * config.confidenceAlpha;
    const effectiveEvidence = Math.min(config.maximumEffectiveEvidence, previous.effectiveEvidence + 1);
    const consecutiveFailures = observation.success ? 0 : previous.consecutiveFailures + 1;

    const canPromote =
        effectiveEvidence >= config.minimumEvidence &&
        confidence >= config.promotionConfidence &&
        rewardEma >= config.promotionReward;

    const canRetain =
        confidence >= config.demotionConfidence &&
        rewardEma >= config.demotionReward &&
        consecutiveFailures < config.maximumConsecutiveFailures;

    return {
        totalUsageCount: previous.totalUsageCount + 1,
        totalSuccessCount: previous.totalSuccessCount + (observation.success ? 1 : 0),
        totalFailureCount: previous.totalFailureCount + (observation.success ? 0 : 1),
        rewardEma,
        confidence,
        effectiveEvidence,
        consecutiveFailures,
        directEligible: previous.directEligible ? canRetain : canPromote,
        lastUsedAt: observedAt,
    };
}

export function scoreTransition(stats: TransitionStats, similarity: number): number {
    const rewardQuality = (Math.max(-1, Math.min(1, stats.rewardEma)) + 1) / 2;
    return rewardQuality * stats.confidence * Math.max(0, Math.min(1, similarity));
}

