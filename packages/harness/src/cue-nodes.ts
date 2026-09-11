import { HarnessNode, harnessPort } from "./nodes.js";
import { ContextualPolicyLookupNode } from "./contextual-nodes.js";
import { createDecisionContext } from "./canonical.js";
import type { HarnessSession } from "./session.js";
import type { DecisionContext } from "./model.js";
import type { NodeEmission } from "./contracts.js";
import type { CueDecision } from "./cue-types.js";

function observer(session: HarnessSession) {
    const service = session.services.cueObserver;
    if (!service || service.policy !== session.services.policy ||
        service.policy !== session.services.operatingContexts?.policy) throw new Error("Cue nodes require matching host services");
    const mode = session.services.cueMode ?? "shadow";
    if (!["shadow", "active"].includes(mode)) throw new Error("Invalid cue run mode");
    return { service, mode };
}
export class CueObserverNode extends HarnessNode<DecisionContext> {
    constructor() { super("cues", [harnessPort("context", "context")], [harnessPort("context", "context")]); }
    protected override async execute(context: DecisionContext, session: HarnessSession): Promise<NodeEmission> {
        const { service, mode } = observer(session);
        const assessment = service.assess(context);
        const basis: CueDecision["basis"] = mode === "shadow" ? "shadow" : assessment.status === "recognized" ? "cues" :
            assessment.status === "learning" ? "effect-history" : "uncertain";
        return { slot: "context", value: { ...context, cues: { mode, basis, assessment } } };
    }
}
export class CuePolicyLookupNode extends ContextualPolicyLookupNode {
    protected override async execute(input: DecisionContext, session: HarnessSession): Promise<NodeEmission> {
        const { service, mode } = observer(session), cues = input.cues;
        if (!cues || cues.mode !== mode) throw new Error("Missing cue observation");
        service.validateAssessment(input, cues.assessment);
        const expected = mode === "shadow" ? "shadow" : cues.assessment.status === "recognized" ? "cues" :
            cues.assessment.status === "learning" ? "effect-history" : "uncertain";
        if (cues.basis !== expected) throw new Error("Invalid cue selection basis");
        if (cues.basis === "shadow" || cues.basis === "effect-history") {
            const result = await super.execute(input, session);
            const value = result.value as { context: DecisionContext; candidates: unknown };
            return { ...result, value: { ...value, context: { ...value.context, cues } } };
        }
        const modeId = cues.basis === "cues" ? cues.assessment.modeId : undefined;
        const context = { ...createDecisionContext(input.state, input.intention, modeId), cues };
        return { slot: "candidates", value: { context, candidates: service.policy.findCandidateActions(input.state, input.intention, modeId) } };
    }
}
