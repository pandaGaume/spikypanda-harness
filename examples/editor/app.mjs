import "reflect-metadata";
import { RuntimeNode, RuntimeGraph, Channel, Session, Scheduler, isLinkRef, Graph, GraphNode, GraphOLink } from "@spiky-panda/core";
import { GraphViewer, NodeRegistry, LinkRegistry, EditorRegistry, PORT_COLORS, loadPluginFromUrl } from "@spikypanda/nodeeditor";
import * as SpikypandaHarness from "../../packages/harness/dist/index.js";
import { createCounterHarness } from "../counter/harness.mjs";
import { CounterWorld, createCounterRuntime } from "../counter/world.mjs";
import { projectMemory } from "./memory-model.mjs";
import { MemoryView } from "./memory-view.mjs";
import "./style.css";

globalThis.SpikypandaCore = { RuntimeNode, RuntimeGraph, Channel, Session, Scheduler, isLinkRef, Graph, GraphNode, GraphOLink };
globalThis.SpikypandaHarness = SpikypandaHarness;
const { PolicyGraph } = SpikypandaHarness;
const registry = new NodeRegistry();
await loadPluginFromUrl("SpkPluginHarness", "spk.harness", { nodes: registry, links: new LinkRegistry(), editors: new EditorRegistry(),
    url: "./SpkPluginHarness.js", assetUrl: path => new URL(path, location.href).href });
const { HARNESS_NODES, createGraphDriver, parseHarnessDefinition } = globalThis.SpkPluginHarness;
for (const entry of HARNESS_NODES) {
    const sample = new entry.ctor();
    if (!(sample instanceof RuntimeNode)) throw new Error("Plugin loaded a different core instance");
    for (const port of [...sample.inputPorts, ...sample.outputPorts]) PORT_COLORS[port.type] = "#88cbb6";
}

const $ = id => document.getElementById(id);
const viewer = new GraphViewer($("graph"));
viewer.setNodeRegistry(registry);
const memoryView = new MemoryView($("memory-graph"), $("memory-summary"), $("memory-change"), $("memory-history"), $("memory-detail"));
const previousMemories = [];
let intention = createCounterHarness().intention;
let policy = new PolicyGraph();
let world;
let runtime;
let fallback;
let controller;
let running = false;
let traceNumber = 0;
const nodeIds = new Map();
const storageKeys = { harness: "spikypanda.harness.v1", policy: "spikypanda.policy.v1" };
const editControls = ["step", "episode", "train", "target", "add", "empty", "template", "save", "reload", "import-harness", "import-policy", "export-harness", "export-policy", "clear-memory", "restore-memory"];

function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
function rebind() {
    memoryView.reset();
    $("memory-phase").textContent = "En attente du prochain tour";
    world = new CounterWorld();
    world.target = Number(intention.parameters.target);
    ({ runtime, fallback } = createCounterRuntime(policy, world, { delayMs: 140, onStage(event) {
        if (event.status === "start") {
            const phase = { lookup: "Lecture de la mémoire", reason: "La mémoire ne suffit pas : proposition du raisonneur",
                execute: "Action et observation du résultat", record: "Révision de la mémoire après évaluation" }[event.stage];
            if (phase) $("memory-phase").textContent = phase;
        }
        if (event.status !== "error") return;
        for (const node of viewer.nodes) if (node.item.data.stage === event.stage) node.el.classList.add("failed");
        status(`${event.decisionId}: ${event.stage}: ${event.message}`, true);
    } }));
    $("trace").replaceChildren();
    traceNumber = 0;
    update();
}

function intentionFrom(def) {
    const target = def.intention?.parameters?.target;
    if (def.intention.id !== "reach-target" || !Number.isInteger(target) || target < 1 || target > 10) throw new Error("La démo Counter attend reach-target et une cible entière entre 1 et 10");
    return def.intention;
}

