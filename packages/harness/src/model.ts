import type { CueDecision } from "./cue-types.js";
import type { OperatingAttribution, OperatingBelief } from "./operating-types.js";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface State {
    readonly id: string;
    readonly features: Readonly<Record<string, JsonValue>>;
    readonly embedding?: ReadonlyArray<number>;
}

export interface Intention {
    readonly id: string;
    readonly description?: string;
    readonly parameters?: Readonly<Record<string, JsonValue>>;
}

export interface DecisionContext {
    readonly cues?: CueDecision;
    readonly operatingContextId?: string;
    readonly key: string;
    readonly state: State;
    readonly intention: Intention;
}

export interface ActionDefinition {
    readonly id: string;
    readonly description: string;
}

export interface ActionInvocation {
    readonly actionId: string;
    readonly capabilityId: string;
    readonly input: JsonValue;
}

export type ReplayPolicy = "automatic" | "approval-required" | "never";

export interface CapabilityDescriptor {
    readonly id: string;
    readonly description: string;
    readonly inputSchema?: JsonValue;
    readonly replayPolicy?: ReplayPolicy;
}

export interface ExecutionContext {
    readonly decisionId: string;
    readonly state: State;
    readonly intention: Intention;
    readonly signal?: AbortSignal;
    readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface CapabilityResult {
    readonly ok: boolean;
    readonly output?: JsonValue;
    readonly error?: string;
}

export interface ExpectedOutcome {
    readonly description: string;
    readonly observableConditions?: Readonly<Record<string, JsonValue>>;
}

export interface PolicyDecision {
    readonly action: ActionDefinition;
    readonly invocation: ActionInvocation;
    readonly expectedOutcome?: ExpectedOutcome;
    readonly rationale?: string;
}

export type DecisionSource = "policy" | "fallback";

export interface ResolvedDecision extends PolicyDecision {
    readonly source: DecisionSource;
}

export interface OutcomeEvaluation {
    readonly success: boolean;
    readonly reward: number;
    readonly reason?: string;
}

export interface Experience {
    readonly cues?: CueDecision;
    readonly attribution?: OperatingAttribution;
    readonly id: string;
    readonly decisionId?: string;
    readonly context: DecisionContext;
    readonly decision: ResolvedDecision;
    readonly stateAfter: State;
    readonly result: CapabilityResult;
    readonly evaluation: OutcomeEvaluation;
    readonly observedAt: number;
}

export interface TransitionStats {
    readonly totalUsageCount: number;
    readonly totalSuccessCount: number;
    readonly totalFailureCount: number;
    readonly rewardEma: number;
    readonly confidence: number;
    readonly effectiveEvidence: number;
    readonly consecutiveFailures: number;
    readonly directEligible: boolean;
    readonly lastUsedAt?: number;
}

export interface PolicyCandidate {
    readonly transitionKey: string;
    readonly context: DecisionContext;
    readonly action: ActionDefinition;
    readonly invocation: ActionInvocation;
    readonly expectedOutcome?: ExpectedOutcome;
    readonly score: number;
    readonly confidence: number;
    readonly similarity: number;
    readonly eligible: boolean;
    readonly stats: TransitionStats;
}

export interface PolicyFallbackInput {
    readonly decisionId?: string;
    readonly signal?: AbortSignal;
    readonly state: State;
    readonly intention: Intention;
    readonly allowedCapabilities: ReadonlyArray<CapabilityDescriptor>;
    readonly candidates: ReadonlyArray<PolicyCandidate>;
    readonly recentFailures: ReadonlyArray<Experience>;
}

export interface PolicyFallback {
    resolve(input: PolicyFallbackInput): Promise<PolicyDecision>;
}

export interface StateMatcher {
    similarity(a: State, b: State): number;
}

export interface SafetyDecision {
    readonly allowed: boolean;
    readonly reason?: string;
}

export interface SafetyGuard {
    validate(decision: PolicyDecision, context: DecisionContext): Promise<SafetyDecision>;
}

export interface StateObserver {
    observe(): Promise<State>;
}

export interface OutcomeEvaluationInput {
    readonly context: DecisionContext;
    readonly decision: ResolvedDecision;
    readonly stateAfter: State;
    readonly result: CapabilityResult;
}

export interface OutcomeEvaluator {
    evaluate(input: OutcomeEvaluationInput): Promise<OutcomeEvaluation> | OutcomeEvaluation;
}

export interface DecisionTrace {
    readonly cues?: CueDecision;
    readonly decisionId: string;
    readonly source: DecisionSource;
    readonly stateBefore: State;
    readonly intention: Intention;
    readonly decision: PolicyDecision;
    readonly candidateScore?: number;
    readonly candidateConfidence?: number;
    readonly result: CapabilityResult;
    readonly stateAfter: State;
    readonly evaluation: OutcomeEvaluation;
    readonly transitionAfter?: TransitionStats;
    readonly operatingBefore?: OperatingBelief;
    readonly operatingAfter?: OperatingBelief;
    readonly attribution?: OperatingAttribution;
    readonly startedAt: number;
    readonly completedAt: number;
}

