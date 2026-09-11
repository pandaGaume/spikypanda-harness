import { RuntimeNode, type IPortDescriptor, type ISession } from "@spiky-panda/core";
import { createDecisionContext } from "./canonical.js";
import type { AuthorizedDecision, EvaluatedExperience, ExecutedDecision, LookupResult, NodeEmission, ObservedOutcome, ReasoningRequest, SelectedDecision } from "./contracts.js";
import type { DecisionContext, State } from "./model.js";
import { HarnessSession } from "./session.js";
import { immutableCopy, validateDecision, validateEvaluation, validateState } from "./validation.js";

export const harnessPort = (slot: string, type: string): IPortDescriptor => ({ slot, type: `harness.${type}`, optional: false });

/** Stateless executable node. Override execute(), while retaining the session envelope. */
export abstract class HarnessNode<Input = unknown> extends RuntimeNode {
    public constructor(public readonly stage: string, public readonly inputPorts: ReadonlyArray<IPortDescriptor>,
        public readonly outputPorts: ReadonlyArray<IPortDescriptor>) { super(); }

    public override isReady(session: ISession): boolean {
        return !(session instanceof HarnessSession && session.hasVisited(this)) && super.isReady(session);
    }

    public override fire(): void { throw new Error("Harness nodes require asynchronous execution with a HarnessSession"); }

    public override async fireAsync(session: ISession): Promise<void> {
        if (!(session instanceof HarnessSession)) throw new Error("HarnessSession services must be provided before execution");
        await session.invoke(this, async () => {
            const incoming = this.inputPorts.map(port => ({ port, packet: this.consumeLatest(session, port.slot) }))
                .filter(item => item.packet !== undefined);
            if (incoming.length !== (this.inputPorts.length ? 1 : 0)) throw new Error("Missing or duplicated decision input");
            const input = incoming.length ? session.take<Input>(incoming[0].packet, incoming[0].port.type!) : undefined as Input;
            const output = await this.execute(input, session);
            session.assertActive();
            if (output === undefined) {
                if (this.outputPorts.length) throw new Error("Missing node output");
                return;
            }
            const port = this.outputPorts.find(port => port.slot === output.slot);
            if (!port) throw new Error("Unknown node output slot");
            this.publishAll(session, output.slot, session.packet(port.type!, output.value));
        });
    }

    protected abstract execute(input: Input, session: HarnessSession): Promise<NodeEmission | void>;
}

export class StateObserverNode extends HarnessNode<void> {
    constructor() { super("observe", [], [harnessPort("state", "state")]); }
    protected override async execute(_input: void, session: HarnessSession): Promise<NodeEmission> {
        const state = immutableCopy(await session.services.observer.observe());
        validateState(state);
        return { slot: "state", value: state };
    }
}

export class DecisionContextNode extends HarnessNode<State> {
    constructor() { super("context", [harnessPort("state", "state")], [harnessPort("context", "context")]); }
    protected override async execute(state: State, session: HarnessSession): Promise<NodeEmission> {
        return { slot: "context", value: createDecisionContext(state, session.intention) };
    }
}

export class PolicyLookupNode extends HarnessNode<DecisionContext> {
    constructor() { super("lookup", [harnessPort("context", "context")], [harnessPort("candidates", "candidates")]); }
    protected override async execute(context: DecisionContext, session: HarnessSession): Promise<NodeEmission> {
        return { slot: "candidates", value: { context, candidates: session.services.policy.findCandidateActions(context.state, context.intention) } };
    }
}

export class ConfidenceGateNode extends HarnessNode<LookupResult> {
    constructor() { super("gate", [harnessPort("candidates", "candidates")], [harnessPort("policy", "decision"), harnessPort("fallback", "uncertain")]); }
    protected override async execute(input: LookupResult, session: HarnessSession): Promise<NodeEmission> {
        const available = await session.authority.listAvailable(input.context);
        const candidate = input.candidates.find(c => c.eligible && available.some(a => a.id === c.invocation.capabilityId));
        if (!candidate) return { slot: "fallback", value: input };
        const selected: SelectedDecision = { context: input.context, candidate, decision: {
            source: "policy", action: candidate.action, invocation: candidate.invocation, expectedOutcome: candidate.expectedOutcome } };
        return { slot: "policy", value: selected };
    }
}

export class FallbackRequestNode extends HarnessNode<LookupResult> {
    constructor() { super("request", [harnessPort("fallback", "uncertain")], [harnessPort("request", "request")]); }
    protected override async execute(input: LookupResult, session: HarnessSession): Promise<NodeEmission> {
        return { slot: "request", value: { context: input.context, request: {
            decisionId: session.frame.decisionId, state: input.context.state, intention: input.context.intention,
            allowedCapabilities: await session.authority.listAvailable(input.context), candidates: input.candidates,
            recentFailures: session.services.policy.getRecentFailures(input.context.state, input.context.intention),
        } } satisfies ReasoningRequest };
    }
}