function addNode(type, x, y, savedId, enabled = true) {
    const meta = HARNESS_NODES.find(entry => entry.type === type);
    const data = registry.create(type);
    data.enabled = enabled;
    const toPort = port => ({ name: String(port.slot), type: port.type });
    const ui = viewer.addNode({ typeId: type, label: meta.label, category: type.split(":")[0],
        inputs: data.inputPorts.map(toPort), outputs: data.outputPorts.map(toPort), data,
        color: data.stage === "reason" || data.stage === "request" ? "#494362" : "#26453f" }, x, y);
    nodeIds.set(ui, savedId ?? crypto.randomUUID());
    return ui;
}

function loadGraph(value) {
    const def = parseHarnessDefinition(value);
    const nextIntention = intentionFrom(def);
    // Preflight ports before replacing the visible draft.
    for (const edge of def.edges) {
        const from = registry.create(def.nodes.find(n => n.id === edge.from).type);
        const to = registry.create(def.nodes.find(n => n.id === edge.to).type);
        const output = from.outputPorts.find(p => p.slot === edge.output);
        const input = to.inputPorts.find(p => p.slot === edge.input);
        if (!output || !input || output.type !== input.type) throw new Error("Ports incompatibles dans le document importé");
    }
    viewer.clear(); nodeIds.clear();
    intention = nextIntention;
    $("target").value = intention.parameters.target;
    const nodes = new Map(def.nodes.map(saved => [saved.id, addNode(saved.type, saved.x, saved.y, saved.id, saved.enabled !== false)]));
    for (const edge of def.edges) {
        const source = nodes.get(edge.from).outputs.find(p => p.name === edge.output);
        const destination = nodes.get(edge.to).inputs.find(p => p.name === edge.input);
        if (!viewer.connect(source, destination)) throw new Error("Impossible de restaurer un lien");
    }
    requestAnimationFrame(fit);
}

function graphSnapshot() {
    return parseHarnessDefinition({ version: 1, intention,
        nodes: viewer.nodes.map(node => ({ id: nodeIds.get(node), type: node.typeId, x: node.x, y: node.y, enabled: node.item.data.enabled })),
        edges: viewer.connections.map(link => ({
            from: nodeIds.get(viewer.nodes.find(n => n.outputs.includes(link.from))), output: link.from.name,
            to: nodeIds.get(viewer.nodes.find(n => n.inputs.includes(link.to))), input: link.to.name,
        })),
    });
}

function fit() {
    if (!viewer.nodes.length) return;
    const minX = Math.min(...viewer.nodes.map(n => n.x));
    const minY = Math.min(...viewer.nodes.map(n => n.y));
    const width = Math.max(...viewer.nodes.map(n => n.x + n.el.offsetWidth)) - minX;
    const height = Math.max(...viewer.nodes.map(n => n.y + n.el.offsetHeight)) - minY;
    const scale = Math.min(1, (viewer.host.clientWidth - 40) / width, (viewer.host.clientHeight - 40) / height);
    Object.assign(viewer.camera, { scale, x: (viewer.host.clientWidth - width * scale) / 2 - minX * scale,
        y: (viewer.host.clientHeight - height * scale) / 2 - minY * scale });
    viewer.camera.apply(viewer.viewport); viewer.updateConnections();
}

function update(trace) {
    $("value").textContent = world.value;
    $("target-label").textContent = world.target;
    $("dynamics").textContent = world.direction === 1 ? "Dynamique normale : +1 augmente" : "Dynamique inversée : +1 diminue";
    const metrics = runtime.metrics.snapshot();
    $("actions").textContent = metrics.executedActions;
    $("policy-ratio").textContent = `${Math.round(metrics.policyHitRatio * 100)} %`;
    $("fallback-count").textContent = fallback.calls;
    $("success-rate").textContent = `${metrics.executedActions ? Math.round(metrics.successCount / metrics.executedActions * 100) : 0} %`;
    const snapshot = policy.snapshot();
    memoryView.render(projectMemory(policy), trace);
    $("clear-memory").disabled = running || snapshot.experiences.length === 0;
    $("restore-memory").disabled = running || previousMemories.length === 0;
    const experienceCount = snapshot.experiences.length;
    const plural = experienceCount > 1 ? "s" : "";
    $("memory-history-count").textContent = `${Math.min(12, experienceCount)} affichée${plural} sur ${experienceCount} conservée${plural}`;
    $("weights").replaceChildren();
    for (const item of snapshot.transitions) {
        const context = snapshot.contexts.find(c => c.key === item.contextKey);
        const eligible = policy.findCandidateActions(context.state, context.intention).find(c => c.transitionKey === item.key)?.eligible;
        const row = document.createElement("tr");
        const values = [`${context.state.id} / ${context.intention.parameters?.target ?? "?"}`, item.actionId,
            `${Math.round(item.stats.confidence * 100)} %`, item.stats.rewardEma.toFixed(2), `${item.stats.effectiveEvidence}/${policy.plasticity.maximumEffectiveEvidence}`,
            eligible ? "Disponible" : "À réévaluer"];
        values.forEach((value, index) => { const cell = document.createElement("td"); cell.textContent = value; if (index === 5) cell.className = eligible ? "eligible" : "uncertain"; row.append(cell); });
        $("weights").append(row);
    }
    if (!snapshot.transitions.length) { const row = $("weights").insertRow(); const cell = row.insertCell(); cell.colSpan = 6; cell.textContent = "Aucune expérience. Rien n'est consolidé."; }
}

