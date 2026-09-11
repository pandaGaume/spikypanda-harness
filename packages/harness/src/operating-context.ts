import { advanceConsolidation, type ConsolidationProgress } from "./consolidation.js";
import { ContextualPolicyGraph, operatingModeId } from "./contextual-policy.js";
import { contextKey, stableStringify } from "./canonical.js";
import { immutableCopy } from "./validation.js";
import type { RecordExperienceInput } from "./policy-graph.js";
import type { Experience, Intention, JsonValue, State } from "./model.js";
import type { EffectSignatureProvider, OperatingBelief } from "./operating-types.js";

interface ScopeState {
    belief: OperatingBelief;
    pending: string[];
    pendingSignature?: string;
    consolidation?: ConsolidationProgress;
}
/** One tracker per observed world/runtime. It never receives a simulator's hidden mode. */
export class OperatingContextTracker {
    private scopes = new Map<string, ScopeState>();
    constructor(public readonly policy: ContextualPolicyGraph, private readonly provider: EffectSignatureProvider) {
        if (provider.id !== policy.modelId) throw new Error("Effect signature model does not match the memory");
    }
    public belief(state: State, intention: Intention): OperatingBelief {
        const scope = contextKey(state, intention);
        return immutableCopy(this.scopes.get(scope)?.belief ?? { scope, status: "unknown" });
    }
    public consolidation(state: State, intention: Intention): ConsolidationProgress | undefined {
        const progress = this.scopes.get(contextKey(state, intention))?.consolidation;
        return progress ? immutableCopy(progress) : undefined;
    }
    /** A host can mark a missing or non-attributable observation without inventing an experience. */
    public interrupt(state: State, intention: Intention, observedAt: number): void {
        const config = this.policy.contextConfig.consolidation;
        if (!config) return;
        const scope = contextKey(state, intention), entry = this.scopes.get(scope);
        if (!entry) return;
        const progress = advanceConsolidation(entry.consolidation, undefined, observedAt, config);
        this.flushTemporal(entry, "Consolidation interrupted by a non-attributable observation");
        entry.consolidation = progress;
        entry.belief = { ...entry.belief, status: "uncertain" };
    }
    public record(input: RecordExperienceInput, assumed?: OperatingBelief): { experience: Experience; after: OperatingBelief } {
        const scope = contextKey(input.stateBefore, input.intention);
        const entry: ScopeState = this.scopes.get(scope) ?? { belief: { scope, status: "unknown" as const }, pending: [] };
        // Provider only sees frozen observations and the completed command, never runtime or world services.
        const signature = immutableCopy(this.provider.describe(immutableCopy({
            context: { key: scope, state: input.stateBefore, intention: input.intention },
            decision: input.decision, result: input.result, stateAfter: input.stateAfter, evaluation: input.evaluation,
        })));
        const before = immutableCopy(assumed ?? entry.belief);
        if (before.scope !== scope || !["unknown", "recognized", "uncertain"].includes(before.status) ||
            (before.status === "recognized" && !before.modeId) || (before.status === "unknown" && before.modeId) ||
            (before.modeId && this.policy.mode(before.modeId)?.scope !== scope)) throw new Error("Invalid operating assumption");
        const signatureKey = signature === null ? undefined : stableStringify(signature);
        const observedAt = input.observedAt ?? Date.now(), config = this.policy.contextConfig.consolidation;
        const progress = config ? advanceConsolidation(entry.consolidation, signatureKey, observedAt, config) : undefined;
        const experience = this.policy.appendEvidence({ ...input, observedAt }, before, signature);
        this.scopes.set(scope, entry);
        const known = signature === null ? undefined : this.policy.mode(operatingModeId(scope, signature));
        if (progress) return this.recordTemporal(entry, experience, signature, before, progress, known?.id);
        if (known) {
            if (entry.pendingSignature === signatureKey) {
                for (const id of entry.pending) if (this.policy.evidence(id).attribution?.current.status === "pending") {
                    this.policy.attribute(id, "confirmed", known.id, "Shared knowledge confirmed the pending observed effect");
                }
                entry.pending = []; entry.pendingSignature = undefined;
            } else this.flush(entry, "Isolated contradiction, not enough evidence for another operating context");
            this.policy.attribute(experience.id, "confirmed", known.id, "Observed effect matches a learned operating context");
            entry.belief = { scope, status: "recognized", modeId: known.id };
        } else if (signatureKey !== undefined) {
            if (entry.pendingSignature !== signatureKey) this.flush(entry, "Inconsistent novel effects");
            entry.pendingSignature = signatureKey;
            entry.pending.push(experience.id);
            entry.belief = { scope, status: "uncertain", modeId: before.modeId };
            if (entry.pending.length >= this.policy.contextConfig.noveltyConfirmations) {
                const mode = this.policy.confirmMode(scope, signature!, experience.observedAt);
                if (mode) {
                    for (const id of entry.pending) this.policy.attribute(id, "confirmed", mode.id, "Repeated consistent effects confirmed a new context");
                    entry.pending = []; entry.pendingSignature = undefined;
                    this.policy.reconsiderUnresolved(mode);
                    entry.belief = { scope, status: "recognized", modeId: mode.id };
                } else this.flush(entry, "Context capacity reached; novelty cannot shelter an existing skill indefinitely");
            }
        } else {
            this.flush(entry, "Ambiguous evidence interrupted novelty confirmation");
            this.policy.attribute(experience.id, before.modeId ? "anomaly" : "unresolved", before.modeId,
                "Effect is ambiguous; retain a provisional attribution to the previous hypothesis when available");
            entry.belief = { scope, status: "uncertain", modeId: before.modeId };
        }
        return { experience: this.policy.evidence(experience.id), after: immutableCopy(entry.belief) };
    }
    private recordTemporal(entry: ScopeState, experience: Experience, signature: JsonValue | null,
        before: OperatingBelief, progress: ConsolidationProgress, knownId?: string): { experience: Experience; after: OperatingBelief } {
        const scope = before.scope;
        // A reset window cannot borrow duration or evidence from a previous visit.
        if (progress.observations <= 1 || entry.pendingSignature !== progress.signatureKey) {
            this.flushTemporal(entry, "Transient effect: persistence window interrupted or expired");
        }
        entry.consolidation = progress;
        if (knownId) {
            for (const id of entry.pending) if (this.policy.evidence(id).attribution?.current.status === "pending") {
                this.policy.attribute(id, "confirmed", knownId, "Current contiguous evidence matches an already consolidated context");
            }
            entry.pending = []; entry.pendingSignature = undefined;
            this.policy.attribute(experience.id, "confirmed", knownId, "Observed effect matches a consolidated context");
            entry.belief = { scope, status: "recognized", modeId: knownId };
        } else if (signature !== null) {
            entry.pendingSignature = progress.signatureKey;
            entry.pending.push(experience.id);
            entry.belief = { scope, status: "uncertain", modeId: before.modeId };
            if (progress.status === "stable") {
                const mode = this.policy.confirmMode(scope, signature, experience.observedAt, entry.pending);
                if (mode) {
                    for (const id of entry.pending) this.policy.attribute(id, "confirmed", mode.id,
                        "Coherent effects persisted across the required observation duration");
                    entry.pending = []; entry.pendingSignature = undefined;
                    // Do not relabel earlier transients just because their signature later becomes stable.
                    entry.belief = { scope, status: "recognized", modeId: mode.id };
                } else {
                    this.flushTemporal(entry, "Capacity reached: evidence retained without granting replay");
                    entry.consolidation = undefined;
                }
            }
        } else {
            // Missing attribution does not prove the old skill failed in its own operating context.
            this.policy.attribute(experience.id, "unresolved", undefined, "Ambiguous effect: no causal credit assigned");
            entry.belief = { scope, status: "uncertain", modeId: before.modeId };
        }
        return { experience: this.policy.evidence(experience.id), after: immutableCopy(entry.belief) };
    }
    private flushTemporal(entry: ScopeState, reason: string): void {
        for (const id of entry.pending) if (this.policy.evidence(id).attribution?.current.status === "pending") {
            this.policy.attribute(id, "transient", undefined, reason);
        }
        entry.pending = []; entry.pendingSignature = undefined;
    }
    private flush(entry: ScopeState, reason: string): void {
        for (const id of entry.pending) {
            const pending = this.policy.evidence(id), modeId = pending.attribution!.before.modeId;
            if (pending.attribution!.current.status !== "pending") continue;
            this.policy.attribute(id, modeId ? "anomaly" : "unresolved", modeId, reason);
        }
        entry.pending = []; entry.pendingSignature = undefined;
    }
}
