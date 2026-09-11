import { createDecisionContext, contextKey } from "../../packages/harness/dist/index.js";

export const cueStatusLabels = { learning: "Apprentissage initial", missing: "Indices manquants",
    ambiguous: "Indices ambigus", novel: "Situation éloignée des exemples", recognized: "Fonctionnement reconnu par les indices" };

/** Current observation only. Reading the dashboard never trains the observer. */
export function projectCues(observer, state, intention, runMode, tracker) {
    const context = createDecisionContext(state, intention), assessment = observer.assess(context);
    const basis = runMode === "shadow" ? "shadow" : assessment.status === "recognized" ? "cues" :
        assessment.status === "learning" ? "effect-history" : "uncertain";
    const belief = basis === "cues" ? { scope: context.key, status: "recognized", modeId: assessment.modeId } :
        basis === "uncertain" ? { scope: context.key, status: "uncertain" } : tracker.belief(state, intention);
    const ledger = observer.policy.snapshot().experiences;
    return { assessment, basis, runMode, atTarget: state.features.value === intention.parameters.target, label: cueStatusLabels[assessment.status],
        modeLabel: observer.policy.mode(assessment.modeId)?.label,
        candidates: assessment.candidates.map(c => ({ ...c, label: observer.policy.mode(c.modeId)?.label,
            examples: c.experienceIds.map(id => {
                const index = ledger.findIndex(e => e.id === id), e = ledger[index];
                if (!e) throw new Error("Missing cue evidence");
                return { id, number: index + 1, before: e.context.state.features.value, after: e.stateAfter.features.value };
            }) })),
        // Other scopes have not been observed now. Do not mark their old beliefs active.
        memoryTracker: { belief(s, i) { return contextKey(s, i) === context.key ? belief : { status: "unknown" }; } } };
}