async function step() {
    controller.signal.throwIfAborted();
    const def = graphSnapshot();
    const driver = createGraphDriver(def, (id, stage) => {
        const node = viewer.nodes.find(n => nodeIds.get(n) === id);
        node?.el.classList.add("executed");
        if (stage === "reason" || stage === "request") node?.el.classList.add("reasoned");
        for (const link of viewer.connections.filter(c => node?.inputs.includes(c.to))) {
            const source = viewer.nodes.find(n => n.outputs.includes(link.from));
            if (source?.el.classList.contains("executed")) { link.path.style.stroke = "#75e2ba"; link.path.style.strokeWidth = "3px"; }
        }
    });
    for (const node of viewer.nodes) node.el.classList.remove("executed", "reasoned", "failed");
    for (const link of viewer.connections) { link.path.style.stroke = ""; link.path.style.strokeWidth = ""; }
    if (world.value === world.target) world.reset();
    const trace = await runtime.step(def.intention, controller.signal, driver);
    const item = document.createElement("li");
    item.className = trace.source;
    item.textContent = `${++traceNumber}. ${trace.source === "policy" ? "POLICY" : "RAISONNEUR"} · ${trace.decision.action.id} · ${trace.stateBefore.features.value} → ${trace.stateAfter.features.value} · ${trace.evaluation.success ? "progrès" : "échec observé"}`;
    const id = document.createElement("span"); id.className = "id"; id.textContent = trace.decisionId; item.append(id);
    $("trace").prepend(item);
    while ($("trace").children.length > 30) $("trace").lastChild.remove();
    update(trace);
    $("memory-phase").textContent = "Tour terminé : la prochaine décision relira la mémoire révisée";
    status(`${trace.source === "policy" ? "Rejeu de la policy" : "Proposition du raisonneur"}. ${trace.evaluation.success ? "Progrès confirmé" : "Échec observé, confiance révisée"}. Confiance : ${Math.round(trace.transitionAfter.confidence * 100)} %.`);
    await new Promise(resolve => setTimeout(resolve, $("slow").checked ? 850 : 60));
}

async function run(mode) {
    if (running) return;
    running = true; controller = new AbortController();
    editControls.forEach(id => $(id).disabled = true); $("stop").disabled = false;
    $("graph").classList.add("locked");
    try {
        if (mode === "step") await step();
        else for (let episode = 0; episode < (mode === "train" ? 8 : 1); episode++) {
            world.reset();
            let count = 0;
            do { await step(); count++; } while (world.value !== world.target && count < 20);
            if (world.value !== world.target) throw new Error("Épisode interrompu après 20 actions sans atteindre la cible");
        }
    } catch (error) {
        $("memory-phase").textContent = "Tour interrompu. Les expériences déjà terminées sont conservées.";
        status(error.message, true);
    }
    finally {
        running = false; editControls.forEach(id => $(id).disabled = false); $("stop").disabled = true;
        $("graph").classList.remove("locked"); update();
    }
}

