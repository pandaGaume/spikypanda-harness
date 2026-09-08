import { Graph, GraphNode, GraphOLink, type INode, type IOlink } from "@spiky-panda/core";
import { createDecisionContext, stableStringify, transitionKey as makeTransitionKey } from "./canonical.js";
import { immutableCopy, validateDecision, validateState, validateIntention, validateEvaluation } from "./validation.js";
import { ExactStateMatcher } from "./matching.js";
import type {
    ActionDefinition,
    ActionInvocation,
    CapabilityDescriptor,
    DecisionContext,
    Experience,
    ExpectedOutcome,
    Intention,
    PolicyCandidate,
    ResolvedDecision,
    State,
    StateMatcher,
    TransitionStats,
} from "./model.js";
import {
    DEFAULT_PLASTICITY_CONFIG,
    initialTransitionStats,
    scoreTransition,
    updateTransitionStats,
    validatePlasticityConfig,
    type PlasticityConfig,
} from "./plasticity.js";

const CONTEXT_TYPE = "Harness.Policy:context";
const ACTION_TYPE = "Harness.Policy:action";
const CAPABILITY_TYPE = "Harness.Policy:capability";
const EXPERIENCE_TYPE = "Harness.Policy:experience";
const TRANSITION_TYPE = "Harness.Policy:transition";
const BINDING_TYPE = "Harness.Policy:bindsTo";

export class ContextNode extends GraphNode {
    public constructor(public readonly context: DecisionContext) {
        super();
        this.id = `context:${context.key}`;
        this.type = CONTEXT_TYPE;
    }
}

export class ActionNode extends GraphNode {
    public constructor(public readonly action: ActionDefinition) {
        super();
        this.id = `action:${action.id}`;
        this.type = ACTION_TYPE;
    }
}

export class CapabilityNode extends GraphNode {
    public constructor(public readonly descriptor: CapabilityDescriptor) {
        super();
        this.id = `capability:${descriptor.id}`;
        this.type = CAPABILITY_TYPE;
    }
}

export class ExperienceNode extends GraphNode {
    public constructor(public readonly experience: Experience) {
        super();
        this.id = `experience:${experience.id}`;
        this.type = EXPERIENCE_TYPE;
    }
}

export class PolicyTransition extends GraphOLink {
    public constructor(
        context: ContextNode,
        action: ActionNode,
        public readonly key: string,
        public readonly invocation: ActionInvocation,
        public stats: TransitionStats,
        public expectedOutcome?: ExpectedOutcome
    ) {
        super(context, action);
        this.id = `transition:${key}`;
        this.type = TRANSITION_TYPE;
    }
}

export class CapabilityBinding extends GraphOLink {
    public constructor(action: ActionNode, capability: CapabilityNode) {
        super(action, capability);
        this.id = `binding:${action.action.id}:${capability.descriptor.id}`;
        this.type = BINDING_TYPE;
    }
}

export type PolicyNode = ContextNode | ActionNode | CapabilityNode | ExperienceNode;
export type PolicyLink = PolicyTransition | CapabilityBinding;

export interface SerializedTransition {
    readonly contextKey: string;
    readonly actionId: string;
    readonly key: string;
    readonly invocation: ActionInvocation;
    readonly stats: TransitionStats;
    readonly expectedOutcome?: ExpectedOutcome;
}

export interface PolicySnapshot {
    readonly version: 1;
    readonly plasticity?: PlasticityConfig;
    readonly contexts: ReadonlyArray<DecisionContext>;
    readonly actions: ReadonlyArray<ActionDefinition>;
    readonly capabilities: ReadonlyArray<CapabilityDescriptor>;
    readonly transitions: ReadonlyArray<SerializedTransition>;
    readonly bindings: ReadonlyArray<{ actionId: string; capabilityId: string }>;
    readonly experiences: ReadonlyArray<Experience>;
}

export interface RecordExperienceInput {
    readonly decisionId?: string;
    readonly stateBefore: State;
    readonly intention: Intention;
    readonly decision: ResolvedDecision;
    readonly stateAfter: State;
    readonly result: Experience["result"];
    readonly evaluation: Experience["evaluation"];
    readonly observedAt?: number;
    readonly experienceId?: string;
}

