import { RuntimeNode, type IDeclaresPorts, type IPortDescriptor, type ISession } from "@spiky-panda/core";
import type {
    CapabilityRegistry,
    DecisionContext,
    PolicyCandidate,
    PolicyDecision,
    PolicyFallback,
    PolicyFallbackInput,
    PolicyGraph,
    SafetyGuard,
} from "@spiky-panda/harness";

export interface HarnessNodeServices {
    readonly policy?: PolicyGraph;
    readonly fallback?: PolicyFallback;
    readonly safetyGuard?: SafetyGuard;
    readonly capabilities?: CapabilityRegistry;
}

abstract class HarnessNode extends RuntimeNode<HarnessNodeServices> implements IDeclaresPorts {
    public abstract readonly inputPorts: ReadonlyArray<IPortDescriptor>;
    public abstract readonly outputPorts: ReadonlyArray<IPortDescriptor>;
}

export class PolicyLookupNode extends HarnessNode {
    public readonly inputPorts = [
        { slot: "state", optional: false, type: "harness.state" },
        { slot: "intention", optional: false, type: "harness.intention" },
    ] as const;
    public readonly outputPorts = [{ slot: "candidates", optional: false, type: "harness.candidates" }] as const;

    public override fire(session: ISession): void {
        const state = this.consumeLatest(session, "state") as Parameters<PolicyGraph["findCandidateActions"]>[0] | undefined;
        const intention = this.consumeLatest(session, "intention") as Parameters<PolicyGraph["findCandidateActions"]>[1] | undefined;
        if (!state || !intention || !this.bag?.policy) return;
        this.publishAll(session, "candidates", this.bag.policy.findCandidateActions(state, intention));
    }
}

export class ConfidenceGateNode extends HarnessNode {
    public readonly inputPorts = [{ slot: "candidates", optional: false, type: "harness.candidates" }] as const;
    public readonly outputPorts = [
        { slot: "decision", optional: true, type: "harness.decision" },
        { slot: "fallback", optional: true, type: "boolean" },
    ] as const;

    public override fire(session: ISession): void {
        const candidates = (this.consumeLatest(session, "candidates") as PolicyCandidate[] | undefined) ?? [];
        const candidate = candidates.find((item) => item.eligible);
        if (candidate) {
            const decision: PolicyDecision = {
                action: candidate.action,
                invocation: candidate.invocation,
                expectedOutcome: candidate.expectedOutcome,
            };
            this.publishAll(session, "decision", decision);
        } else {
            this.publishAll(session, "fallback", true);
        }
    }
}

export class ReasoningProviderNode extends HarnessNode {
    public readonly inputPorts = [{ slot: "request", optional: false, type: "harness.fallback-input" }] as const;
    public readonly outputPorts = [{ slot: "decision", optional: false, type: "harness.decision" }] as const;

    public override async fireAsync(session: ISession): Promise<void> {
        const request = this.consumeLatest(session, "request") as PolicyFallbackInput | undefined;
        if (!request || !this.bag?.fallback) return;
        this.publishAll(session, "decision", await this.bag.fallback.resolve(request));
    }
}

export class SafetyGuardNode extends HarnessNode {
    public readonly inputPorts = [
        { slot: "decision", optional: false, type: "harness.decision" },
        { slot: "context", optional: false, type: "harness.context" },
    ] as const;
    public readonly outputPorts = [
        { slot: "authorized", optional: true, type: "harness.decision" },
        { slot: "rejected", optional: true, type: "harness.safety-decision" },
    ] as const;

    public override async fireAsync(session: ISession): Promise<void> {
        const decision = this.consumeLatest(session, "decision") as PolicyDecision | undefined;
        const context = this.consumeLatest(session, "context") as DecisionContext | undefined;
        if (!decision || !context || !this.bag?.safetyGuard) return;
        const result = await this.bag.safetyGuard.validate(decision, context);
        this.publishAll(session, result.allowed ? "authorized" : "rejected", result.allowed ? decision : result);
    }
}

export class CapabilityExecutorNode extends HarnessNode {
    public readonly inputPorts = [
        { slot: "decision", optional: false, type: "harness.decision" },
        { slot: "context", optional: false, type: "harness.context" },
    ] as const;
    public readonly outputPorts = [{ slot: "result", optional: false, type: "harness.capability-result" }] as const;

    public override async fireAsync(session: ISession): Promise<void> {
        const decision = this.consumeLatest(session, "decision") as PolicyDecision | undefined;
        const context = this.consumeLatest(session, "context") as DecisionContext | undefined;
        if (!decision || !context || !this.bag?.capabilities) return;
        const result = await this.bag.capabilities.execute(decision, {
            decisionId: `graph-${Date.now()}`,
            state: context.state,
            intention: context.intention,
        });
        this.publishAll(session, "result", result);
    }
}

export class ExperienceRecorderNode extends HarnessNode {
    public readonly inputPorts = [{ slot: "experience", optional: false, type: "harness.experience-input" }] as const;
    public readonly outputPorts = [{ slot: "recorded", optional: false, type: "harness.experience" }] as const;

    public override fire(session: ISession): void {
        const input = this.consumeLatest(session, "experience") as Parameters<PolicyGraph["recordExperience"]>[0] | undefined;
        if (!input || !this.bag?.policy) return;
        this.publishAll(session, "recorded", this.bag.policy.recordExperience(input));
    }
}

