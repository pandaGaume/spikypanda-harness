import { AdaptiveCueObserver } from "./cue-observer.js";
import type { CueAssessment, CueObserver } from "./cue-types.js";
import type { DecisionContext, JsonValue } from "./model.js";
import { stableStringify } from "./canonical.js";
import { immutableCopy } from "./validation.js";
import { TemporalEvidenceNetwork, DEFAULT_TEMPORAL_EVIDENCE_CONFIG,
    type TemporalEvidenceConfig, type TemporalEvidenceResult, type TemporalPropagation, type ModulatedResetConfig } from "./temporal-evidence.js";

const json = (value: unknown) => stableStringify(value as JsonValue);
const encoder = "harness.temporal-cue-gate.v1";
export interface TemporalCueAssessment extends CueAssessment {
    readonly temporal: {
        readonly propagation: TemporalPropagation;
        readonly instantaneousStatus: CueAssessment["status"];
        readonly observedAtSeconds: number;
        readonly evidenceRate: number;
        readonly evidence: TemporalEvidenceResult | null;
        readonly reason: "learning" | "missing" | "novel" | "capacity" | "integrating" | "activated";
    };
}
/** Experimental readout around the unchanged adaptive metric.
 * Time comes from the host's public observation clock, never a scenario label.
 * Validation is read-only: a second lookup must not integrate a second time.
 */
export class TemporalCueObserver implements CueObserver {
    readonly network: TemporalEvidenceNetwork;
    private get last() {
        return this.network.sessionState.cueCache as { key: string; time: number; raw: CueAssessment; result: TemporalCueAssessment } | undefined;
    }
    constructor(readonly base: AdaptiveCueObserver, readonly propagation: TemporalPropagation,
        private readonly clockSeconds: () => number,
        config: TemporalEvidenceConfig = DEFAULT_TEMPORAL_EVIDENCE_CONFIG, resetModulation?: ModulatedResetConfig) {
        this.network = new TemporalEvidenceNetwork(propagation, config, resetModulation);
    }
    get policy() { return this.base.policy; }
    private key(context: DecisionContext) { return json([context.state, context.intention]); }
    assess(context: DecisionContext): TemporalCueAssessment {
        const time = this.clockSeconds(), key = this.key(context);
        if (!Number.isFinite(time) || time < 0 || (this.last && time < this.last.time)) throw new Error("Invalid temporal observation clock");
        const raw = this.base.assess(context);
        if (this.last?.time === time) {
            if (this.last.key === key && json(raw) === json(this.last.raw)) return this.last.result;
            throw new Error("Conflicting temporal observation at the same timestamp");
        }
        const candidates = raw.candidates, best = candidates[0], next = candidates[1];
        let evidence: TemporalEvidenceResult | null = null, rate = 0;
        let reason: TemporalCueAssessment["temporal"]["reason"];
        let status = raw.status, modeId: string | undefined;
        if (["learning", "missing", "novel"].includes(raw.status)) {
            this.network.forget(raw.scope);
            reason = raw.status as "learning" | "missing" | "novel";
        } else if (!next || candidates.length > this.network.config.maximumModes) {
            this.network.forget(raw.scope); reason = "capacity"; status = "ambiguous";
        } else {
            // Level-based evidence, not a derivative: a stable blocked regime still carries evidence.
            const gap = Math.max(0, next.distance - best.distance);
            rate = Math.max(0, 1 - best.distance / this.base.config.maximumDistance) *
                Math.min(1, gap / this.base.config.minimumMargin);
            const winner = rate > 0 ? best.modeId : null;
            evidence = this.network.advance(raw.scope, candidates.map(c => c.modeId), winner, rate, time);
            modeId = evidence.modeId ?? undefined;
            status = modeId ? "recognized" : "ambiguous";
            reason = modeId ? "activated" : "integrating";
        }
        const result = immutableCopy({ ...raw, encoder, status, modeId,
            temporal: { propagation: this.propagation, instantaneousStatus: raw.status,
                observedAtSeconds: time, evidenceRate: rate, evidence, reason } });
        this.network.sessionState.cueCache = { key, time, raw, result };
        return result;
    }
    validateAssessment(context: DecisionContext, assessment: CueAssessment): void {
        if (!this.last || this.last.key !== this.key(context) || this.clockSeconds() !== this.last.time ||
            json(assessment) !== json(this.last.result)) throw new Error("Stale or foreign temporal assessment");
        this.base.validateAssessment(context, this.last.raw);
    }
    /** Explicit experimental envelope. Not a V3 import file; active membranes are never durable memory. */
    snapshot() {
        return immutableCopy({ kind: "harness.temporal-cue-experiment", version: 1, policy: this.policy.snapshot(),
            observer: { encoder, propagation: this.propagation, schema: this.base.schema,
                metricConfig: this.base.config, temporalConfig: this.network.config,
                ...(this.network.resetModulation ? { resetModulation: this.network.resetModulation } : {}) },
            persistence: "diagnostic-only; no temporal observer restore contract" });
    }
    inspect() { return this.network.inspect(); }
}
