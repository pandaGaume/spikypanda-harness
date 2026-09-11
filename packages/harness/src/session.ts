import type { CueObserver, CueRunMode } from "./cue-types.js";
import type { OperatingContextTracker } from "./operating-context.js";
import { Session, isLinkRef, type IRuntimeGraph, type IRuntimeNode } from "@spiky-panda/core";
import type { DecisionTrace, Intention, OutcomeEvaluator, PolicyFallback, StateObserver } from "./model.js";
import type { HarnessRun, NodeObserver, StageEvent } from "./contracts.js";
import type { PolicyGraph } from "./policy-graph.js";
import type { PolicyMetrics } from "./metrics.js";
import type { CapabilityRegistry } from "./capability.js";
import type { SafetyGuard } from "./model.js";
import { ExecutionAuthority } from "./authorization.js";
import { abortable, checkAbort, immutableCopy } from "./validation.js";

export interface HarnessServices {
    readonly operatingContexts?: OperatingContextTracker;
    readonly cueObserver?: CueObserver;
    readonly cueMode?: CueRunMode;
    readonly policy: PolicyGraph;
    readonly fallback: PolicyFallback;
    readonly observer: StateObserver;
    readonly evaluator: OutcomeEvaluator;
    readonly metrics: PolicyMetrics;
}
export interface HarnessSessionOptions extends HarnessRun {
    readonly intention: Intention;
    readonly services: HarnessServices;
    readonly capabilities: CapabilityRegistry;
    readonly guard: SafetyGuard;
    readonly clock: () => number;
    readonly onStage?: (event: StageEvent) => void;
    readonly onNode?: NodeObserver;
}

/** Session-local services, packets and receipts. No decision state lives on nodes. */
export class HarnessSession extends Session {
    public readonly authority: ExecutionAuthority;
    readonly #packets = new WeakMap<object, { type: string; value: unknown }>();
    readonly #visited = new Set<IRuntimeNode>();
    #closed = false;
    #executing = false;
    #trace?: DecisionTrace;

    public constructor(graph: IRuntimeGraph, private readonly options: HarnessSessionOptions) {
        super(graph);
        this.authority = new ExecutionAuthority({ decisionId: this.frame.decisionId, intention: this.intention,
            signal: this.signal, capabilities: options.capabilities, guard: options.guard, observer: this.services.observer,
            assertActive: () => this.assertActive() });
    }

    public get frame() { return this.options.frame; }
    public get intention() { return this.options.intention; }
    public get signal() { return this.options.signal; }
    public get startedAt() { return this.options.startedAt; }
    public get services() { return this.options.services; }
    public get trace() { return this.#trace; }
    public now(): number { return this.options.clock(); }
    public hasVisited(node: IRuntimeNode): boolean { return this.#visited.has(node); }

    public assertActive(): void {
        checkAbort(this.signal);
        if (this.#closed) throw new Error("Decision session closed");
    }

    public packet(type: string, value: unknown): object {
        this.assertActive();
        const packet = Object.freeze({ decisionId: this.frame.decisionId });
        this.#packets.set(packet, { type, value: immutableCopy(value) });
        return packet;
    }

    public take<T>(packet: unknown, type: string): T {
        this.assertActive();
        const data = typeof packet === "object" && packet !== null ? this.#packets.get(packet) : undefined;
        if (!data || data.type !== type) throw new Error("Missing, duplicated, mistyped or foreign decision packet");
        this.#packets.delete(packet as object);
        return data.value as T;
    }

    /** Generic lifecycle wrapper. The supplied node operation owns all business logic. */
    public async invoke(node: IRuntimeNode & { readonly stage: string }, operation: () => Promise<void>): Promise<void> {
        this.assertActive();
        if (!this.graph.nodes.includes(node) || this.#visited.has(node) || this.#executing) throw new Error("Foreign, duplicated or reentrant node execution");
        this.#visited.add(node);
        this.#executing = true;
        this.emit(node.stage, "start");
        try {
            await abortable(operation, this.signal);
            this.assertActive();
            this.emit(node.stage, "complete");
            try { this.options.onNode?.(String(node.id), node.stage); } catch { /* Diagnostics cannot affect execution. */ }
        } catch (error) {
            this.emit(node.stage, "error", String(error));
            throw error;
        } finally { this.#executing = false; }
    }

    public assertCanComplete(): void {
        this.assertActive();
        if (this.#trace) throw new Error("Decision already recorded");
    }

    public complete(trace: DecisionTrace): void {
        this.assertCanComplete();
        if (trace.decisionId !== this.frame.decisionId) throw new Error("Foreign decision trace");
        this.#trace = immutableCopy(trace);
    }

    public close(): void { this.#closed = true; this.authority.close(); }

    private emit(stage: string, status: StageEvent["status"], message?: string): void {
        try { this.options.onStage?.({ decisionId: this.frame.decisionId, stage, status, message }); } catch { /* Diagnostics are best effort. */ }
    }

    /** Compatibility with the current core async topological pass: drain its delivery queue. */
    public override publish(index: number, value: unknown): void {
        this.assertActive();
        super.publish(index, value);
        for (const item of this.queue.splice(0)) {
            if (!isLinkRef(item)) throw new Error("Unexpected async scheduler event");
            this.deliverLinkRef(item);
        }
    }
}
