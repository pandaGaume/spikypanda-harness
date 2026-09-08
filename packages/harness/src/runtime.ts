import { createDecisionContext, stableStringify } from "./canonical.js";
import { AllowAllSafetyGuard, CapabilityRegistry } from "./capability.js";
import { PolicyMetrics } from "./metrics.js";
import type { CapabilityResult, DecisionContext, DecisionTrace, ExecutionContext, Intention, JsonValue, OutcomeEvaluation,
    OutcomeEvaluator, PolicyCandidate, PolicyFallback, PolicyFallbackInput, ResolvedDecision, SafetyGuard, State, StateObserver } from "./model.js";
import { PolicyGraph } from "./policy-graph.js";
import { abortable, checkAbort, immutableCopy, validateDecision, validateState, validateIntention, validateEvaluation } from "./validation.js";

export type HarnessStage = "observe" | "context" | "lookup" | "gate" | "request" | "reason" | "merge" | "guard" | "execute" | "observe-after" | "evaluate" | "record";
export interface StageEvent { readonly decisionId: string; readonly stage: HarnessStage; readonly status: "start" | "complete" | "error"; readonly message?: string; }

/** Opaque per-run handle. Data and authorization stay inside the runtime, never in graph JSON. */
export interface DecisionFrame { readonly decisionId: string; }
export type HarnessDriver = (runtime: AdaptivePolicyRuntime, frame: DecisionFrame) => Promise<void>;

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
    readonly timeoutMs?: number;
    readonly onStage?: (event: StageEvent) => void;
}

interface RunState {
    intention: Intention; signal: AbortSignal; startedAt: number; phase: "start" | HarnessStage;
    executingStage: boolean; stateBefore?: State; context?: DecisionContext; candidates?: PolicyCandidate[];
    selected?: PolicyCandidate; request?: PolicyFallbackInput; decision?: ResolvedDecision;
    result?: CapabilityResult; stateAfter?: State; evaluation?: OutcomeEvaluation; trace?: DecisionTrace;
}

const predecessors: Record<HarnessStage, ReadonlyArray<string>> = {
    observe: ["start"], context: ["observe"], lookup: ["context"], gate: ["lookup"], request: ["gate"],
    reason: ["request"], merge: ["gate", "reason"], guard: ["merge"], execute: ["guard"],
    "observe-after": ["execute"], evaluate: ["observe-after"], record: ["evaluate"],
};

export class AdaptivePolicyRuntime {
    public readonly metrics: PolicyMetrics;
    private readonly safetyGuard: SafetyGuard;
    private readonly clock: () => number;
    private readonly idFactory: () => string;
    private readonly runs = new WeakMap<DecisionFrame, RunState>();
    private readonly issuedIds = new Set<string>();
    private busy = false;

    public constructor(private readonly options: AdaptivePolicyRuntimeOptions) {
        this.metrics = options.metrics ?? new PolicyMetrics();
        this.safetyGuard = options.safetyGuard ?? new AllowAllSafetyGuard();
        this.clock = options.clock ?? (() => Date.now());
        this.idFactory = options.idFactory ?? (() => `decision-${globalThis.crypto.randomUUID()}`);
        if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("Invalid timeout");
    }

    public async step(intention: Intention, signal?: AbortSignal, driver: HarnessDriver = headlessDriver): Promise<DecisionTrace> {
        checkAbort(signal);
        if (this.busy) throw new Error("A decision is already running");
        const savedIntention = immutableCopy(intention);
        validateIntention(savedIntention);
        const decisionId = this.idFactory();
        if (!decisionId || this.issuedIds.has(decisionId)) throw new Error("Invalid or duplicate decision ID");
        this.issuedIds.add(decisionId);
        const frame: DecisionFrame = Object.freeze({ decisionId });
        this.busy = true;
        const controller = new AbortController();
        const cancel = () => controller.abort(signal?.reason ?? new Error("Execution cancelled"));
        signal?.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(() => controller.abort(new Error("Decision timeout")), this.options.timeoutMs ?? 10000);
        const run: RunState = { intention: savedIntention, signal: controller.signal, startedAt: this.clock(), phase: "start", executingStage: false };
        this.runs.set(frame, run);
        try {
            await abortable(() => driver(this, frame), run.signal);
            checkAbort(run.signal);
            if (!run.trace) throw new Error("Incomplete harness: no experience reached the recorder");
            return run.trace;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            controller.abort(new Error("Decision session closed"));
            this.runs.delete(frame);
            this.busy = false;
        }
    }

    public selectedSource(frame: DecisionFrame): "policy" | "fallback" {
        return this.runOf(frame).decision?.source ?? "fallback";
    }

    /** Shared by RuntimeNodes and the headless driver. Illegal wiring cannot skip authorization. */
    public async runStage(stage: HarnessStage, frame: DecisionFrame): Promise<void> {
        const run = this.runOf(frame);
        checkAbort(run.signal);
        if (run.executingStage || !predecessors[stage].includes(run.phase)) throw new Error(`Invalid stage order: ${run.phase} -> ${stage}`);
        if (stage === "request" && run.decision) throw new Error("A selected policy must not also request reasoning");
        if (stage === "merge" && !run.decision) throw new Error("Missing decision at branch merge");
        run.executingStage = true;
        this.emit({ decisionId: frame.decisionId, stage, status: "start" });
        try {
            await abortable(() => this.perform(stage, frame, run), run.signal);
            checkAbort(run.signal);
            run.phase = stage;
            this.emit({ decisionId: frame.decisionId, stage, status: "complete" });
        } catch (error) {
            this.emit({ decisionId: frame.decisionId, stage, status: "error", message: String(error) });
            throw error;
        } finally { run.executingStage = false; }
    }

