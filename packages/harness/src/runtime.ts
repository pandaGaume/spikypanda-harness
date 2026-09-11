import type { CueObserver, CueRunMode } from "./cue-types.js";
import type { OperatingContextTracker } from "./operating-context.js";
import type { IRuntimeGraph } from "@spiky-panda/core";
import { AllowAllSafetyGuard, CapabilityRegistry } from "./capability.js";
import { PolicyMetrics } from "./metrics.js";
import type { DecisionTrace, Intention, OutcomeEvaluator, PolicyFallback, SafetyGuard, StateObserver } from "./model.js";
import { PolicyGraph } from "./policy-graph.js";
import { abortable, checkAbort, immutableCopy, validateIntention } from "./validation.js";
import { HarnessSession } from "./session.js";
import type { DecisionFrame, HarnessDriver, HarnessGraphExecutor, HarnessRun, NodeObserver, StageEvent } from "./contracts.js";
export type { DecisionFrame, HarnessDriver, HarnessStage, StageEvent } from "./contracts.js";

export interface AdaptivePolicyRuntimeOptions {
    readonly operatingContexts?: OperatingContextTracker;
    readonly cueObserver?: CueObserver;
    readonly cueMode?: CueRunMode;
    /** Explicit host graph driver. May instead be supplied to each step. */
    readonly driver?: HarnessDriver;
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

interface ActiveRun extends HarnessRun { readonly intention: Intention; session?: HarnessSession; }

/** Owns decision lifetime, not node behavior or a second description of the pipeline. */
export class AdaptivePolicyRuntime implements HarnessGraphExecutor {
    public readonly metrics: PolicyMetrics;
    private readonly safetyGuard: SafetyGuard;
    private readonly clock: () => number;
    private readonly idFactory: () => string;
    private readonly runs = new WeakMap<DecisionFrame, ActiveRun>();
    private readonly issuedIds = new Set<string>();
    private busy = false;

    public constructor(private readonly options: AdaptivePolicyRuntimeOptions) {
        this.metrics = options.metrics ?? new PolicyMetrics();
        this.safetyGuard = options.safetyGuard ?? new AllowAllSafetyGuard();
        this.clock = options.clock ?? (() => Date.now());
        this.idFactory = options.idFactory ?? (() => `decision-${globalThis.crypto.randomUUID()}`);
        if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("Invalid timeout");
    }

    public async step(intention: Intention, signal?: AbortSignal, driver: HarnessDriver | undefined = this.options.driver): Promise<DecisionTrace> {
        checkAbort(signal);
        if (!driver) throw new Error("No harness graph configured: provide a driver in runtime options or step()");
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
        const run: ActiveRun = { frame, intention: savedIntention, signal: controller.signal, startedAt: this.clock() };
        this.runs.set(frame, run);
        try {
            await abortable(() => driver(this, frame), run.signal);
            checkAbort(run.signal);
            if (!run.session?.trace) throw new Error("Incomplete harness: no experience reached the recorder");
            return run.session.trace;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            run.session?.close();
            controller.abort(new Error("Decision session closed"));
            this.runs.delete(frame);
            this.busy = false;
        }
    }

    public async executeGraph(graph: IRuntimeGraph, frame: DecisionFrame, onNode?: NodeObserver): Promise<void> {
        const run = this.runs.get(frame);
        if (!run) throw new Error("Unknown or closed decision session");
        checkAbort(run.signal);
        if (run.session) throw new Error("Decision graph already started");
        const session = new HarnessSession(graph, { ...run, clock: this.clock, onStage: this.options.onStage, onNode,
            services: { cueObserver: this.options.cueObserver, cueMode: this.options.cueMode, operatingContexts: this.options.operatingContexts, policy: this.options.policy, observer: this.options.observer, fallback: this.options.fallback,
                evaluator: this.options.evaluator, metrics: this.metrics },
            capabilities: this.options.capabilities, guard: this.safetyGuard });
        run.session = session;
        try { await graph.runAsync(0, session); }
        finally { session.close(); }
    }
}
