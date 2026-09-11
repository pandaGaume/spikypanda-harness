import { TemporalEvidenceNetwork, DEFAULT_TEMPORAL_EVIDENCE_CONFIG } from "../../packages/harness/dist/index.js";

/** Instrument-level diagnostic. Public cue scores, never production truth passed to the controller. */
export const signalScenarios = Object.freeze([
    "brief-pulse", "persistent-switch", "slow-drift", "return", "missing", "weak-evidence", "misleading-cue",
]);
function expectedAt(name, t) {
    if (["persistent-switch", "slow-drift", "missing"].includes(name)) return t >= 20 ? "B" : "A";
    if (name === "return") return t >= 20 && t < 40 ? "B" : "A";
    return "A";
}
export function signalTape(name, seed, cadenceSeconds) {
    if (!signalScenarios.includes(name) || ![0.25, 0.5, 1, 2].includes(cadenceSeconds)) throw new Error("Unknown signal case");
    const noise = i => {
        let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
        x = Math.imul(x ^ x >>> 16, 0x7feb352d);
        return ((x ^ x >>> 15) >>> 0) / 4294967296;
    };
    return Array.from({ length: 60 / cadenceSeconds }, (_, i) => {
        const t = i * cadenceSeconds, expected = expectedAt(name, t);
        let winner = expected, rate = 1;
        if (name === "brief-pulse" && t >= 20 && t < 21) winner = "B";
        if (name === "slow-drift" && t >= 20) rate = Math.min(1, (t - 20) / 12);
        if (name === "missing" && t >= 18 && t < 25) { winner = null; rate = 0; }
        if (name === "weak-evidence") rate = 0.6 + 0.08 * (noise(Math.floor(t)) - 0.5);
        if (name === "misleading-cue" && t >= 20) winner = "B";
        return { timeSeconds: t, publicEvidence: { winner, rate }, expected };
    });
}
export function runSignalCase(name, seed, cadenceSeconds, mode, config = DEFAULT_TEMPORAL_EVIDENCE_CONFIG, resetModulation) {
    const network = mode === "instantaneous" ? null : new TemporalEvidenceNetwork(mode, config, resetModulation);
    const tape = signalTape(name, seed, cadenceSeconds), rows = tape.map(row => {
        const { winner, rate } = row.publicEvidence;
        let selected = null;
        if (!winner) network?.forget("signal");
        else if (network) selected = network.advance("signal", ["A", "B"], winner, rate, row.timeSeconds).modeId;
        else selected = rate >= 1 ? winner : null;
        return { ...row, selected };
    });
    const episodes = rows.filter((r, i) => i > 0 && r.expected !== rows[i - 1].expected).map(r => {
        const end = rows.find(s => s.timeSeconds > r.timeSeconds && s.expected !== r.expected)?.timeSeconds ?? 60;
        const first = rows.find(s => s.timeSeconds >= r.timeSeconds && s.timeSeconds < end && s.selected === r.expected);
        return { atSeconds: r.timeSeconds, mode: r.expected, detected: !!first,
            delaySeconds: first ? first.timeSeconds - r.timeSeconds : null };
    });
    const measured = rows.filter(r => r.timeSeconds >= 10);
    const seconds = predicate => measured.filter(predicate).length * cadenceSeconds;
    const diagnostics = network?.inspect() ?? null;
    return { scenario: name, seed, cadenceSeconds, mode, config: network?.config ?? null,
        ...(network?.resetModulation ? { resetModulation: network.resetModulation } : {}),
        metrics: { measuredSeconds: measured.length * cadenceSeconds,
            wrongActivationSeconds: seconds(r => r.selected !== null && r.selected !== r.expected),
            correctActivationSeconds: seconds(r => r.selected === r.expected),
            abstentionSeconds: seconds(r => r.selected === null),
            switches: measured.filter((r, i) => i > 0 && r.selected !== measured[i - 1].selected).length, episodes },
        work: diagnostics ? { nodeFirings: diagnostics.nodeFirings, inputEvents: diagnostics.inputEvents,
            outputEvents: diagnostics.outputEvents, spikeEvents: diagnostics.spikeEvents } : null, rows };
}
