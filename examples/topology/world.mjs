import { TopologyMemory, CapabilityRegistry, createTopologyHarness } from "../../packages/harness/dist/index.js";
import { createTopologyFixture, topologyState, topologyIntention, routingDecision } from "./fixture.mjs";
import { buildTopologySampleFlow } from "./flow.mjs";

/** Deterministic wiring fixture. The fallback waits; there is no LLM or hidden regime oracle. */
export function createRoutingSample({ memory = new TopologyMemory(createTopologyFixture()),
    features = { x: 1, y: 1, z: 0 }, replayPolicy = "automatic", hooks = {}, createHarness = createTopologyHarness } = {}) {
    let tick = 1, revision = 0, route = "none", decision = 0;
    const counts = { executions: 0, fallbacks: 0, approvals: 0 };
    const current = () => topologyState({ ...features, revision, route, sampledAtSeconds: tick });
    const capabilities = new CapabilityRegistry({ approve: async () => {
        counts.approvals++; return hooks.approve ? hooks.approve() : true;
    } });
    capabilities.register({
        descriptor: { id: "fixture.route", description: "Route a synthetic request", replayPolicy,
            inputSchema: { type: "object", properties: { route: { type: "string", enum: ["a", "b", "hold"] } },
                required: ["route"], additionalProperties: false } },
        isAvailable: () => hooks.available ? hooks.available() : true,
        async execute(input) { counts.executions++; route = input.route; revision++; return { ok: true, output: { route } }; },
    });
    const wiring = createHarness({ memory, buildGraph: buildTopologySampleFlow,
        clock: () => tick * 1000, idFactory: () => "routing-decision:" + ++decision,
        identifyObservation: (context, session) => hooks.identify ? hooks.identify(context, session) : ({
            observationId: "routing-observation:" + context.state.features.revision,
            observedAtSeconds: context.state.features.sampledAtSeconds,
            availableAtSeconds: context.state.features.sampledAtSeconds,
        }),
        observer: { async observe() { return current(); } }, capabilities,
        safetyGuard: { async validate() { return hooks.guard ? hooks.guard() : { allowed: true }; } },
        fallback: { async resolve(input) {
            counts.fallbacks++;
            return hooks.fallback ? hooks.fallback(input) : routingDecision("hold");
        } },
        evaluator: { evaluate(input) {
            return hooks.evaluate ? hooks.evaluate(input) :
                { success: input.result.ok && input.stateAfter.features.route === input.decision.invocation.input.route, reward: 1 };
        } },
    });
    return { ...wiring, memory, counts, current,
        elapse(seconds) { tick += seconds; },
        set(next, elapsedSeconds = 1) { features = { ...next }; revision++; tick += elapsedSeconds; },
        async step() { return wiring.runtime.step(topologyIntention); },
    };
}
