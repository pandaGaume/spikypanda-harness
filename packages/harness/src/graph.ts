import { RuntimeGraphBuilder, Scheduler, type Channel, type RuntimeGraph } from "@spiky-panda/core";
import { immutableCopy, validateIntention } from "./validation.js";
import type { HarnessDriver, NodeObserver } from "./contracts.js";
import type { Intention } from "./model.js";
import { HarnessNode, StateObserverNode, ExperienceRecorderNode, createHarnessNode, type HarnessNodeFactory } from "./nodes.js";

export interface HarnessDefinition {
    readonly version: 1;
    readonly intention: Intention;
    readonly nodes: ReadonlyArray<{ id: string; type: string; x: number; y: number; enabled?: boolean }>;
    readonly edges: ReadonlyArray<{ from: string; output: string; to: string; input: string }>;
}

/** A host may provide factories for trusted subclasses; code is never loaded from JSON. */
export function parseHarnessDefinition(value: unknown, factory: HarnessNodeFactory = createHarnessNode): HarnessDefinition {
    const def = immutableCopy(value) as HarnessDefinition;
    if (!def || def.version !== 1 || !def.intention?.id || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) throw new Error("Invalid harness document");
    validateIntention(def.intention);
    if (Object.keys(def).some(k => !["version", "intention", "nodes", "edges"].includes(k))) throw new Error("Harness documents cannot contain runtime services or policy data");
    const ids = new Set<string>();
    for (const node of def.nodes) {
        if (!node.id || typeof node.id !== "string" || ids.has(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error("Invalid or duplicate node");
        if (Object.keys(node).some(k => !["id", "type", "x", "y", "enabled"].includes(k))) throw new Error("Unexpected node configuration");
        if (typeof node.type !== "string" || !node.type) throw new Error("Invalid node type");
        if (node.enabled !== undefined && typeof node.enabled !== "boolean") throw new Error("Invalid enabled state");
        if (!(factory(node.type) instanceof HarnessNode)) throw new Error("Factory must return a HarnessNode");
        ids.add(node.id);
    }
    const edgeKeys = new Set<string>();
    for (const edge of def.edges) {
        const key = JSON.stringify([edge.from, edge.output, edge.to, edge.input]);
        if (edgeKeys.has(key)) throw new Error("Invalid duplicate edge");
        edgeKeys.add(key);
        if (!ids.has(edge.from) || !ids.has(edge.to) || typeof edge.input !== "string" || typeof edge.output !== "string") throw new Error("Invalid graph endpoint");
        if (Object.keys(edge).some(k => !["from", "to", "input", "output"].includes(k))) throw new Error("Unexpected edge configuration");
    }
    return def;
}

/** A core graph type, not an alternative graph implementation. */
export type HarnessGraph = RuntimeGraph<HarnessNode, Channel>;

/** Validate the harness contract for graphs built in code or imported from JSON. */
export function validateHarnessGraph(graph: HarnessGraph): void {
    const { nodes, links } = graph;
    if (graph.mode !== "static") throw new Error("Harness execution requires a static graph");
    if (nodes.some(node => !(node instanceof HarnessNode))) throw new Error("Graph must contain HarnessNodes");
    if (new Set(nodes).size !== nodes.length || new Set(nodes.map(n => n.id)).size !== nodes.length) throw new Error("Duplicate node instance or ID");
    if (nodes.some(node => !node.enabled)) throw new Error("Disabled required node: re-enable every node before executing");
    for (const node of nodes) for (const ports of [node.inputPorts, node.outputPorts]) {
        if (new Set(ports.map(p => p.slot)).size !== ports.length || ports.some(p => typeof p.slot !== "string" || !p.slot || typeof p.type !== "string" || !p.type)) {
            throw new Error("Invalid or duplicate node port");
        }
    }
    for (const link of links) {
        if (!link.enabled || link.delayed) throw new Error("Disabled or delayed channels are not supported");
        const from = nodes.find(n => n === link.oini), to = nodes.find(n => n === link.ofin);
        if (!from || !to) throw new Error("Invalid graph endpoint");
        const output = from.outputPorts.find(p => p.slot === link.slot);
        const input = to.inputPorts.find(p => p.slot === link.toSlot);
        if (!output || !input || input.type !== output.type) throw new Error("Incompatible harness ports");
    }
    for (const node of nodes) {
        for (const port of node.inputPorts) {
            if (links.filter(l => l.ofin === node && l.toSlot === port.slot).length !== 1) throw new Error(`Missing or duplicate input: ${node.stage}.${port.slot}`);
        }
        for (const port of node.outputPorts) {
            if (links.filter(l => l.oini === node && l.slot === port.slot).length !== 1) throw new Error(`Missing or duplicate output: ${node.stage}.${port.slot}`);
        }
    }
    const sources = nodes.filter(n => !n.inputPorts.length), sinks = nodes.filter(n => !n.outputPorts.length);
    if (sources.length !== 1 || !(sources[0] instanceof StateObserverNode) || sinks.length !== 1 || !(sinks[0] instanceof ExperienceRecorderNode)) {
        throw new Error("A decision graph requires one observation source and one experience sink");
    }
    Scheduler.GetStaticOrder(graph);
}

/** Materialize document topology with the core builder, then validate harness constraints. */
export function compileHarnessGraph(value: unknown, factory: HarnessNodeFactory = createHarnessNode): HarnessGraph {
    const def = parseHarnessDefinition(value, factory);
    const nodes = def.nodes.map(saved => {
        const node = factory(saved.type);
        if (!(node instanceof HarnessNode)) throw new Error("Factory must return a HarnessNode");
        node.id = saved.id; node.type = saved.type; node.enabled = saved.enabled !== false;
        return node;
    });
    if (new Set(nodes).size !== nodes.length) throw new Error("Factory reused a node instance");
    const byId = new Map(nodes.map(node => [String(node.id), node]));
    const builder = new RuntimeGraphBuilder<HarnessNode, Channel>().withMode("static").withNodes(...nodes);
    for (const edge of def.edges) builder.withChannel(byId.get(edge.from)!, byId.get(edge.to)!, edge.output, edge.input);
    const graph = builder.build();
    validateHarnessGraph(graph);
    return graph;
}

/** Use a host-built core graph directly, without a JSON round trip. */
export function createRuntimeGraphDriver(graph: HarnessGraph, onNode?: NodeObserver): HarnessDriver {
    validateHarnessGraph(graph);
    return (runtime, frame) => runtime.executeGraph(graph, frame, onNode);
}

export function createGraphDriver(value: unknown, onNode?: NodeObserver, factory: HarnessNodeFactory = createHarnessNode): HarnessDriver {
    return createRuntimeGraphDriver(compileHarnessGraph(value, factory), onNode);
}
