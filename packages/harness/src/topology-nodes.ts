import { PolicyLookupNode, ConfidenceGateNode, ExperienceRecorderNode } from "./nodes.js";
import { PolicyGraph } from "./policy-graph.js";
import { AdaptivePolicyRuntime, type AdaptivePolicyRuntimeOptions } from "./runtime.js";
import { createRuntimeGraphDriver, type HarnessGraph } from "./graph.js";
import { TopologyActivationSession } from "./topology-session.js";
import { contextKey } from "./canonical.js";
import type { TopologyMemory } from "./topology-memory.js";
import type { TopologyPass, TopologyFrame } from "./topology-types.js";
import type { HarnessSession } from "./session.js";
import type { LookupResult, NodeEmission, SelectedDecision, EvaluatedExperience } from "./contracts.js";
import type { DecisionContext, PolicyCandidate, State, Intention } from "./model.js";

export type TopologyObservationIdentity = Pick<TopologyFrame, "observationId" | "observedAtSeconds" | "availableAtSeconds">;
export type TopologyObservationReader = (context: DecisionContext, session: HarnessSession) => TopologyObservationIdentity;
interface TopologyLookup extends LookupResult { readonly topology: TopologyPass; }
const candidate = (p: TopologyPass["proposals"][number], context: DecisionContext): PolicyCandidate => ({
    transitionKey: p.branchId, context, action: p.decision.action, invocation: p.decision.invocation,
    expectedOutcome: p.decision.expectedOutcome, score: p.support, similarity: p.support,
    confidence: p.stats.confidence, eligible: p.stats.directEligible, stats: p.stats,
});

export class TopologyLookupNode extends PolicyLookupNode {
    constructor(readonly activation: TopologyActivationSession, private readonly identify: TopologyObservationReader) { super(); }
    protected override async execute(context: DecisionContext, session: HarnessSession): Promise<NodeEmission> {
        this.activation.assertBound();
        const definition = this.activation.memory.definition;
        const pass = this.activation.activate({ ...this.identify(context, session), decisionId: session.frame.decisionId,
            context, memoryRevision: definition.revision, schemaVersion: definition.schemaVersion, timeSeconds: session.now() / 1000 },
            { signal: session.signal });
        return { slot: "candidates", value: { context, topology: pass, candidates: pass.proposals.map(p => candidate(p, context)) } satisfies TopologyLookup };
    }
}
export class TopologyGateNode extends ConfidenceGateNode {
    constructor(readonly activation: TopologyActivationSession) { super(); }
    protected override async execute(input: TopologyLookup, session: HarnessSession): Promise<NodeEmission> {
        const result = this.activation.claim(input.topology, input.context, session.frame.decisionId);
        if (!result.selected) return { slot: "fallback", value: input };
        const selected = result.selected;
        const available = await session.authority.listAvailable(input.context);
        session.assertActive(); this.activation.assertBound(session.now() / 1000); this.activation.assertPass(input.topology, input.context, session.frame.decisionId);
        if (!available.some(c => c.id === selected.decision.invocation.capabilityId)) return { slot: "fallback", value: input };
        return { slot: "policy", value: { context: input.context, candidate: candidate(selected, input.context),
            decision: { ...selected.decision, source: "policy" } } satisfies SelectedDecision };
    }
}
export class TopologyExperienceRecorderNode extends ExperienceRecorderNode {
    constructor(readonly activation: TopologyActivationSession) { super(); }
    protected override async execute(input: EvaluatedExperience, session: HarnessSession): Promise<void> {
        session.assertCanComplete(); session.authority.assertExecuted(input); this.activation.assertBound();
        const { context, decision, stateAfter, result, evaluation, candidate: chosen } = input;
        this.activation.appendExecutedExperience({ id: "experience:" + session.frame.decisionId, decisionId: session.frame.decisionId,
            context, decision, stateAfter, result, evaluation, observedAt: session.now() });
        session.services.metrics.recordOutcome(evaluation, true);
        session.complete({ decisionId: session.frame.decisionId, source: decision.source, stateBefore: context.state,
            intention: context.intention, decision, result, stateAfter, evaluation, candidateScore: chosen?.score,
            candidateConfidence: chosen?.confidence, startedAt: session.startedAt, completedAt: session.now() });
    }
}
/** Compatibility service only. Never substitutes classic policy lookup for topology propagation. */
class TopologyJournalPolicy extends PolicyGraph {
    constructor(private readonly activation: TopologyActivationSession) { super(); }
    override findCandidateActions(): never { throw new Error("Classic policy lookup is not part of topology activation"); }
    override recordExperience(): never { throw new Error("T1 does not learn topology or branch reliability"); }
    override getRecentFailures(state: State, intention: Intention, limit = 5) {
        return this.activation.journal().filter(e => e.context.key === contextKey(state, intention) && !e.evaluation.success)
            .slice(-limit).reverse();
    }
}
export interface TopologyHarnessOptions extends Omit<AdaptivePolicyRuntimeOptions, "policy" | "driver" | "operatingContexts" | "cueObserver" | "cueMode"> {
    readonly memory: TopologyMemory;
    readonly activation?: TopologyActivationSession;
    readonly identifyObservation: TopologyObservationReader;
    /** The host/sample owns its flow topology. No hidden production or counter graph. */
    readonly buildGraph: (nodes: { lookup: TopologyLookupNode; gate: TopologyGateNode; recorder: TopologyExperienceRecorderNode }) => HarnessGraph;
}
/** One activation session across decision sessions; existing execution authority remains mandatory. */
export function createTopologyHarness(options: TopologyHarnessOptions) {
    const { memory, identifyObservation, buildGraph, activation: suppliedActivation, ...runtimeOptions } = options;
    if (["policy", "driver", "operatingContexts", "cueObserver", "cueMode"].some(k => Object.hasOwn(options, k))) throw new Error("Foreign services in topology harness");
    const activation = suppliedActivation ?? new TopologyActivationSession(memory);
    if (!(activation instanceof TopologyActivationSession) || activation.memory !== memory) throw new Error("Foreign topology activation session");
    const graph = buildGraph({ lookup: new TopologyLookupNode(activation, identifyObservation),
        gate: new TopologyGateNode(activation), recorder: new TopologyExperienceRecorderNode(activation) });
    const coreDriver = createRuntimeGraphDriver(graph);
    const runtime = new AdaptivePolicyRuntime({ ...runtimeOptions, policy: new TopologyJournalPolicy(activation),
        observer: { async observe() {
            // Also called by ExecutionAuthority immediately before the actuator boundary.
            activation.assertBound((runtimeOptions.clock?.() ?? Date.now()) / 1000);
            const state = await runtimeOptions.observer.observe();
            activation.assertBound((runtimeOptions.clock?.() ?? Date.now()) / 1000);
            return state;
        } },
        driver: async (runtime, frame) => {
            activation.beginDecision(frame.decisionId);
            try { await coreDriver(runtime, frame); }
            finally { activation.endDecision(frame.decisionId); }
        } });
    return { runtime, activation, graph };
}
