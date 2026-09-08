import { createDecisionContext } from "./canonical.js";
import { AllowAllSafetyGuard, CapabilityRegistry } from "./capability.js";
import { PolicyMetrics } from "./metrics.js";
import type {
    CapabilityResult,
    DecisionTrace,
    Intention,
    OutcomeEvaluation,
    OutcomeEvaluator,
    PolicyDecision,
    PolicyFallback,
    ResolvedDecision,
    SafetyGuard,
    StateObserver,
} from "./model.js";
import { PolicyGraph } from "./policy-graph.js";

export interface AdaptivePolicyRuntimeOptions {
    readonly policy: PolicyGraph;
    readonly fallback: PolicyFallback;
    readonly capabilities: CapabilityRegistry;
    readonly observer: StateObserver;
    readonly evaluator: OutcomeEvaluator;
    readonly safetyGuard?: SafetyGuard;
    readonly metrics?: PolicyMetrics;
    readonly clock?: () => number;
    readonly idFactory?: () => string;
}

export class AdaptivePolicyRuntime {
    public readonly metrics: PolicyMetrics;
    private readonly safetyGuard: SafetyGuard;
    private readonly clock: () => number;
    private readonly idFactory: () => string;
    private sequence = 0;

    public constructor(private readonly options: AdaptivePolicyRuntimeOptions) {
        this.metrics = options.metrics ?? new PolicyMetrics();
        this.safetyGuard = options.safetyGuard ?? new AllowAllSafetyGuard();
        this.clock = options.clock ?? (() => Date.now());
        this.idFactory = options.idFactory ?? (() => `decision-${this.clock()}-${++this.sequence}`);
    }

    public async step(intention: Intention, signal?: AbortSignal): Promise<DecisionTrace> {
        const startedAt = this.clock();
        const decisionId = this.idFactory();
        const stateBefore = await this.options.observer.observe();
        const context = createDecisionContext(stateBefore, intention);
        const executionContext = { decisionId, state: stateBefore, intention, signal };
        const candidates = this.options.policy.findCandidateActions(stateBefore, intention);

        let selected = candidates.find(
            (candidate) => candidate.eligible && this.options.capabilities.get(candidate.invocation.capabilityId) !== undefined
        );
        if (selected) {
            const capability = this.options.capabilities.get(selected.invocation.capabilityId)!;
            if (capability.isAvailable && !(await capability.isAvailable(executionContext))) selected = undefined;
        }

        let decision: ResolvedDecision;
        if (selected) {
            decision = {
                source: "policy",
                action: selected.action,
                invocation: selected.invocation,
                expectedOutcome: selected.expectedOutcome,
            };
        } else {
            const proposed = await this.options.fallback.resolve({
                state: stateBefore,
                intention,
                allowedCapabilities: await this.options.capabilities.listAvailable(executionContext),
                candidates,
                recentFailures: this.options.policy.getRecentFailures(stateBefore, intention),
            });
            decision = { ...proposed, source: "fallback" };
        }
        this.metrics.recordDecision(decision.source);

        const authorization = await this.safetyGuard.validate(decision, context);
        let result: CapabilityResult;
        let executed = false;
        if (!authorization.allowed) {
            result = { ok: false, error: authorization.reason ?? "Decision rejected by safety guard" };
        } else {
            result = await this.options.capabilities.execute(decision, executionContext);
            executed = true;
        }

        const stateAfter = await this.options.observer.observe();
        let evaluation: OutcomeEvaluation;
        if (!authorization.allowed) {
            evaluation = { success: false, reward: -1, reason: result.error };
        } else {
            evaluation = await this.options.evaluator.evaluate({ context, decision, stateAfter, result });
        }
        this.metrics.recordOutcome(evaluation, executed);

        this.options.policy.recordExperience({
            stateBefore,
            intention,
            decision,
            stateAfter,
            result,
            evaluation,
            observedAt: this.clock(),
        });
        const transitionAfter = this.options.policy.getTransitionStats(stateBefore, intention, decision.invocation);
        if (!transitionAfter) throw new Error("Experience was recorded without transition statistics");

        return {
            decisionId,
            source: decision.source,
            stateBefore,
            intention,
            decision,
            candidateScore: selected?.score,
            candidateConfidence: selected?.confidence,
            result,
            stateAfter,
            evaluation,
            transitionAfter,
            startedAt,
            completedAt: this.clock(),
        };
    }
}