    private runOf(frame: DecisionFrame): RunState {
        const run = this.runs.get(frame);
        if (!run) throw new Error("Unknown or closed decision session");
        return run;
    }

    private emit(event: StageEvent): void {
        // Observability callbacks cannot change execution or turn an executed action into a retry.
        try { this.options.onStage?.(event); } catch { /* Host diagnostics are best effort. */ }
    }

    private executionContext(frame: DecisionFrame, run: RunState): ExecutionContext {
        return Object.freeze({ decisionId: frame.decisionId, state: run.stateBefore!, intention: run.intention, signal: run.signal });
    }

    private async perform(stage: HarnessStage, frame: DecisionFrame, run: RunState): Promise<void> {
        const { policy, capabilities, observer, fallback, evaluator } = this.options;
        switch (stage) {
            case "observe": run.stateBefore = immutableCopy(await observer.observe()); validateState(run.stateBefore); break;
            case "context": run.context = immutableCopy(createDecisionContext(run.stateBefore!, run.intention)); break;
            case "lookup": run.candidates = immutableCopy(policy.findCandidateActions(run.stateBefore!, run.intention)); break;
            case "gate": {
                const available = await capabilities.listAvailable(this.executionContext(frame, run));
                run.selected = run.candidates!.find(c => c.eligible && available.some(a => a.id === c.invocation.capabilityId));
                if (run.selected) run.decision = immutableCopy({ source: "policy", action: run.selected.action,
                    invocation: run.selected.invocation, expectedOutcome: run.selected.expectedOutcome });
                break;
            }
            case "request": {
                const data = immutableCopy({ decisionId: frame.decisionId, state: run.stateBefore!, intention: run.intention,
                    allowedCapabilities: await capabilities.listAvailable(this.executionContext(frame, run)),
                    candidates: run.candidates!, recentFailures: policy.getRecentFailures(run.stateBefore!, run.intention) });
                run.request = Object.freeze({ ...data, signal: run.signal });
                break;
            }
            case "reason": {
                const proposed = await fallback.resolve(run.request!);
                checkAbort(run.signal);
                validateDecision(proposed);
                if (!run.request!.allowedCapabilities.some(c => c.id === proposed.invocation.capabilityId)) throw new Error("Provider proposed a capability outside the allowlist");
                run.decision = immutableCopy({ ...proposed, source: "fallback" });
                break;
            }
            case "merge": this.metrics.recordDecision(run.decision!.source); break;
            case "guard": {
                capabilities.validate(run.decision!);
                const authorization = await this.safetyGuard.validate(run.decision!, run.context!);
                if (authorization.allowed !== true) throw new Error(authorization.reason ?? "Decision rejected by safety guard");
                break;
            }
            case "execute": {
                run.result = await capabilities.execute(run.decision!, this.executionContext(frame, run), async () => {
                    const current = immutableCopy(await observer.observe());
                    validateState(current);
                    checkAbort(run.signal);
                    if (stableStringify(current as unknown as JsonValue) !== stableStringify(run.stateBefore! as unknown as JsonValue)) {
                        throw new Error("Stale decision: observed world changed before execution");
                    }
                });
                break;
            }
            case "observe-after": run.stateAfter = immutableCopy(await observer.observe()); validateState(run.stateAfter); break;
            case "evaluate": {
                run.evaluation = immutableCopy(await evaluator.evaluate({ context: run.context!, decision: run.decision!, stateAfter: run.stateAfter!, result: run.result! }));
                validateEvaluation(run.evaluation);
                break;
            }
            case "record": {
                checkAbort(run.signal);
                policy.recordExperience({ decisionId: frame.decisionId, experienceId: `experience:${frame.decisionId}`,
                    stateBefore: run.stateBefore!, intention: run.intention, decision: run.decision!, stateAfter: run.stateAfter!,
                    result: run.result!, evaluation: run.evaluation!, observedAt: this.clock() });
                this.metrics.recordOutcome(run.evaluation!, true);
                run.trace = immutableCopy({ decisionId: frame.decisionId, source: run.decision!.source, stateBefore: run.stateBefore!,
                    intention: run.intention, decision: run.decision!, candidateScore: run.selected?.score, candidateConfidence: run.selected?.confidence,
                    result: run.result!, stateAfter: run.stateAfter!, evaluation: run.evaluation!,
                    transitionAfter: policy.getTransitionStats(run.stateBefore!, run.intention, run.decision!.invocation)!,
                    startedAt: run.startedAt, completedAt: this.clock() });
                break;
            }
        }
    }
}

export const headlessDriver: HarnessDriver = async (runtime, frame) => {
    for (const stage of ["observe", "context", "lookup", "gate"] as const) await runtime.runStage(stage, frame);
    if (runtime.selectedSource(frame) === "fallback") {
        await runtime.runStage("request", frame);
        await runtime.runStage("reason", frame);
    }
    for (const stage of ["merge", "guard", "execute", "observe-after", "evaluate", "record"] as const) await runtime.runStage(stage, frame);
};