export class PolicyGraph {
    private readonly graph = new Graph<PolicyNode, PolicyLink>();
    private readonly contexts = new Map<string, ContextNode>();
    private readonly actions = new Map<string, ActionNode>();
    private readonly capabilities = new Map<string, CapabilityNode>();
    private readonly transitions = new Map<string, PolicyTransition>();
    private readonly bindings = new Map<string, CapabilityBinding>();
    private readonly experiences: ExperienceNode[] = [];
    private experienceSequence = 0;

    public constructor(
        private readonly matcher: StateMatcher = new ExactStateMatcher(),
        public readonly plasticity: PlasticityConfig = DEFAULT_PLASTICITY_CONFIG
    ) {
        validatePlasticityConfig(plasticity);
        this.plasticity = immutableCopy(plasticity);
    }

    public graphView(): Graph<PolicyNode, PolicyLink> {
        return this.graph;
    }

    public findCandidateActions(state: State, intention: Intention): PolicyCandidate[] {
        const candidates: PolicyCandidate[] = [];
        for (const contextNode of this.contexts.values()) {
            if (contextNode.context.intention.id !== intention.id) continue;
            if (stableStringify(contextNode.context.intention.parameters ?? {}) !== stableStringify(intention.parameters ?? {})) continue;
            const similarity = this.matcher.similarity(contextNode.context.state, state);
            if (similarity <= 0) continue;
            for (const link of contextNode.onsc<PolicyTransition>((item) => item.type === TRANSITION_TYPE)) {
                const action = link.ofin as ActionNode | null;
                if (!action) continue;
                const score = scoreTransition(link.stats, similarity);
                candidates.push({
                    transitionKey: link.key,
                    context: contextNode.context,
                    action: action.action,
                    invocation: link.invocation,
                    expectedOutcome: link.expectedOutcome,
                    score,
                    confidence: link.stats.confidence,
                    similarity,
                    eligible: link.stats.directEligible && score >= this.plasticity.scoreThreshold,
                    stats: { ...link.stats },
                });
            }
        }
        return candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
    }

    public recordExperience(input: RecordExperienceInput): Experience {
        input = immutableCopy(input);
        validateState(input.stateBefore);
        validateState(input.stateAfter);
        validateIntention(input.intention);
        validateDecision(input.decision);
        if (input.experienceId && this.experiences.some(n => n.experience.id === input.experienceId)) throw new Error("Duplicate experience ID");
        validateEvaluation(input.evaluation);
        const observedAt = input.observedAt ?? Date.now();
        const context = createDecisionContext(input.stateBefore, input.intention);
        const contextNode = this.ensureContext(context);
        const actionNode = this.ensureAction(input.decision.action);
        const capabilityNode = this.ensureCapability({
            id: input.decision.invocation.capabilityId,
            description: input.decision.invocation.capabilityId,
        });
        this.ensureBinding(actionNode, capabilityNode);

        const key = makeTransitionKey(
            context,
            input.decision.action.id,
            input.decision.invocation.capabilityId,
            input.decision.invocation.input
        );
        let transition = this.transitions.get(key);
        if (!transition) {
            transition = new PolicyTransition(
                contextNode,
                actionNode,
                key,
                input.decision.invocation,
                initialTransitionStats(this.plasticity),
                input.decision.expectedOutcome
            );
            this.transitions.set(key, transition);
            this.addLink(transition);
        }
        transition.stats = updateTransitionStats(transition.stats, input.evaluation, observedAt, this.plasticity);
        transition.expectedOutcome = input.decision.expectedOutcome ?? transition.expectedOutcome;

        const id = input.experienceId ?? `exp-${observedAt}-${++this.experienceSequence}`;
        const experience: Experience = {
            id,
            decisionId: input.decisionId,
            context,
            decision: input.decision,
            stateAfter: input.stateAfter,
            result: input.result,
            evaluation: input.evaluation,
            observedAt,
        };
        const node = new ExperienceNode(experience);
        this.experiences.push(node);
        this.addNode(node);
        return experience;
    }

    public getKnownContexts(): DecisionContext[] {
        return [...this.contexts.values()].map((node) => node.context);
    }

