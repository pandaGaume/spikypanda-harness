import { createDecisionContext, initialTransitionStats, updateTransitionStats } from "../../packages/harness/dist/index.js";

export const topologyIntention = Object.freeze({ id: "choose-route" });
export const topologyState = (features = {}) => ({ id: "routing-sample", features });
export const routingDecision = route => ({
    action: { id: "route", description: "Select a route in the fixture" },
    invocation: { actionId: "route", capabilityId: "fixture.route", input: { route } },
});

/** Hand-built test data, not learning or evidence measured on a real system. */
export function createTopologyFixture() {
    let mature = initialTransitionStats();
    for (let i = 0; i < 8; i++) mature = updateTransitionStats(mature, { success: true, reward: 1 }, i);
    const branch = (id, route) => ({ id, kind: "branch", inputs: ["support"],
        decision: routingDecision(route), stats: { ...mature },
        experienceIds: Array.from({ length: 8 }, (_, i) => "fixture:" + id + ":" + i) });
    return { version: 1, revision: "routing-fixture:1", schemaVersion: "routing-features:1",
        contextKey: createDecisionContext(topologyState(), topologyIntention).key,
        nodes: [
            ...["x", "y", "z"].map(id => ({ id, kind: "condition", path: [id], center: 1, tolerance: 1 })),
            { id: "xy", kind: "and", inputs: ["x", "y"] },
            { id: "yz", kind: "and", inputs: ["y", "z"] },
            branch("a", "a"), branch("b", "b"),
        ],
        edges: [
            { id: "x-xy", from: "x", to: "xy", input: "x" },
            { id: "y-xy", from: "y", to: "xy", input: "y" },
            { id: "y-yz", from: "y", to: "yz", input: "y" },
            { id: "z-yz", from: "z", to: "yz", input: "z" },
            { id: "xy-a", from: "xy", to: "a", input: "support" },
            { id: "yz-b", from: "yz", to: "b", input: "support" },
        ] };
}
export function topologyFrame(memory, features, tick = 1, overrides = {}) {
    return { observationId: "observation:" + tick, decisionId: "decision:" + tick,
        observedAtSeconds: tick, availableAtSeconds: tick, timeSeconds: tick,
        memoryRevision: memory.definition.revision, schemaVersion: memory.definition.schemaVersion,
        context: createDecisionContext(topologyState(features), topologyIntention), ...overrides };
}
