import { validateConsolidationSupport } from "./consolidation.js";
import { GraphBuilder, GraphNode, GraphOLink, type IGraph, type INode, type IOlink } from "@spiky-panda/core";
import { PolicyGraph, ContextNode, ActionNode, CapabilityNode, ExperienceNode, PolicyTransition, CapabilityBinding,
    type PolicySnapshot, type RecordExperienceInput } from "./policy-graph.js";
import { contextKey, createDecisionContext, stableStringify } from "./canonical.js";
import { immutableCopy, validateDecision, validateEvaluation, validateState, validateIntention } from "./validation.js";
import { DEFAULT_PLASTICITY_CONFIG, type PlasticityConfig } from "./plasticity.js";
import type { ActionInvocation, Experience, Intention, JsonValue, PolicyCandidate, State, TransitionStats } from "./model.js";
import { DEFAULT_OPERATING_CONTEXT_CONFIG, validateOperatingConfig, type AttributionStatus, type MemoryRelation,
    type OperatingBelief, type OperatingContextConfig, type OperatingMode } from "./operating-types.js";

const json = (value: unknown) => stableStringify(value as JsonValue);
const unique = <T>(items: T[], key: (item: T) => string): T[] => [...new Map(items.map(item => [key(item), item])).values()];
export const operatingModeId = (scope: string, signature: JsonValue): string => "mode:" + json([scope, signature]);

export class OperatingModeNode extends GraphNode {
    constructor(public readonly mode: OperatingMode) { super(); this.id = mode.id; this.type = "Harness.Memory:operating-mode"; }
}
export class MemoryRelationLink extends GraphOLink {
    constructor(from: INode, to: INode, public readonly relation: MemoryRelation) {
        super(from, to); this.id = relation.id; this.type = "Harness.Memory:" + relation.kind;
    }
}

/** Conditional policy and auditable attributions. Live applicability belongs to a tracker, not this shared memory. */
export class ContextualPolicyGraph extends PolicyGraph {
    private learned = new PolicyGraph(undefined, this.plasticity);
    private legacy: PolicySnapshot = new PolicyGraph(undefined, this.plasticity).snapshot();
    private ledger: Experience[] = [];
    private modeNodes = new Map<string, OperatingModeNode>();
    private revisionSequence = 0;
    public readonly contextConfig: OperatingContextConfig;

    constructor(public readonly modelId: string, config: OperatingContextConfig = DEFAULT_OPERATING_CONTEXT_CONFIG,
        plasticity: PlasticityConfig = DEFAULT_PLASTICITY_CONFIG) {
        super(undefined, plasticity);
        if (typeof modelId !== "string" || !modelId) throw new Error("Missing effect signature model ID");
        validateOperatingConfig(config); this.contextConfig = immutableCopy(config);
    }

    public modes(scope?: string): OperatingMode[] {
        return [...this.modeNodes.values()].map(n => n.mode).filter(m => scope === undefined || m.scope === scope);
    }
    public mode(id: string): OperatingMode | undefined { return this.modeNodes.get(id)?.mode; }

    public confirmMode(scope: string, signature: JsonValue, observedAt: number, consolidationSupport?: ReadonlyArray<string>): OperatingMode | undefined {
        const id = operatingModeId(scope, signature), existing = this.mode(id);
        if (existing) return existing;
        if (this.modes(scope).length >= this.contextConfig.maximumModesPerScope) return undefined;
        const mode = immutableCopy({ id, scope, signature, label: "M" + (this.modeNodes.size + 1), createdAt: observedAt,
            ...(consolidationSupport ? { consolidationSupport: [...consolidationSupport] } : {}) });
        this.validateModeSupport(mode);
        this.modeNodes.set(id, new OperatingModeNode(mode));
        return mode;
    }

    private validateModeSupport(mode: OperatingMode): void {
        const config = this.contextConfig.consolidation;
        if (!config) {
            if (mode.consolidationSupport !== undefined) throw new Error("Unexpected consolidation support");
            return;
        }
        const ids = mode.consolidationSupport;
        if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error("Missing or duplicate consolidation support");
        const evidence = ids.map(id => this.evidence(id));
        if (evidence.some(e => e.context.key !== mode.scope || json(e.attribution?.signature) !== json(mode.signature)) ||
            evidence.at(-1)?.observedAt !== mode.createdAt) throw new Error("Foreign consolidation support");
        validateConsolidationSupport(evidence.map(e => e.observedAt), config);
    }

