import { RuntimeGraphBuilder } from "@spiky-panda/core";
import { StateObserverNode, DecisionContextNode, PolicyLookupNode, ConfidenceGateNode,
    FallbackRequestNode, ReasoningProviderNode, DecisionMergeNode, SafetyGuardNode,
    CapabilityExecutorNode, OutcomeObserverNode, OutcomeEvaluatorNode, ExperienceRecorderNode,
    ContextualPolicyLookupNode, ContextualExperienceRecorderNode, CueObserverNode, CuePolicyLookupNode,
    validateHarnessGraph } from "../../../packages/harness/dist/index.js";

export const HARNESS_VARIANTS = Object.freeze(["harness-fallback", "harness-v1", "harness-v2", "harness-v3-shadow", "harness-v3-active", "harness-v3-consolidated", "harness-v3-continuous", "harness-v3-spikes", "harness-v3-spikes-modulated"]);
class AlwaysReasonLookup extends PolicyLookupNode {
    async execute(context) { return { slot: "candidates", value: { context, candidates: [] } }; }
}
/** A refused or not-yet-applied command has no attributable experience to consolidate. */
function publicRecorder(Base) {
    return class PublicOutcomeRecorder extends Base {
        async execute(input, session) {
            if (!input.result.output?.learningSkip) return super.execute(input, session);
            session.assertCanComplete(); session.authority.assertExecuted(input);
            session.services.operatingContexts?.interrupt(input.context.state, input.context.intention, session.now());
            session.complete({ decisionId: session.frame.decisionId, source: input.decision.source,
                stateBefore: input.context.state, intention: input.context.intention, decision: input.decision,
                candidateScore: input.candidate?.score, candidateConfidence: input.candidate?.confidence,
                result: input.result, stateAfter: input.stateAfter, evaluation: input.evaluation,
                ...(input.context.cues ? { cues: input.context.cues } : {}),
                startedAt: session.startedAt, completedAt: session.now() });
        }
    };
}
/** The sample owns its topology; core's builder constructs the real executable graph. */
export function buildProductionGraph(variant) {
    if (!HARNESS_VARIANTS.includes(variant)) throw new Error("Unknown harness variant");
    const contextual = !["harness-fallback", "harness-v1"].includes(variant), cues = variant.startsWith("harness-v3");
    const Lookup = variant === "harness-fallback" ? AlwaysReasonLookup : cues ? CuePolicyLookupNode :
        contextual ? ContextualPolicyLookupNode : PolicyLookupNode;
    const Recorder = publicRecorder(contextual ? ContextualExperienceRecorderNode : ExperienceRecorderNode);
    const nodes = [new StateObserverNode(), new DecisionContextNode(), ...(cues ? [new CueObserverNode()] : []),
        new Lookup(), new ConfidenceGateNode(), new FallbackRequestNode(), new ReasoningProviderNode(),
        new DecisionMergeNode(), new SafetyGuardNode(), new CapabilityExecutorNode(), new OutcomeObserverNode(),
        new OutcomeEvaluatorNode(), new Recorder()];
    nodes.forEach(n => { n.id = n.stage; n.type = "Production." + n.constructor.name; });
    const byStage = new Map(nodes.map(n => [n.stage, n]));
    const edges = [
        ["observe", "state", "context", "state"],
        ...(cues ? [["context", "context", "cues", "context"], ["cues", "context", "lookup", "context"]] :
            [["context", "context", "lookup", "context"]]),
        ["lookup", "candidates", "gate", "candidates"], ["gate", "policy", "merge", "policy"],
        ["gate", "fallback", "request", "fallback"], ["request", "request", "reason", "request"],
        ["reason", "decision", "merge", "reasoning"], ["merge", "decision", "guard", "decision"],
        ["guard", "authorized", "execute", "authorized"], ["execute", "result", "observe-after", "result"],
        ["observe-after", "outcome", "evaluate", "outcome"], ["evaluate", "experience", "record", "experience"],
    ];
    const builder = new RuntimeGraphBuilder().withMode("static").withNodes(...nodes);
    for (const [from, output, to, input] of edges) builder.withChannel(byStage.get(from), byStage.get(to), output, input);
    const graph = builder.build();
    validateHarnessGraph(graph);
    return graph;
}
