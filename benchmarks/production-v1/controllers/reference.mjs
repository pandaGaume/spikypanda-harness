/** Engineering smoke reference, not a competitive adaptive controller or an LLM.
 * It sees the same measured state available to every adapter, with no scenario ID.
 */
export function referenceDecision(observation) {
    if (observation.temperatureC === null || observation.temperatureC >= 75 || observation.interlock) {
        return { actionId: "stop", rationale: "Missing or high measured temperature; cool down" };
    }
    if (observation.temperatureC > 62) return { actionId: "eco", rationale: "Reduce thermal input" };
    if (observation.queueParts > 7) return { actionId: "boost", rationale: "Clear observed backlog" };
    return { actionId: "balanced", rationale: "Maintain normal production" };
}
export function createReferenceController() {
    return { id: "reference-reactive-v1", decide: async observation => referenceDecision(observation) };
}
export function createStopController() {
    return { id: "always-stop-instrument-check", decide: async () => ({ actionId: "stop", rationale: "Instrument check, not a competitive baseline" }) };
}