    public getKnownStates(): State[] {
        const byId = new Map<string, State>();
        for (const node of this.contexts.values()) byId.set(node.context.state.id, node.context.state);
        return [...byId.values()];
    }

    public getOutgoingTransitions(state: State, intention: Intention): PolicyCandidate[] {
        return this.findCandidateActions(state, intention);
    }

    public getActionHistory(actionId: string): Experience[] {
        return this.experiences
            .map((node) => node.experience)
            .filter((experience) => experience.decision.action.id === actionId);
    }

    public getRecentFailures(state: State, intention: Intention, limit = 5): Experience[] {
        const key = createDecisionContext(state, intention).key;
        return this.experiences
            .map((node) => node.experience)
            .filter((experience) => experience.context.key === key && !experience.evaluation.success)
            .slice(-limit)
            .reverse();
    }

    public getTransitionStats(state: State, intention: Intention, invocation: ActionInvocation): TransitionStats | undefined {
        const context = createDecisionContext(state, intention);
        const key = makeTransitionKey(context, invocation.actionId, invocation.capabilityId, invocation.input);
        const stats = this.transitions.get(key)?.stats;
        return stats ? { ...stats } : undefined;
    }

    public snapshot(): PolicySnapshot {
        return immutableCopy({
            version: 1,
            plasticity: this.plasticity,
            contexts: [...this.contexts.values()].map((node) => node.context),
            actions: [...this.actions.values()].map((node) => node.action),
            capabilities: [...this.capabilities.values()].map((node) => node.descriptor),
            transitions: [...this.transitions.values()].map((transition) => ({
                contextKey: (transition.oini as ContextNode).context.key,
                actionId: (transition.ofin as ActionNode).action.id,
                key: transition.key,
                invocation: transition.invocation,
                stats: transition.stats,
                expectedOutcome: transition.expectedOutcome,
            })),
            bindings: [...this.bindings.values()].map((binding) => ({
                actionId: (binding.oini as ActionNode).action.id,
                capabilityId: (binding.ofin as CapabilityNode).descriptor.id,
            })),
            experiences: this.experiences.map((node) => node.experience),
        });
    }