function safely(action) { return async () => { try { await action(); } catch (error) { status(error.message, true); } }; }
for (const mode of ["step", "episode", "train"]) $(mode).onclick = () => run(mode);
$("stop").onclick = () => controller?.abort(new Error("Exécution annulée. Aucun résultat incomplet n'a été appris."));
$("invert").onclick = () => { world.invert(); update(); status("Dynamique inversée. La policy n'a pas été modifiée : les observations suivantes feront foi."); };
$("fit").onclick = fit;
$("clear-memory").onclick = () => {
    previousMemories.push(policy);
    policy = new PolicyGraph(undefined, policy.plasticity);
    rebind();
    status("Nouvelle mémoire vide, monde remis à zéro en dynamique normale. La mémoire précédente reste récupérable et la sauvegarde du navigateur est inchangée.");
};
$("restore-memory").onclick = () => {
    if (!previousMemories.length) return;
    policy = previousMemories.pop();
    rebind();
    status("Mémoire précédente retrouvée. Monde remis à zéro en dynamique normale. La sauvegarde du navigateur est inchangée.");
};
$("target").onchange = safely(() => {
    const next = { ...intention, parameters: { target: Number($("target").value) } };
    intentionFrom({ intention: next }); intention = next; world.target = next.parameters.target; world.revision++; update();
});
for (const entry of HARNESS_NODES) { const option = document.createElement("option"); option.value = entry.type; option.textContent = entry.label; $("node-type").append(option); }
$("add").onclick = () => { const point = viewer.camera.screenToWorld(60, 60); addNode($("node-type").value, point.x, point.y); };
$("empty").onclick = () => { if (confirm("Vider le graphe visible ? La policy sera conservée.")) { viewer.clear(); nodeIds.clear(); status("Graphe vide. Ajoutez les 12 étapes et reliez leurs ports."); } };
$("template").onclick = () => { if (confirm("Remplacer le graphe visible par le modèle Counter ? La policy sera conservée.")) { loadGraph(createCounterHarness()); rebind(); status("Modèle Counter restauré. Policy conservée."); } };
$("save").onclick = safely(() => {
    const graphJson = JSON.stringify(graphSnapshot()); const policyJson = JSON.stringify(policy.snapshot());
    const previous = localStorage.getItem(storageKeys.harness);
    localStorage.setItem(storageKeys.harness, graphJson);
    try { localStorage.setItem(storageKeys.policy, policyJson); }
    catch (error) { if (previous === null) localStorage.removeItem(storageKeys.harness); else localStorage.setItem(storageKeys.harness, previous); throw error; }
    status("Harnais et policy sauvegardés séparément dans ce navigateur.");
});
function reload() {
    const graph = JSON.parse(localStorage.getItem(storageKeys.harness) ?? "null");
    const snapshot = JSON.parse(localStorage.getItem(storageKeys.policy) ?? "null");
    if (!graph || !snapshot) throw new Error("Aucune paire de sauvegardes disponible");
    const restored = PolicyGraph.fromSnapshot(snapshot);
    loadGraph(graph); policy = restored; rebind();
    status("Harnais et policy rechargés. Nouveau runtime, monde remis à 0 et dynamique normale. La mémoire reste plastique.");
}
$("reload").onclick = safely(reload);
function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export-harness").onclick = safely(() => download("counter.harness.json", graphSnapshot()));
$("export-policy").onclick = safely(() => download("counter.policy.json", policy.snapshot()));
for (const kind of ["harness", "policy"]) $("import-" + kind).onchange = safely(async () => {
    const file = $("import-" + kind).files[0]; if (!file) return;
    if (file.size > 10_000_000) throw new Error("Document trop volumineux (limite : 10 Mo)");
    const value = JSON.parse(await file.text());
    if (kind === "harness") loadGraph(value); else policy = PolicyGraph.fromSnapshot(value);
    rebind(); status(`${kind === "harness" ? "Harnais" : "Policy"} importé. Services locaux reconnectés, monde réinitialisé.`);
    $("import-" + kind).value = "";
});

loadGraph(createCounterHarness()); rebind();
if (localStorage.getItem(storageKeys.harness) && localStorage.getItem(storageKeys.policy)) {
    try { reload(); } catch (error) { status(`Sauvegarde non chargée : ${error.message}`, true); }
}
new ResizeObserver(fit).observe($("graph"));
