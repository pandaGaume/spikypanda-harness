import { cueStatusLabels } from "./cue-model.mjs";
function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
}
const decimal = n => n === null ? "absent" : n.toFixed(3);
export class CueView {
    constructor(host) { this.host = host; }
    reset() { this.lastDecision = undefined; }
    render(model, trace) {
        if (trace?.cues) this.lastDecision = trace;
        const a = model.assessment;
        const heading = element("div", undefined, "cue-heading");
        heading.append(element("strong", model.atTarget ? "Cible atteinte : prochain départ à observer" : model.label), element("span", model.modeLabel ? "Hypothèse : " + model.modeLabel : "Aucune reconnaissance"));
        const features = element("div", undefined, "cue-features");
        for (const f of a.features) {
            const item = element("div", undefined, "cue-feature");
            item.append(element("strong", f.id), element("span", decimal(f.value), "cue-value"),
                element("small", "Poids discriminant appris : " + Math.round(f.relevance * 100) + " %"),
                element("code", f.sourceRef));
            features.append(item);
        }
        const candidates = element("div", undefined, "cue-candidates");
        for (const c of model.candidates) {
            const card = element("div", undefined, "cue-candidate" + (c.modeId === a.modeId ? " selected" : ""));
            card.append(element("strong", "→ " + c.label + " · distance " + decimal(c.distance)),
                element("p", "Exemples proches : " + c.examples.map(e => "#" + e.number + " (" + e.before + " → " + e.after + ")").join(", "), "hint"));
            candidates.append(card);
        }
        if (!model.candidates.length) candidates.append(element("p", "Pas encore de comparaison exploitable entre fonctionnements.", "hint"));
        const behavior = { shadow: "Observation seule : les indices sont journalisés, la décision conserve la logique V2.",
            cues: "Actif : cette hypothèse guide la lecture de la mémoire. La fiabilité et les autorisations restent vérifiées.",
            "effect-history": "Actif, apprentissage initial : les effets observés guident encore la décision, comme en V2.",
            uncertain: "Actif, indices insuffisants : aucun rejeu direct, le raisonneur doit proposer une action." }[model.basis];
        const details = element("details");
        details.append(element("summary", "Valeurs encodées et provenance"));
        details.append(element("p", "Encodage : " + a.embedding.map(decimal).join(", ") + " · couverture " +
            Math.round(a.coverage * 100) + " % · révision " + a.modelRevision, "hint"));
        details.append(element("p", "Encodeur : " + a.encoder + ". Chaque exemple cité est une expérience antérieure réelle. Les poids ci-dessus ne sont pas la fiabilité des actions.", "hint"));
        const last = this.lastDecision;
        const basisLabels = { cues: "indices utilisés", shadow: "observation seule", "effect-history": "effets V2", uncertain: "rejeu suspendu" };
        const history = element("p", last ? "Dernière décision : " + cueStatusLabels[last.cues.assessment.status] + " / " + basisLabels[last.cues.basis] +
            " → " + last.decision.action.id + " → " + (last.evaluation.success ? "progrès" : "échec") +
            ". L'évaluation ci-dessus concerne l'observation actuelle, après ce résultat." : "Aucune décision observée dans cette session.", "hint");
        this.host.replaceChildren(heading, features, candidates, element("p", behavior, "cue-behavior"), details, history);
    }
}
