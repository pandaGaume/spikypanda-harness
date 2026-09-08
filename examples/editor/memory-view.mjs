const SVG_NS = "http://www.w3.org/2000/svg";
const percent = value => `${Math.round(value * 100)} %`;
const counted = (value, noun) => `${value} ${noun}${value > 1 ? "s" : ""}`;
const shorten = value => value.length > 25 ? value.slice(0, 23) + "…" : value;
function svg(tag, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
}
function curve(x1, y1, x2, y2) {
    const middle = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}
function reconcile(map, items, create, update, parent) {
    const ids = new Set(items.map(item => item.id));
    for (const [id, entry] of map) if (!ids.has(id)) { entry.el.remove(); map.delete(id); }
    for (const item of items) {
        let entry = map.get(item.id);
        if (!entry) { entry = create(item); map.set(item.id, entry); parent.append(entry.el); }
        update(entry, item);
    }
}

/** A display of the policy snapshot, not another executable or editable graph. */
export class MemoryView {
    constructor(host, summary, change, history, detail) {
        Object.assign(this, { host, summary, change, history, detail });
        this.nodes = new Map(); this.links = new Map(); this.records = new Map();
        this.drawing = svg("svg", { role: "img", "aria-label": "Graphe de mémoire : contextes, actions et capacités" });
        this.linkLayer = svg("g"); this.nodeLayer = svg("g");
        this.drawing.append(this.linkLayer, this.nodeLayer);
        this.empty = document.createElement("p");
        this.empty.className = "memory-empty";
        this.empty.textContent = "Mémoire vide. Cliquez sur « Un pas » : la première action évaluée créera un contexte, une action, une capacité et une expérience.";
        host.append(this.drawing, this.empty);
    }

    reset() { this.model = undefined; this.selectedId = undefined; }

