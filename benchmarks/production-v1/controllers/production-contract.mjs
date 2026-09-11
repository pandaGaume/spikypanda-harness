/** Production sample semantics. No simulator import, hidden coefficient or scenario label. */
export const adapterModelId = "production.observed-response.v1";
export const contextEncoding = Object.freeze({ temperatureBandC: 10, queueBandParts: 10 });
export function measuredState(observation) {
    const temperature = observation.temperatureC === null ? "missing" : Math.floor(observation.temperatureC / contextEncoding.temperatureBandC);
    const queue = Math.floor(observation.queueParts / contextEncoding.queueBandParts);
    return { id: "temperature:" + temperature + "/queue:" + queue + "/interlock:" + observation.interlock,
        features: { ...observation } };
}
export function learningSkip(feedback) {
    if (feedback.refusal) return "host-refusal";
    if (feedback.after.interlock) return "physical-interlock";
    if (feedback.after.appliedAction !== feedback.requestedAction) return "command-not-yet-applied";
    if (feedback.before.temperatureC === null || feedback.after.temperatureC === null) return "missing-outcome-measurement";
    return null;
}
export function createEffectSignature(actions) {
    const commands = new Map(actions.map(a => [a.id, a]));
    const bin = (value, width) => Math.round(value / width);
    return { id: adapterModelId,
        describe({ decision, result, stateAfter }) {
            const command = commands.get(decision.invocation.input?.actionId), after = stateAfter.features;
            if (!result.ok || result.output?.learningSkip || !command || command.drive <= 0 || command.fan <= 0 ||
                after.appliedAction !== command.id || after.interlock) return null;
            // Coarse observed response per requested effort, not the simulator's true operating mode.
            return { speedPerDrive: bin(after.speed / command.drive, 0.25),
                currentPerDrive: bin(after.currentA / command.drive, 2),
                flowPerFan: bin(after.coolantFlow / command.fan, 0.25) };
        } };
}
export const productionCueSchema = Object.freeze({
    id: "production.public-telemetry", version: 1, fields: [
        { id: "temperature", path: ["temperatureC"], scale: 80 },
        { id: "speed", path: ["speed"], scale: 1 },
        { id: "current", path: ["currentA"], scale: 10 },
        { id: "vibration", path: ["vibration"], scale: 1 },
        { id: "coolant", path: ["coolantFlow"], scale: 1 },
        { id: "queue", path: ["queueParts"], scale: 40 },
        { id: "ambient", path: ["ambientC"], scale: 50 },
    ],
});
/** Local learning signal, distinct from the evaluator's true-state benchmark metrics.
 * No correctness label is taken from the reference decision or a hidden scenario.
 */
export function createProductionEvaluator(objective) {
    return { evaluate({ context, stateAfter, result }) {
        const before = context.state.features, after = stateAfter.features;
        if (result.output?.learningSkip) return { success: false, reward: 0, reason: result.output.learningSkip };
        const good = after.goodParts - before.goodParts, rejected = after.rejectedParts - before.rejectedParts;
        const lost = after.overflowParts - before.overflowParts;
        const arrivals = Math.max(0, after.queueParts - before.queueParts + good + rejected + lost);
        const safe = after.temperatureC !== null && after.temperatureC <= objective.temperatureLimitC && !after.interlock;
        const quality = good + rejected === 0 || rejected <= (1 - objective.serviceFraction) * (good + rejected) + 1e-9;
        const service = good >= arrivals * objective.serviceFraction - 1e-9;
        const cooling = before.temperatureC >= 0.9 * objective.temperatureLimitC &&
            after.temperatureC < before.temperatureC - 0.2;
        const success = result.ok && safe && lost < 1e-9 && quality && (service || cooling);
        return { success, reward: success ? 1 : -1,
            reason: success ? (cooling && !service ? "Observed protective cooling" : "Observed service maintained") :
                "Observed temperature, quality, flow or overflow objective missed" };
    } };
}
