import { PolicyLookupNode, ExperienceRecorderNode } from "./nodes.js";
import { ContextualPolicyGraph } from "./contextual-policy.js";
import { createDecisionContext } from "./canonical.js";
import { validateState, validateEvaluation } from "./validation.js";
import type { HarnessSession } from "./session.js";
import type { OperatingBelief } from "./operating-types.js";
import type { DecisionContext } from "./model.js";
import type { EvaluatedExperience, NodeEmission } from "./contracts.js";

function tracker(session: HarnessSession) {
    const contexts = session.services.operatingContexts;
    if (!contexts || !(session.services.policy instanceof ContextualPolicyGraph) || contexts.policy !== session.services.policy) {
        throw new Error("Contextual nodes require the host's matching memory and operating-context tracker");
    }
    return contexts;
}
export class ContextualPolicyLookupNode extends PolicyLookupNode {
    protected override async execute(input: DecisionContext, session: HarnessSession): Promise<NodeEmission> {
        const contexts = tracker(session), belief = contexts.belief(input.state, input.intention);
        const modeId = belief.status === "recognized" ? belief.modeId : undefined;
        const context = createDecisionContext(input.state, input.intention, modeId);
        return { slot: "candidates", value: { context, candidates: contexts.policy.findCandidateActions(input.state, input.intention, modeId) } };
    }
}
export class ContextualExperienceRecorderNode extends ExperienceRecorderNode {
    protected override async execute(input: EvaluatedExperience, session: HarnessSession): Promise<void> {
        session.assertCanComplete(); session.authority.assertExecuted(input);
        validateState(input.stateAfter); validateEvaluation(input.evaluation);
        const contexts = tracker(session), { context, decision, stateAfter, result, evaluation, candidate } = input;
        const prior = contexts.belief(context.state, context.intention);
        const before: OperatingBelief = context.cues?.basis === "cues"
            ? { scope: prior.scope, status: "recognized", modeId: context.operatingContextId }
            : context.cues?.basis === "uncertain" ? { ...prior, status: "uncertain" } : prior;
        const { experience, after } = contexts.record({ decisionId: session.frame.decisionId,
            experienceId: "experience:" + session.frame.decisionId, stateBefore: context.state, intention: context.intention,
            decision, stateAfter, result, evaluation, observedAt: session.now(), cues: context.cues }, before);
        const modeId = experience.attribution!.current.modeId;
        session.services.metrics.recordOutcome(evaluation, true);
        session.complete({ decisionId: session.frame.decisionId, source: decision.source, stateBefore: context.state,
            intention: context.intention, decision, candidateScore: candidate?.score, candidateConfidence: candidate?.confidence,
            result, stateAfter, evaluation, transitionAfter: contexts.policy.getTransitionStats(context.state, context.intention, decision.invocation, modeId),
            operatingBefore: before, operatingAfter: after, attribution: experience.attribution, ...(context.cues ? { cues: context.cues } : {}),
            startedAt: session.startedAt, completedAt: session.now() });
    }
}