    render(model, trace) {
        const previous = this.model;
        this.model = model;
        const newest = model.experiences.at(-1);
        if (trace || !model.experiences.some(item => item.id === this.selectedId)) this.selectedId = newest?.id;
        const selected = model.experiences.find(item => item.id === this.selectedId);
        const touched = model.transitions.find(item => item.id === selected?.transitionId);
        const counts = { context: 0, action: 0, capability: 0 };
        const positions = new Map(model.nodes.map(node => {
            const column = { context: 0, action: 1, capability: 2 }[node.kind];
            const index = counts[node.kind]++;
            return [node.id, { x: [24, 472, 720][column], y: 36 + index * 126, width: column === 0 ? 184 : 168 }];
        }));
        const height = Math.max(180, ...Object.values(counts).map(n => 44 + n * 126), 44 + model.transitions.length * 114);
        this.drawing.setAttribute("viewBox", `0 0 912 ${height}`);
        this.drawing.style.display = model.nodes.length ? "" : "none";
        this.empty.hidden = model.nodes.length > 0;
        this.summary.textContent = `${counted(model.contextCount, "contexte")} · ${counted(model.actionCount, "action")} · ${counted(model.transitions.length, "lien")} appris · ${counted(model.experienceCount, "expérience")}`;
        this.drawing.setAttribute("aria-label", `Mémoire : ${this.summary.textContent}. Les liens verts sont rejouables, les pointillés sont à réévaluer.`);

        const edges = [...model.transitions.map((item, index) => ({ ...item, index, kind: "transition" })),
            ...model.bindings.map(item => ({ ...item, kind: "binding" }))];
        reconcile(this.links, edges, item => {
            const el = svg("g", { "data-memory-edge": item.id });
            const path = svg("path", { fill: "none" });
            const title = svg("title"); el.append(title, path);
            const parts = { el, path, title };
            if (item.kind === "transition") {
                parts.box = svg("rect", { width: 224, height: 66, rx: 6 });
                parts.confidence = svg("text", { class: "memory-confidence" });
                parts.replay = svg("text"); parts.audit = svg("text", { class: "memory-audit" });
                el.append(parts.box, parts.confidence, parts.replay, parts.audit);
            }
            return parts;
        }, (entry, item) => {
            const from = positions.get(item.from), to = positions.get(item.to);
            entry.el.classList.toggle("memory-selected", touched?.id === item.id);
            if (item.kind === "binding") {
                entry.el.setAttribute("class", "memory-binding");
                entry.path.setAttribute("d", curve(from.x + from.width, from.y + 46, to.x, to.y + 46));
                entry.title.textContent = "Liaison entre une action et sa capacité";
                return;
            }
            const y = 36 + item.index * 114;
            entry.el.classList.add("memory-transition");
            entry.el.classList.toggle("memory-eligible", item.eligible);
            entry.el.classList.toggle("memory-uncertain", !item.eligible);
            entry.path.setAttribute("d", curve(from.x + from.width, from.y + 46, 232, y + 33) + " " +
                curve(456, y + 33, to.x, to.y + 46));
            entry.path.style.strokeWidth = String(1 + item.stats.confidence * 4);
            entry.box.setAttribute("x", 232); entry.box.setAttribute("y", y);
            for (const [part, offset] of [["confidence", 20], ["replay", 39], ["audit", 56]]) {
                entry[part].setAttribute("x", 244); entry[part].setAttribute("y", y + offset);
            }
            entry.confidence.textContent = `Confiance ${percent(item.stats.confidence)}`;
            entry.replay.textContent = item.eligible ? "Rejeu possible, sous contrôle" : "À réévaluer par le raisonneur";
            entry.audit.textContent = `${item.stats.totalSuccessCount} progrès · ${counted(item.stats.totalFailureCount, "échec")}`;
            entry.title.textContent = `Entrée : ${item.input}. Récompense moyenne : ${item.stats.rewardEma.toFixed(2)}. Tous ces indicateurs sont révisables.`;
        }, this.linkLayer);

        reconcile(this.nodes, model.nodes, item => {
            const el = svg("g", { "data-memory-node": item.id });
            const rect = svg("rect", { height: 92, rx: 9 });
            const kind = svg("text", { x: 14, y: 21, class: "memory-kind" });
            const label = svg("text", { x: 14, y: 46, class: "memory-label" });
            const detail = svg("text", { x: 14, y: 70, class: "memory-audit" });
            el.append(svg("title", {}, `${item.label} · ${item.detail}`), rect, kind, label, detail);
            return { el, rect, kind, label, detail };
        }, (entry, item) => {
            const point = positions.get(item.id);
            entry.el.setAttribute("transform", `translate(${point.x} ${point.y})`);
            entry.el.setAttribute("class", `memory-node memory-${item.kind}`);
            entry.el.classList.toggle("memory-selected", !!touched && [touched.from, touched.to, touched.capability].includes(item.id));
            entry.el.classList.toggle("memory-new", !!trace && !previous?.nodes.some(n => n.id === item.id));
            entry.rect.setAttribute("width", point.width);
            entry.kind.textContent = { context: "CONTEXTE", action: "ACTION", capability: "CAPACITÉ" }[item.kind];
            entry.label.textContent = shorten(item.label); entry.detail.textContent = shorten(item.detail);
        }, this.nodeLayer);

        reconcile(this.records, model.experiences, item => {
            const el = document.createElement("button");
            el.type = "button"; el.dataset.experience = item.id;
            el.onclick = () => { this.selectedId = item.id; this.render(this.model); };
            return { el };
        }, (entry, item) => {
            entry.el.className = `memory-record ${item.success ? "success" : "failure"}`;
            entry.el.textContent = `#${item.number} · ${item.before} → ${item.after} · ${item.success ? "progrès" : "échec"}`;
            entry.el.setAttribute("aria-pressed", String(item.id === this.selectedId));
            entry.el.setAttribute("aria-label", `Expérience ${item.number}, ${item.action}, ${item.before} vers ${item.after}, ${item.success ? "progrès" : "échec"}, par ${item.source}`);
        }, this.history);
        this.detail.textContent = selected
            ? `Expérience #${selected.number} : ${selected.context.label.toLowerCase()}, ${selected.context.detail.toLowerCase()} ; ${selected.action.toLowerCase()} choisie par ${selected.source}. Résultat : ${selected.before} → ${selected.after}. Le lien concerné est encadré, avec sa confiance actuelle.`
            : "Les expériences apparaîtront ici après leur évaluation.";
        if (trace && newest) {
            const current = model.transitions.find(item => item.id === newest.transitionId);
            const old = previous?.transitions.find(item => item.id === newest.transitionId);
            this.change.textContent = old
                ? `Tour ${newest.number} : ${newest.action.toLowerCase()}, ${newest.success ? "progrès" : "échec"}. Confiance révisée : ${percent(old.stats.confidence)} → ${percent(current.stats.confidence)}. Le prochain tour relira cette mémoire.`
                : `Tour ${newest.number} : nouveau lien appris pour ${newest.action.toLowerCase()}. Confiance initiale après observation : ${percent(current.stats.confidence)}. Ce n'est pas un acquis définitif.`;
        } else if (!previous) {
            this.change.textContent = model.experienceCount
                ? "Mémoire existante affichée. Relancer le flux permettra de la renforcer ou de la remettre en question."
                : "Aucun lien appris. Le harnais existe déjà ; sa mémoire reste à construire.";
        }
    }
}
