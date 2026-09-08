import {
    AdaptivePolicyRuntime,
    createGraphDriver,
    CapabilityRegistry,
    PolicyGraph,
} from "../../packages/harness/dist/index.js";
import { MockReasoningProvider } from "../../packages/provider-mock/dist/index.js";

import { createPolicyFlowDefinition } from "../shared/policy-flow.mjs";

class HeliosWorld {
    co2Ppm = 1200;
    phase = "nominal";

    resetAtmosphere() {
        this.co2Ppm = 1200;
    }

    async observe() {
        return {
            id: "helios:co2-high:power-normal",
            features: { co2Ppm: this.co2Ppm, availablePowerKw: 4 },
        };
    }
}

const world = new HeliosWorld();
const capabilities = new CapabilityRegistry();
capabilities.register({
    descriptor: { id: "scrubber.a.boost", description: "Boost primary CO2 scrubber" },
    async execute() {
        const drop = world.phase === "degraded" ? 20 : 120;
        world.co2Ppm -= drop;
        return { ok: true, output: { drop } };
    },
});
capabilities.register({
    descriptor: { id: "scrubber.b.start", description: "Start backup CO2 scrubber" },
    async execute() {
        const drop = world.phase === "degraded" ? 110 : 10;
        world.co2Ppm -= drop;
        return { ok: true, output: { drop } };
    },
});

const policy = new PolicyGraph();
const fallback = new MockReasoningProvider(() => {
    const useBackup = world.phase === "degraded";
    const actionId = useBackup ? "start-backup-scrubber" : "boost-primary-scrubber";
    const capabilityId = useBackup ? "scrubber.b.start" : "scrubber.a.boost";
    return {
        action: { id: actionId, description: actionId.replaceAll("-", " ") },
        invocation: { actionId, capabilityId, input: null },
        expectedOutcome: { description: "CO2 must decrease by at least 80 ppm" },
    };
});

const intention = { id: "maintain-safe-atmosphere", description: "Return CO2 toward the safe envelope" };
const runtime = new AdaptivePolicyRuntime({
    driver: createGraphDriver(createPolicyFlowDefinition(intention)),
    policy,
    fallback,
    capabilities,
    observer: world,
    evaluator: {
        evaluate({ context, stateAfter, result }) {
            const drop = Number(context.state.features.co2Ppm) - Number(stateAfter.features.co2Ppm);
            return { success: result.ok && drop >= 80, reward: result.ok && drop >= 80 ? 1 : -1, reason: `CO2 drop: ${drop} ppm` };
        },
    },
});

const rows = [];
for (let day = 1; day <= 45; day += 1) {
    world.phase = day <= 15 ? "nominal" : day <= 30 ? "degraded" : "recovered";
    world.resetAtmosphere();
    const trace = await runtime.step(intention);
    rows.push({
        day,
        phase: world.phase,
        source: trace.source,
        action: trace.decision.action.id,
        success: trace.evaluation.success,
        confidence: trace.transitionAfter.confidence.toFixed(3),
        eligible: trace.transitionAfter.directEligible,
    });
}

console.table(rows);

