import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { TopologyMemory, TopologyActivationSession, TemporalTopologyMemory, TemporalTopologySession,
    DEFAULT_TOPOLOGY_TEMPORAL_CONFIG } from "../../packages/harness/dist/index.js";
import { createTopologyFixture, topologyFrame } from "../../examples/topology/fixture.mjs";
import { cases, cadences, variants, createTape } from "./cases.mjs";

const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(q * xs.length) - 1] ?? 0;
export function measureCase(scenario, cadence, variant) {
    if (!variants.includes(variant)) throw new Error("Unknown T2 variant");
    const definition = createTopologyFixture();
    if (scenario.cut) {
        definition.revision += ":cut"; definition.edges = definition.edges.filter(e => e.id !== "y-xy");
    }
    const memory = variant === "t1" ? new TopologyMemory(definition) : new TemporalTopologyMemory(definition,
        { ...DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, mode: variant, resetAlpha: variant === "spikes-modulated" ? 0.8 : 0 });
    const session = variant === "t1" ? new TopologyActivationSession(memory) : new TemporalTopologySession(memory);
    const tape = createTape(scenario, cadence), times = [], frames = [];
    let selected = 0, correct = 0, wrong = 0, fallbacks = 0, spikes = 0, nodeFirings = 0, deliveries = 0;
    for (const observation of tape) {
        const frame = topologyFrame(memory, observation.features, observation.timeSeconds);
        const start = performance.now();
        const pass = session.activate(frame), arbitration = session.arbitrate(pass);
        times.push(performance.now() - start);
        const route = arbitration.selected?.decision.invocation.input.route ?? null;
        if (route === null) fallbacks++;
        else { selected++; if (route === observation.expected) correct++; else wrong++; }
        spikes += pass.work.spikeEvents; nodeFirings += pass.work.nodeFirings; deliveries += pass.work.relationDeliveries;
        frames.push({ timeSeconds: observation.timeSeconds, expected: observation.expected, route,
            reason: arbitration.reason, spikes: pass.work.spikeEvents });
    }
    const latencies = scenario.targets.map(([from, to, expected]) => {
        const recognized = frames.find(f => f.timeSeconds >= from && f.timeSeconds <= to && f.route === expected);
        return { fromSeconds: from, expected, latencySeconds: recognized ? recognized.timeSeconds - from : null };
    });
    return { scenario: scenario.id, cadence, variant, observations: tape.length,
        tapeSha256: createHash("sha256").update(JSON.stringify(tape)).digest("hex"),
        selected, correct, wrong, fallbacks, spikes, nodeFirings, deliveries, latencies,
        correctSelectionFraction: correct / tape.length,
        timing: { scope: "activation-and-arbitration", totalMs: times.reduce((a, b) => a + b, 0),
            p50Ms: quantile(times, 0.5), p95Ms: quantile(times, 0.95) }, frames };
}
export function runCampaign() {
    const runs = [];
    for (const scenario of cases) for (const cadence of cadences) for (const variant of variants) runs.push(measureCase(scenario, cadence, variant));
    return { protocol: "topology-t2-branch-local-v1", fixture: "manual-routing", runs };
}