    public override findCandidateActions(state: State, intention: Intention, modeId?: string): PolicyCandidate[] {
        const scope = contextKey(state, intention);
        const modes = modeId ? this.modes(scope).filter(m => m.id === modeId) : this.modes(scope);
        return modes.flatMap(mode => this.learned.findCandidateActions(state, intention, mode.id)
            .map(candidate => ({ ...candidate, eligible: !!modeId && candidate.eligible })));
    }
    public override getTransitionStats(state: State, intention: Intention, invocation: ActionInvocation, modeId?: string): TransitionStats | undefined {
        return modeId ? this.learned.getTransitionStats(state, intention, invocation, modeId) : undefined;
    }
    public override getKnownContexts() { return this.snapshot().contexts.slice(); }
    public override getKnownStates() { return unique(this.getKnownContexts().map(c => c.state), s => s.id); }
    public override getOutgoingTransitions(state: State, intention: Intention) { return this.findCandidateActions(state, intention); }
    public override getActionHistory(actionId: string) { return this.ledger.filter(e => e.decision.action.id === actionId); }
    public override getRecentFailures(state: State, intention: Intention, limit = 5): Experience[] {
        const scope = contextKey(state, intention);
        return this.ledger.filter(e => contextKey(e.context.state, e.context.intention) === scope && !e.evaluation.success).slice(-limit).reverse();
    }
    public override recordExperience(_input: RecordExperienceInput): Experience {
        throw new Error("Contextual memory requires an OperatingContextTracker and contextual recorder");
    }

    public appendEvidence(input: RecordExperienceInput, before: OperatingBelief, signature: JsonValue | null): Experience {
        input = immutableCopy(input);
        validateState(input.stateBefore); validateState(input.stateAfter); validateIntention(input.intention);
        validateDecision(input.decision); validateEvaluation(input.evaluation);
        if (!input.result || typeof input.result.ok !== "boolean") throw new Error("Invalid execution result");
        const id = input.experienceId ?? "experience:" + crypto.randomUUID(), observedAt = input.observedAt ?? Date.now();
        if (typeof id !== "string" || !id || !Number.isFinite(observedAt) || !["policy", "fallback"].includes(input.decision.source) || this.ledger.some(e => e.id === id)) throw new Error("Invalid or duplicate experience");
        const context = createDecisionContext(input.stateBefore, input.intention);
        if (before.scope !== context.key) throw new Error("Foreign operating scope");
        const current = { status: "pending" as const, reason: "Awaiting attribution", sequence: ++this.revisionSequence };
        const experience = immutableCopy({ id, decisionId: input.decisionId, context, decision: input.decision,
            stateAfter: input.stateAfter, result: input.result, evaluation: input.evaluation, observedAt,
            attribution: { before, signature, current, revisions: [current] }, ...(input.cues ? { cues: input.cues } : {}) });
        this.ledger.push(experience);
        return experience;
    }

    /** Explicit, audited correction. Rebuild EMA projections so old evidence is removed from its former branch. */
    public attribute(id: string, status: AttributionStatus, modeId: string | undefined, reason: string): Experience {
        const index = this.ledger.findIndex(e => e.id === id), previous = this.ledger[index];
        if (!previous?.attribution || typeof reason !== "string" || !reason) throw new Error("Unknown contextual experience or missing attribution reason");
        if (!["pending", "confirmed", "anomaly", "unresolved", "revised", "transient"].includes(status)) throw new Error("Invalid attribution status");
        const mode = modeId ? this.mode(modeId) : undefined;
        if (modeId && (!mode || mode.scope !== previous.context.key)) throw new Error("Foreign attribution mode");
        if (["confirmed", "anomaly", "revised"].includes(status) !== !!modeId) throw new Error("Invalid attribution status");
        if (status === "confirmed" && json(mode!.signature) !== json(previous.attribution.signature)) throw new Error("Contradictory confirmed attribution");
        const current = { status, modeId, reason, sequence: ++this.revisionSequence };
        const next = immutableCopy({ ...previous, attribution: { ...previous.attribution, current,
            revisions: [...previous.attribution.revisions, current] } });
        this.ledger[index] = next;
        if (previous.attribution.current.modeId) this.rebuildLearning();
        else if (modeId) {
            // Pending evidence can be older than another already-attributed experience.
            if (this.ledger.slice(index + 1).some(e => e.attribution?.current.modeId)) this.rebuildLearning();
            else this.learn(next);
        }
        return next;
    }
    public evidence(id: string): Experience {
        const item = this.ledger.find(e => e.id === id);
        if (!item) throw new Error("Unknown experience");
        return item;
    }
    public reconsiderUnresolved(mode: OperatingMode): void {
        for (const item of [...this.ledger]) {
            if (item.context.key === mode.scope && item.attribution &&
                ["pending", "unresolved"].includes(item.attribution.current.status) &&
                json(item.attribution.signature) === json(mode.signature)) {
                this.attribute(item.id, "confirmed", mode.id, "Subsequent consistent observations established this hypothesis");
            }
        }
    }

