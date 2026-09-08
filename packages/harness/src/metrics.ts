import type { DecisionSource, OutcomeEvaluation } from "./model.js";

export interface MetricsSnapshot {
    readonly decisions: number;
    readonly fallbackCalls: number;
    readonly policyHits: number;
    readonly policyMisses: number;
    readonly executedActions: number;
    readonly successCount: number;
    readonly totalReward: number;
    readonly fallbackRatio: number;
    readonly policyHitRatio: number;
    readonly successRate: number;
    readonly averageReward: number;
}

export class PolicyMetrics {
    private decisions = 0;
    private fallbackCalls = 0;
    private policyHits = 0;
    private policyMisses = 0;
    private executedActions = 0;
    private successCount = 0;
    private totalReward = 0;

    public recordDecision(source: DecisionSource): void {
        this.decisions += 1;
        if (source === "policy") this.policyHits += 1;
        else {
            this.policyMisses += 1;
            this.fallbackCalls += 1;
        }
    }

    public recordOutcome(evaluation: OutcomeEvaluation, executed: boolean): void {
        if (executed) this.executedActions += 1;
        if (evaluation.success) this.successCount += 1;
        this.totalReward += evaluation.reward;
    }

    public snapshot(): MetricsSnapshot {
        return {
            decisions: this.decisions,
            fallbackCalls: this.fallbackCalls,
            policyHits: this.policyHits,
            policyMisses: this.policyMisses,
            executedActions: this.executedActions,
            successCount: this.successCount,
            totalReward: this.totalReward,
            fallbackRatio: this.decisions === 0 ? 0 : this.fallbackCalls / this.decisions,
            policyHitRatio: this.decisions === 0 ? 0 : this.policyHits / this.decisions,
            successRate: this.decisions === 0 ? 0 : this.successCount / this.decisions,
            averageReward: this.decisions === 0 ? 0 : this.totalReward / this.decisions,
        };
    }
}

