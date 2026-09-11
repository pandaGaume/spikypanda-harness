/** Consolidation is independent of cue recognition and spike propagation.
 * Only observed command/effect evidence and the host's observation clock enter here.
 */
export interface ConsolidationConfig {
    readonly minimumObservations: number;
    readonly minimumDurationMs: number;
    readonly maximumGapMs: number;
    readonly maximumPendingObservations: number;
}
export interface ConsolidationProgress {
    readonly signatureKey?: string;
    readonly startedAt: number;
    readonly lastObservedAt: number;
    readonly observations: number;
    readonly durationMs: number;
    readonly status: "idle" | "pending" | "stable";
}
/** An experimental default, not a universal definition of a stable phenomenon. */
export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = Object.freeze({
    minimumObservations: 6, minimumDurationMs: 5000, maximumGapMs: 2000, maximumPendingObservations: 128,
});
export function validateConsolidationConfig(config: ConsolidationConfig): void {
    if (!config || Object.keys(config).some(k => !Object.hasOwn(DEFAULT_CONSOLIDATION_CONFIG, k)) ||
        !Number.isSafeInteger(config.minimumObservations) || config.minimumObservations < 2 ||
        !Number.isSafeInteger(config.maximumPendingObservations) || config.maximumPendingObservations < config.minimumObservations ||
        config.maximumPendingObservations > 4096 ||
        !Number.isFinite(config.minimumDurationMs) || config.minimumDurationMs <= 0 ||
        !Number.isFinite(config.maximumGapMs) || config.maximumGapMs <= 0) throw new Error("Invalid consolidation configuration");
}
/** Pure transition: interruption or a long observation gap starts a fresh candidate.
 * Repeated timestamps cannot manufacture elapsed time. A bounded window fails closed on overflow.
 */
export function advanceConsolidation(previous: ConsolidationProgress | undefined, signatureKey: string | undefined,
    observedAt: number, config: ConsolidationConfig): ConsolidationProgress {
    if (!Number.isFinite(observedAt) || (previous && observedAt < previous.lastObservedAt)) {
        throw new Error("Consolidation requires a monotonic observation clock");
    }
    const continuing = signatureKey !== undefined && previous?.signatureKey === signatureKey &&
        observedAt - previous.lastObservedAt <= config.maximumGapMs &&
        previous.observations < config.maximumPendingObservations;
    const startedAt = continuing ? previous!.startedAt : observedAt;
    const observations = signatureKey === undefined ? 0 : continuing ? previous!.observations + 1 : 1;
    const durationMs = observedAt - startedAt;
    return Object.freeze({ ...(signatureKey === undefined ? {} : { signatureKey }), startedAt, lastObservedAt: observedAt,
        observations, durationMs, status: signatureKey === undefined ? "idle" :
            observations >= config.minimumObservations && durationMs >= config.minimumDurationMs ? "stable" : "pending" });
}
/** Check the actual finite evidence window, not just a claimed duration or a prediction. */
export function validateConsolidationSupport(times: ReadonlyArray<number>, config: ConsolidationConfig): void {
    if (times.length < config.minimumObservations || times.length > config.maximumPendingObservations ||
        times.some((t, i) => !Number.isFinite(t) || (i > 0 && (t < times[i - 1] || t - times[i - 1] > config.maximumGapMs))) ||
        times[times.length - 1] - times[0] < config.minimumDurationMs) throw new Error("Insufficient temporal consolidation support");
}