    private learn(experience: Experience): void {
        const modeId = experience.attribution?.current.modeId;
        if (!modeId) return;
        this.learned.recordExperience({ experienceId: experience.id, decisionId: experience.decisionId,
            stateBefore: experience.context.state, intention: experience.context.intention, operatingContextId: modeId,
            decision: experience.decision, stateAfter: experience.stateAfter, result: experience.result,
            evaluation: experience.evaluation, observedAt: experience.observedAt });
    }
    private rebuildLearning(): void {
        this.learned = new PolicyGraph(undefined, this.plasticity);
        for (const experience of this.ledger) this.learn(experience);
    }

    private collections() {
        const learned = this.learned.snapshot();
        return {
            contexts: unique([...this.legacy.contexts, ...this.ledger.map(e => e.context), ...learned.contexts], c => c.key),
            actions: unique([...this.legacy.actions, ...this.ledger.map(e => e.decision.action)], a => a.id),
            capabilities: unique([...this.legacy.capabilities, ...this.ledger.map(e => ({ id: e.decision.invocation.capabilityId,
                description: e.decision.invocation.capabilityId }))], c => c.id),
            transitions: [...this.legacy.transitions, ...learned.transitions],
            bindings: unique([...this.legacy.bindings, ...this.ledger.map(e => ({ actionId: e.decision.action.id,
                capabilityId: e.decision.invocation.capabilityId }))], b => json([b.actionId, b.capabilityId])),
            experiences: this.ledger,
        };
    }
    private relations(): MemoryRelation[] {
        const links: MemoryRelation[] = [];
        const add = (from: string, to: string, kind: MemoryRelation["kind"]) => links.push({ id: json([from, kind, to]), from, to, kind });
        for (const context of this.learned.getKnownContexts()) add(context.operatingContextId!, "context:" + context.key, "appliesTo");
        for (const e of this.ledger) {
            if (!e.attribution) continue; // V1 has no invented provenance.
            const id = "experience:" + e.id, { before, current, signature } = e.attribution;
            add(id, "context:" + e.context.key, "observedIn");
            add(id, "action:" + e.decision.action.id, "executed");
            if (before.modeId) {
                add(id, before.modeId, "assumed");
                if (signature !== null && json(signature) !== json(this.mode(before.modeId)!.signature)) add(id, before.modeId, "contradicts");
            }
            if (current.modeId) add(id, current.modeId, "attributedTo");
        }
        return links;
    }
    public override snapshot(): PolicySnapshot {
        return immutableCopy({ version: 2, plasticity: this.plasticity, ...this.collections(),
            operatingMemory: { modelId: this.modelId, config: this.contextConfig, modes: this.modes(), relations: this.relations() } });
    }
    public override graphView(): IGraph<INode, IOlink> {
        const data = this.collections(), nodes = new Map<string, INode>(), links: IOlink[] = [];
        const add = (node: INode) => nodes.set(String(node.id), node);
        data.contexts.forEach(c => add(new ContextNode(c))); data.actions.forEach(a => add(new ActionNode(a)));
        data.capabilities.forEach(c => add(new CapabilityNode(c))); this.ledger.forEach(e => add(new ExperienceNode(e)));
        this.modeNodes.forEach(node => add(new OperatingModeNode(node.mode)));
        for (const t of data.transitions) links.push(new PolicyTransition(nodes.get("context:" + t.contextKey) as ContextNode,
            nodes.get("action:" + t.actionId) as ActionNode, t.key, t.invocation, t.stats, t.expectedOutcome));
        for (const b of data.bindings) links.push(new CapabilityBinding(nodes.get("action:" + b.actionId) as ActionNode,
            nodes.get("capability:" + b.capabilityId) as CapabilityNode));
        for (const r of this.relations()) links.push(new MemoryRelationLink(nodes.get(r.from)!, nodes.get(r.to)!, r));
        return new GraphBuilder<INode, IOlink>().withNodes(...nodes.values()).withLinks(...links).build();
    }