export class ReasoningProviderNode extends HarnessNode<ReasoningRequest> {
    constructor() { super("reason", [harnessPort("request", "request")], [harnessPort("decision", "decision")]); }
    protected override async execute(input: ReasoningRequest, session: HarnessSession): Promise<NodeEmission> {
        const proposed = await session.services.fallback.resolve(Object.freeze({ ...input.request, signal: session.signal }));
        session.assertActive(); validateDecision(proposed);
        if (!input.request.allowedCapabilities.some(c => c.id === proposed.invocation.capabilityId)) throw new Error("Provider proposed a capability outside the allowlist");
        return { slot: "decision", value: { context: input.context, decision: { ...proposed, source: "fallback" } } satisfies SelectedDecision };
    }
}

export class DecisionMergeNode extends HarnessNode<SelectedDecision> {
    constructor() { super("merge", [harnessPort("policy", "decision"), harnessPort("reasoning", "decision")], [harnessPort("decision", "merged")]); }
    public override isReady(session: ISession): boolean {
        return this.enabled && !(session instanceof HarnessSession && session.hasVisited(this)) &&
            session.graph.links.some((link, index) => link.ofin === this && session.linkStates[index].ready);
    }
    protected override async execute(selected: SelectedDecision, session: HarnessSession): Promise<NodeEmission> {
        session.services.metrics.recordDecision(selected.decision.source);
        return { slot: "decision", value: selected };
    }
}

export class SafetyGuardNode extends HarnessNode<SelectedDecision> {
    constructor() { super("guard", [harnessPort("decision", "merged")], [harnessPort("authorized", "authorized")]); }
    protected override async execute(selected: SelectedDecision, session: HarnessSession): Promise<NodeEmission> {
        return { slot: "authorized", value: await session.authority.authorize(selected) };
    }
}

export class CapabilityExecutorNode extends HarnessNode<AuthorizedDecision> {
    constructor() { super("execute", [harnessPort("authorized", "authorized")], [harnessPort("result", "result")]); }
    protected override async execute(receipt: AuthorizedDecision, session: HarnessSession): Promise<NodeEmission> {
        return { slot: "result", value: await session.authority.execute(receipt) };
    }
}

export class OutcomeObserverNode extends HarnessNode<ExecutedDecision> {
    constructor() { super("observe-after", [harnessPort("result", "result")], [harnessPort("outcome", "outcome")]); }
    protected override async execute(input: ExecutedDecision, session: HarnessSession): Promise<NodeEmission> {
        const stateAfter = immutableCopy(await session.services.observer.observe());
        validateState(stateAfter);
        return { slot: "outcome", value: { ...input, stateAfter } satisfies ObservedOutcome };
    }
}

export class OutcomeEvaluatorNode extends HarnessNode<ObservedOutcome> {
    constructor() { super("evaluate", [harnessPort("outcome", "outcome")], [harnessPort("experience", "experience")]); }
    protected override async execute(input: ObservedOutcome, session: HarnessSession): Promise<NodeEmission> {
        const evaluation = immutableCopy(await session.services.evaluator.evaluate({
            context: input.context, decision: input.decision, stateAfter: input.stateAfter, result: input.result }));
        validateEvaluation(evaluation);
        return { slot: "experience", value: { ...input, evaluation } satisfies EvaluatedExperience };
    }
}

export class ExperienceRecorderNode extends HarnessNode<EvaluatedExperience> {
    constructor() { super("record", [harnessPort("experience", "experience")], []); }
    protected override async execute(input: EvaluatedExperience, session: HarnessSession): Promise<void> {
        session.assertCanComplete();
        session.authority.assertExecuted(input);
        validateState(input.stateAfter); validateEvaluation(input.evaluation);
        const { policy, metrics } = session.services;
        const { context, decision, stateAfter, result, evaluation, candidate } = input;
        policy.recordExperience({ decisionId: session.frame.decisionId, experienceId: `experience:${session.frame.decisionId}`,
            stateBefore: context.state, intention: context.intention, decision, stateAfter, result, evaluation, observedAt: session.now() });
        metrics.recordOutcome(evaluation, true);
        session.complete({ decisionId: session.frame.decisionId, source: decision.source, stateBefore: context.state,
            intention: context.intention, decision, candidateScore: candidate?.score, candidateConfidence: candidate?.confidence,
            result, stateAfter, evaluation, transitionAfter: policy.getTransitionStats(context.state, context.intention, decision.invocation)!,
            startedAt: session.startedAt, completedAt: session.now() });
    }
}