    public static fromSnapshot(
        snapshot: PolicySnapshot,
        matcher: StateMatcher = new ExactStateMatcher(),
        plasticity: PlasticityConfig = snapshot.plasticity ?? DEFAULT_PLASTICITY_CONFIG
    ): PolicyGraph {
        snapshot = immutableCopy(snapshot);
        if (snapshot.version !== 1) throw new Error(`Unsupported policy snapshot version: ${String(snapshot.version)}`);
        for (const key of ["contexts", "actions", "capabilities", "transitions", "bindings", "experiences"] as const) {
            if (!Array.isArray(snapshot[key])) throw new Error(`Invalid snapshot collection: ${key}`);
        }
        const policy = new PolicyGraph(matcher, plasticity);
        for (const context of snapshot.contexts) {
            validateState(context.state);
            validateIntention(context.intention);
            if (!context.state?.id || !context.intention?.id || context.key !== createDecisionContext(context.state, context.intention).key || policy.contexts.has(context.key)) throw new Error("Invalid or duplicate context");
            policy.ensureContext(context);
        }
        for (const action of snapshot.actions) {
            if (!action.id || typeof action.description !== "string" || policy.actions.has(action.id)) throw new Error("Invalid or duplicate action");
            policy.ensureAction(action);
        }
        for (const capability of snapshot.capabilities) {
            if (!capability.id || policy.capabilities.has(capability.id)) throw new Error("Invalid or duplicate capability");
            policy.ensureCapability(capability);
        }
        for (const item of snapshot.transitions) {
            const context = policy.contexts.get(item.contextKey);
            const action = policy.actions.get(item.actionId);
            if (!context || !action) throw new Error(`Invalid transition snapshot: ${item.key}`);
            validateDecision({ action: action.action, invocation: item.invocation, expectedOutcome: item.expectedOutcome });
            if (item.key !== makeTransitionKey(context.context, item.actionId, item.invocation.capabilityId, item.invocation.input) || policy.transitions.has(item.key) || !policy.capabilities.has(item.invocation.capabilityId)) throw new Error("Invalid transition identity");
            const stats = item.stats;
            if (!stats || ![stats.totalUsageCount, stats.totalSuccessCount, stats.totalFailureCount, stats.consecutiveFailures].every(n => Number.isSafeInteger(n) && n >= 0) ||
                stats.totalUsageCount !== stats.totalSuccessCount + stats.totalFailureCount ||
                stats.consecutiveFailures > stats.totalFailureCount || stats.effectiveEvidence > stats.totalUsageCount ||
                !Number.isFinite(stats.rewardEma) || Math.abs(stats.rewardEma) > 1 ||
                !Number.isFinite(stats.confidence) || stats.confidence < 0 || stats.confidence > 1 ||
                !Number.isFinite(stats.effectiveEvidence) || stats.effectiveEvidence < 0 || stats.effectiveEvidence > plasticity.maximumEffectiveEvidence ||
                typeof stats.directEligible !== "boolean") throw new Error("Invalid transition statistics");
            const transition = new PolicyTransition(context, action, item.key, item.invocation, { ...item.stats }, item.expectedOutcome);
            policy.transitions.set(item.key, transition);
            policy.addLink(transition);
        }
        for (const item of snapshot.bindings) {
            const action = policy.actions.get(item.actionId);
            const capability = policy.capabilities.get(item.capabilityId);
            if (!action || !capability) throw new Error(`Invalid capability binding: ${item.actionId}/${item.capabilityId}`);
            policy.ensureBinding(action, capability);
        }
        for (const experience of snapshot.experiences) {
            if (!experience.id || policy.experiences.some(n => n.experience.id === experience.id) || !policy.contexts.has(experience.context.key)) throw new Error("Invalid or duplicate experience");
            validateDecision(experience.decision);
            validateEvaluation(experience.evaluation);
            validateState(experience.stateAfter);
            validateState(experience.context.state);
            validateIntention(experience.context.intention);
            if (!experience.result || typeof experience.result.ok !== "boolean" || !Number.isFinite(experience.observedAt) ||
                !["policy", "fallback"].includes(experience.decision.source) ||
                experience.context.key !== createDecisionContext(experience.context.state, experience.context.intention).key) throw new Error("Invalid experience payload");
            const node = new ExperienceNode(experience);
            policy.experiences.push(node);
            policy.addNode(node);
            policy.experienceSequence += 1;
        }
        return policy;
    }

    private ensureContext(context: DecisionContext): ContextNode {
        let node = this.contexts.get(context.key);
        if (!node) {
            node = new ContextNode(context);
            this.contexts.set(context.key, node);
            this.addNode(node);
        }
        return node;
    }

    private ensureAction(action: ActionDefinition): ActionNode {
        let node = this.actions.get(action.id);
        if (!node) {
            node = new ActionNode(action);
            this.actions.set(action.id, node);
            this.addNode(node);
        }
        return node;
    }

    private ensureCapability(descriptor: CapabilityDescriptor): CapabilityNode {
        let node = this.capabilities.get(descriptor.id);
        if (!node) {
            node = new CapabilityNode(descriptor);
            this.capabilities.set(descriptor.id, node);
            this.addNode(node);
        }
        return node;
    }

    private ensureBinding(action: ActionNode, capability: CapabilityNode): CapabilityBinding {
        const key = `${action.action.id}:${capability.descriptor.id}`;
        let binding = this.bindings.get(key);
        if (!binding) {
            binding = new CapabilityBinding(action, capability);
            this.bindings.set(key, binding);
            this.addLink(binding);
        }
        return binding;
    }

    private addNode(node: PolicyNode): void {
        this.graph.nodes.push(node);
        this.graph.hiddens.push(node);
    }

    private addLink(link: PolicyLink): void {
        this.graph.links.push(link);
    }
}

export function isPolicyNode(node: INode): node is PolicyNode {
    return [CONTEXT_TYPE, ACTION_TYPE, CAPABILITY_TYPE, EXPERIENCE_TYPE].includes(node.type ?? "");
}

export function isPolicyLink(link: IOlink): link is PolicyLink {
    return link.type === TRANSITION_TYPE || link.type === BINDING_TYPE;
}