    public static restore(snapshot: PolicySnapshot, legacyModelId?: string): ContextualPolicyGraph {
        snapshot = immutableCopy(snapshot);
        if (snapshot.version === 1) {
            if (!legacyModelId) throw new Error("Specify the effect model when migrating V1");
            if (snapshot.contexts.some(c => c.operatingContextId) || snapshot.experiences.some(e => e.attribution)) throw new Error("V1 documents cannot contain contextual metadata");
            const legacy = PolicyGraph.fromSnapshot(snapshot);
            const policy = new ContextualPolicyGraph(legacyModelId, undefined, legacy.plasticity);
            policy.legacy = legacy.snapshot(); policy.ledger = [...policy.legacy.experiences];
            return policy;
        }
        const memory = snapshot.operatingMemory;
        if (snapshot.version !== 2 || !memory || !Array.isArray(memory.modes) || !Array.isArray(memory.relations)) throw new Error("Invalid contextual policy snapshot");
        const policy = new ContextualPolicyGraph(memory.modelId, memory.config, snapshot.plasticity);
        // Reuse all structural, JSON, identity and statistic checks from the base graph.
        PolicyGraph.fromSnapshot({ ...snapshot, version: 1 });
        for (const mode of memory.modes) {
            if (!mode.scope || typeof mode.scope !== "string" || mode.signature === null || typeof mode.label !== "string" || !mode.label ||
                !Number.isFinite(mode.createdAt) || mode.id !== operatingModeId(mode.scope, mode.signature) ||
                policy.modeNodes.has(mode.id) || policy.modes(mode.scope).length >= policy.contextConfig.maximumModesPerScope) throw new Error("Invalid or duplicate operating mode");
            policy.modeNodes.set(mode.id, new OperatingModeNode(mode));
        }
        const revisions = new Set<number>();
        for (const e of snapshot.experiences) {
            const a = e.attribution;
            if (!a) continue;
            if (e.context.operatingContextId || a.before.scope !== e.context.key || a.before.scope !== contextKey(e.context.state, e.context.intention) ||
                !["unknown", "recognized", "uncertain"].includes(a.before.status) || !Array.isArray(a.revisions) || !a.revisions.length ||
                json(a.current) !== json(a.revisions.at(-1))) throw new Error("Invalid attribution history");
            if ((a.before.status === "recognized" && !a.before.modeId) || (a.before.status === "unknown" && !!a.before.modeId) ||
                (a.before.modeId && policy.mode(a.before.modeId)?.scope !== a.before.scope)) throw new Error("Invalid prior hypothesis");
            let last = 0;
            for (const r of a.revisions) {
                if (!["pending", "confirmed", "anomaly", "unresolved", "revised", "transient"].includes(r.status) || !r.reason ||
                    !Number.isSafeInteger(r.sequence) || r.sequence <= last || revisions.has(r.sequence) ||
                    (["confirmed", "anomaly", "revised"].includes(r.status) !== !!r.modeId) ||
                    (r.modeId && policy.mode(r.modeId)?.scope !== a.before.scope) ||
                    (r.status === "confirmed" && json(policy.mode(r.modeId!)!.signature) !== json(a.signature))) throw new Error("Invalid attribution revision");
                last = r.sequence; revisions.add(last); policy.revisionSequence = Math.max(policy.revisionSequence, last);
            }
        }
        for (const mode of policy.modes()) {
            const support = snapshot.experiences.filter(e => e.attribution?.before.scope === mode.scope && json(e.attribution.signature) === json(mode.signature));
            if (support.length < policy.contextConfig.noveltyConfirmations) throw new Error("Operating hypothesis has insufficient observed support");
        }
        for (const context of snapshot.contexts) if (context.operatingContextId &&
            policy.mode(context.operatingContextId)?.scope !== contextKey(context.state, context.intention)) throw new Error("Foreign conditional context");
        policy.legacy = { version: 1, plasticity: snapshot.plasticity,
            contexts: snapshot.contexts.filter(c => !c.operatingContextId), actions: snapshot.actions.slice(),
            capabilities: snapshot.capabilities.slice(), bindings: snapshot.bindings.slice(),
            transitions: snapshot.transitions.filter(t => !snapshot.contexts.find(c => c.key === t.contextKey)?.operatingContextId),
            experiences: snapshot.experiences.filter(e => !e.attribution) };
        policy.ledger = [...snapshot.experiences];
        for (const mode of policy.modes()) policy.validateModeSupport(mode);
        policy.rebuildLearning();
        if (json(policy.snapshot().transitions) !== json(snapshot.transitions) || json(policy.relations()) !== json(memory.relations)) {
            throw new Error("Contextual projection does not match its evidence or provenance");
        }
        return policy;
    }
}
