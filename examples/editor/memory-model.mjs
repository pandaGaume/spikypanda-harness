import { transitionKey, createDecisionContext } from "../../packages/harness/dist/index.js";

export function contextLabel(context) {
    const state = { below: "Sous la cible", above: "Au-dessus de la cible", "at-target": "Cible atteinte" }[context.state.id] ?? context.state.id;
    return { label: state, detail: `Atteindre ${context.intention.parameters?.target ?? "?"}` };
}

export function actionLabel(actionId) {
    return { increment: "Commande +1", decrement: "Commande -1" }[actionId] ?? actionId;
}

/** Read-only projection. Eligibility comes from the runtime, never a second scoring rule. */
export function projectMemory(policy, experienceLimit = 12, tracker) {
    if (!Number.isInteger(experienceLimit) || experienceLimit < 1) throw new Error("Invalid experience display limit");
    const snapshot = policy.snapshot();
    if (snapshot.version === 2) return projectContextualMemory(policy, snapshot, experienceLimit, tracker);
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


function projectContextualMemory(policy, snapshot, experienceLimit, tracker) {
    const modes = snapshot.operatingMemory.modes, byMode = new Map(modes.map(m => [m.id, m]));
    const byContext = new Map(snapshot.contexts.map(c => [c.key, c]));
    const beliefs = new Map(modes.map(mode => {
        const context = snapshot.contexts.find(c => c.key === mode.scope);
        return [mode.scope, tracker && context ? tracker.belief(context.state, context.intention) : { status: "unknown" }];
    }));
    const transitions = snapshot.transitions.map(item => {
        const context = byContext.get(item.contextKey), modeId = context.operatingContextId;
        const mode = byMode.get(modeId), belief = mode ? beliefs.get(mode.scope) : undefined;
        const candidate = modeId ? policy.findCandidateActions(context.state, context.intention, modeId).find(c => c.transitionKey === item.key) : undefined;
        const applicability = !mode ? "legacy" : belief?.status !== "recognized" ? "uncertain" : belief.modeId === modeId ? "applicable" : "dormant";
        return { id: "transition:" + item.key, from: "context:" + item.contextKey, to: "action:" + item.actionId,
            capability: "capability:" + item.invocation.capabilityId, stats: item.stats,
            conditionalEligible: candidate?.eligible === true, eligible: candidate?.eligible === true && applicability === "applicable",
            applicability, modeId, modeLabel: mode?.label, input: JSON.stringify(item.invocation.input) };
    });
    const experiences = snapshot.experiences.slice(-experienceLimit).map((e, i, visible) => {
        const a = e.attribution, modeId = a?.current.modeId;
        const context = modeId ? createDecisionContext(e.context.state, e.context.intention, modeId) : e.context;
        const key = transitionKey(context, e.decision.action.id, e.decision.invocation.capabilityId, e.decision.invocation.input);
        const transitionId = a && !modeId ? undefined : "transition:" + key;
        return { id: "experience:" + e.id, number: snapshot.experiences.length - visible.length + i + 1,
            transitionId, action: actionLabel(e.decision.action.id), source: e.decision.source === "policy" ? "mémoire" : "raisonneur simulé",
            before: e.context.state.features.value, after: e.stateAfter.features.value, success: e.evaluation.success,
            context: contextLabel(e.context), modeBefore: byMode.get(a?.before.modeId)?.label ?? "inconnu",
            modeAfter: byMode.get(modeId)?.label ?? "non attribué", attributionStatus: a?.current.status ?? "legacy",
            beforeStatus: ({ recognized: "reconnue", uncertain: "incertaine", unknown: "inconnue" })[a?.before.status],
            reason: a?.current.reason ?? "Historique V1 sans attribution inventée",
            revisions: a?.revisions.map(r => ({ ...r, modeLabel: byMode.get(r.modeId)?.label })) ?? [],
        };
    });
    const nodes = [
        ...modes.map(mode => ({ id: mode.id, kind: "mode", label: "Fonctionnement " + mode.label,
            detail: "Gain observé " + (mode.signature?.gain ?? JSON.stringify(mode.signature)),
            active: beliefs.get(mode.scope)?.status === "recognized" && beliefs.get(mode.scope).modeId === mode.id })),
        ...snapshot.contexts.map(context => ({ id: "context:" + context.key, kind: "context", ...contextLabel(context),
            detail: contextLabel(context).detail + " · " + (byMode.get(context.operatingContextId)?.label ?? "observations") })),
        ...snapshot.actions.map(action => ({ id: "action:" + action.id, kind: "action", label: actionLabel(action.id), detail: action.id })),
        ...snapshot.capabilities.map(capability => ({ id: "capability:" + capability.id, kind: "capability",
            label: capability.id === "counter.move" ? "Déplacer le compteur" : capability.id, detail: capability.id })),
        ...experiences.slice(-4).filter(e => e.attributionStatus !== "legacy").map(e => ({ id: e.id, kind: "experience",
            label: "Expérience #" + e.number, detail: e.before + " → " + e.after + " · " + e.modeAfter })),
    ];
    const ids = new Set(nodes.map(n => n.id));
    return { version: 2, nodes, transitions, experiences, modeCount: modes.length,
        relations: snapshot.operatingMemory.relations.filter(r => (ids.has(r.from) || experiences.some(e => e.id === r.from)) && ids.has(r.to)),
        bindings: snapshot.bindings.map(b => ({ id: "binding:" + b.actionId + ":" + b.capabilityId,
            from: "action:" + b.actionId, to: "capability:" + b.capabilityId })),
        experienceCount: snapshot.experiences.length, contextCount: snapshot.contexts.length, actionCount: snapshot.actions.length };
}
