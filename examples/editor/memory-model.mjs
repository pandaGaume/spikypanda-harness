import { transitionKey } from "../../packages/harness/dist/index.js";

export function contextLabel(context) {
    const state = { below: "Sous la cible", above: "Au-dessus de la cible", "at-target": "Cible atteinte" }[context.state.id] ?? context.state.id;
    return { label: state, detail: `Atteindre ${context.intention.parameters?.target ?? "?"}` };
}

export function actionLabel(actionId) {
    return { increment: "Commande +1", decrement: "Commande -1" }[actionId] ?? actionId;
}

/** Read-only projection. Eligibility comes from the runtime, never a second scoring rule. */
export function projectMemory(policy, experienceLimit = 12) {
    if (!Number.isInteger(experienceLimit) || experienceLimit < 1) throw new Error("Invalid experience display limit");
    const snapshot = policy.snapshot();
    const candidates = new Map();
    for (const context of snapshot.contexts) {
        for (const candidate of policy.findCandidateActions(context.state, context.intention)) {
            if (candidate.context.key === context.key) candidates.set(candidate.transitionKey, candidate);
        }
    }
    const nodes = [
        ...snapshot.contexts.map(context => ({ id: `context:${context.key}`, kind: "context", ...contextLabel(context) })),
        ...snapshot.actions.map(action => ({ id: `action:${action.id}`, kind: "action", label: actionLabel(action.id), detail: action.id })),
        ...snapshot.capabilities.map(capability => ({ id: `capability:${capability.id}`, kind: "capability",
            label: capability.id === "counter.move" ? "Déplacer le compteur" : capability.id, detail: capability.id })),
    ];
    const transitions = snapshot.transitions.map(item => ({
        id: `transition:${item.key}`, from: `context:${item.contextKey}`, to: `action:${item.actionId}`,
        capability: `capability:${item.invocation.capabilityId}`,
        stats: item.stats, eligible: candidates.get(item.key)?.eligible === true,
        input: JSON.stringify(item.invocation.input),
    }));
    const bindings = snapshot.bindings.map(binding => ({
        id: `binding:${binding.actionId}:${binding.capabilityId}`,
        from: `action:${binding.actionId}`, to: `capability:${binding.capabilityId}`,
    }));
    // Experience records are actual isolated graph nodes. This reference is derived
    // for selection only; it is not drawn as a stored graph edge.
    const experiences = snapshot.experiences.slice(-experienceLimit).map((experience, index, visible) => ({
        id: `experience:${experience.id}`, number: snapshot.experiences.length - visible.length + index + 1,
        transitionId: `transition:${transitionKey(experience.context, experience.decision.action.id,
            experience.decision.invocation.capabilityId, experience.decision.invocation.input)}`,
        action: actionLabel(experience.decision.action.id),
        source: experience.decision.source === "policy" ? "mémoire" : "raisonneur simulé",
        before: experience.context.state.features.value, after: experience.stateAfter.features.value,
        success: experience.evaluation.success, context: contextLabel(experience.context),
    }));
    return { nodes, transitions, bindings, experiences, experienceCount: snapshot.experiences.length,
        contextCount: snapshot.contexts.length, actionCount: snapshot.actions.length };
}
