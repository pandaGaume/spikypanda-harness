import { RuntimeNode, type IPortDescriptor, type ISession } from "@spiky-panda/core";
import type { AdaptivePolicyRuntime, DecisionFrame, HarnessStage } from "@spiky-panda/harness";

export interface HarnessNodeServices {
    readonly runtime: AdaptivePolicyRuntime;
    readonly frame: DecisionFrame;
    readonly onNode?: (id: string, stage: HarnessStage) => void;
}

const port = (slot: string, type: string): IPortDescriptor => ({ slot, type: `harness.${type}`, optional: false });

export class HarnessNode extends RuntimeNode<HarnessNodeServices> {
    public constructor(public readonly stage: HarnessStage, public readonly inputPorts: ReadonlyArray<IPortDescriptor>, public readonly outputPorts: ReadonlyArray<IPortDescriptor>) { super(); }

    public override isReady(session: ISession): boolean {
        if (this.stage === "observe") return true;
        if (this.stage === "merge") return session.graph.links.some((link, index) => link.ofin === this && session.linkStates[index].ready);
        return super.isReady(session);
    }

    public override fire(): void { throw new Error("Harness nodes require the asynchronous harness driver"); }

    public override async fireAsync(session: ISession): Promise<void> {
        const services = this.bag;
        if (!services) throw new Error("Harness runtime services must be rebound before execution");
        const packets = this.inputPorts.map(p => this.consumeLatest(session, p.slot)).filter(p => p !== undefined);
        if (this.stage !== "observe" && (packets.length !== 1 || packets[0] !== services.frame)) throw new Error("Missing, duplicated or foreign decision frame");
        await services.runtime.runStage(this.stage, services.frame);
        try { services.onNode?.(String(this.id), this.stage); } catch { /* UI diagnostics are best effort. */ }
        if (!this.outputPorts.length) return;
        const slot = this.stage === "gate" ? services.runtime.selectedSource(services.frame) : this.outputPorts[0].slot;
        this.publishAll(session, slot, services.frame);
    }
}

export class StateObserverNode extends HarnessNode { constructor() { super("observe", [], [port("state", "state")]); } }
export class DecisionContextNode extends HarnessNode { constructor() { super("context", [port("state", "state")], [port("context", "context")]); } }
export class PolicyLookupNode extends HarnessNode { constructor() { super("lookup", [port("context", "context")], [port("candidates", "candidates")]); } }
export class ConfidenceGateNode extends HarnessNode { constructor() { super("gate", [port("candidates", "candidates")], [port("policy", "decision"), port("fallback", "uncertain")]); } }
export class FallbackRequestNode extends HarnessNode { constructor() { super("request", [port("fallback", "uncertain")], [port("request", "request")]); } }
export class ReasoningProviderNode extends HarnessNode { constructor() { super("reason", [port("request", "request")], [port("decision", "decision")]); } }
export class DecisionMergeNode extends HarnessNode { constructor() { super("merge", [port("policy", "decision"), port("reasoning", "decision")], [port("decision", "merged")]); } }
export class SafetyGuardNode extends HarnessNode { constructor() { super("guard", [port("decision", "merged")], [port("authorized", "authorized")]); } }
export class CapabilityExecutorNode extends HarnessNode { constructor() { super("execute", [port("authorized", "authorized")], [port("result", "result")]); } }
export class OutcomeObserverNode extends HarnessNode { constructor() { super("observe-after", [port("result", "result")], [port("outcome", "outcome")]); } }
export class OutcomeEvaluatorNode extends HarnessNode { constructor() { super("evaluate", [port("outcome", "outcome")], [port("experience", "experience")]); } }
export class ExperienceRecorderNode extends HarnessNode { constructor() { super("record", [port("experience", "experience")], []); } }

export const HARNESS_NODES = [
    { type: "Harness.Observation:state", label: "Observer", ctor: StateObserverNode },
    { type: "Harness.Policy:context", label: "Contexte + intention", ctor: DecisionContextNode },
    { type: "Harness.Policy:lookup", label: "Chercher une policy", ctor: PolicyLookupNode },
    { type: "Harness.Policy:confidence-gate", label: "Confiance suffisante ?", ctor: ConfidenceGateNode },
    { type: "Harness.Reasoning:request", label: "Construire la demande", ctor: FallbackRequestNode },
    { type: "Harness.Reasoning:provider", label: "Raisonneur (mock)", ctor: ReasoningProviderNode },
    { type: "Harness.Policy:merge", label: "Fusion des branches", ctor: DecisionMergeNode },
    { type: "Harness.Safety:guard", label: "Valider + autoriser", ctor: SafetyGuardNode },
    { type: "Harness.Execution:capability", label: "Executer la capacite", ctor: CapabilityExecutorNode },
    { type: "Harness.Observation:outcome", label: "Observer le resultat", ctor: OutcomeObserverNode },
    { type: "Harness.Learning:evaluate", label: "Evaluer le progres", ctor: OutcomeEvaluatorNode },
    { type: "Harness.Learning:record", label: "Apprendre", ctor: ExperienceRecorderNode },
] as const;

export function createHarnessNode(type: string): HarnessNode {
    const entry = HARNESS_NODES.find(n => n.type === type);
    if (!entry) throw new Error(`Unknown harness node type: ${type}`);
    const node = new entry.ctor();
    node.type = type;
    return node;
}
