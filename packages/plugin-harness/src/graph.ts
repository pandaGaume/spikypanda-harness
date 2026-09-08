import { Channel, RuntimeGraph, Session, Scheduler, isLinkRef } from "@spiky-panda/core";
import { immutableCopy, validateIntention, type HarnessDriver, type Intention, type HarnessStage } from "@spiky-panda/harness";
import { HARNESS_NODES, createHarnessNode } from "./nodes.js";

export interface HarnessDefinition {
    readonly version: 1;
    readonly intention: Intention;
    readonly nodes: ReadonlyArray<{ id: string; type: string; x: number; y: number; enabled?: boolean }>;
    readonly edges: ReadonlyArray<{ from: string; output: string; to: string; input: string }>;
}

/** This milestone supports one acyclic decision, repeated by the host for an episode. */
export function parseHarnessDefinition(value: unknown): HarnessDefinition {
    const def = immutableCopy(value) as HarnessDefinition;
    if (!def || def.version !== 1 || !def.intention?.id || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) throw new Error("Invalid harness document");
    validateIntention(def.intention);
    if (Object.keys(def).some(k => !["version", "intention", "nodes", "edges"].includes(k))) throw new Error("Harness documents cannot contain runtime services or policy data");
    const ids = new Set<string>();
    for (const node of def.nodes) {
        if (!node.id || typeof node.id !== "string" || ids.has(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error("Invalid or duplicate node");
        if (Object.keys(node).some(k => !["id", "type", "x", "y", "enabled"].includes(k))) throw new Error("Unexpected node configuration");
        if (node.enabled !== undefined && typeof node.enabled !== "boolean") throw new Error("Invalid enabled state");
        createHarnessNode(node.type);
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

function compile(def: HarnessDefinition) {
    const nodes = def.nodes.map(saved => { const node = createHarnessNode(saved.type); node.id = saved.id; node.enabled = saved.enabled !== false; return node; });
    if (nodes.some(node => !node.enabled)) throw new Error("Disabled required stage: re-enable every node before executing");
    if (nodes.length !== HARNESS_NODES.length || new Set(nodes.map(n => n.stage)).size !== HARNESS_NODES.length) throw new Error("Executable harness requires exactly one node of each of the 12 stages");
    const links = def.edges.map(edge => {
        const from = nodes.find(n => n.id === edge.from)!;
        const to = nodes.find(n => n.id === edge.to)!;
        const output = from.outputPorts.find(p => p.slot === edge.output);
        const input = to.inputPorts.find(p => p.slot === edge.input);
        if (!output || !input || input.type !== output.type) throw new Error("Incompatible harness ports");
        if (to.stage === "merge" && ((from.stage === "gate") !== (edge.input === "policy"))) throw new Error("Inverted merge branch");
        return new Channel(from, to, edge.output, false, undefined, true, edge.input);
    });
    for (const node of nodes) {
        for (const port of node.inputPorts) {
            if (links.filter(l => l.ofin === node && l.toSlot === port.slot).length !== 1) throw new Error(`Missing or duplicate input: ${node.stage}.${port.slot}`);
        }
        for (const port of node.outputPorts) {
            if (links.filter(l => l.oini === node && l.slot === port.slot).length !== 1) throw new Error(`Missing or duplicate output: ${node.stage}.${port.slot}`);
        }
    }
    const graph = new RuntimeGraph(nodes, links, "static");
    Scheduler.GetStaticOrder(graph);
    return graph;
}

/** Core's current runAsync visits nodes but leaves publish events queued. Deliver via
 * its public Session API; retain its buffers, readiness checks and topological scheduler. */
class AsyncDeliverySession extends Session {
    public override publish(index: number, value: unknown): void {
        super.publish(index, value);
        for (const item of this.queue.splice(0)) {
            if (!isLinkRef(item)) throw new Error("Unexpected async scheduler event");
            this.deliverLinkRef(item);
        }
    }
}

export function createGraphDriver(value: unknown, onNode?: (id: string, stage: HarnessStage) => void): HarnessDriver {
    const definition = parseHarnessDefinition(value);
    compile(definition); // Reject invalid wiring before even opening a runtime session.
    return async (runtime, frame) => {
        const graph = compile(definition);
        for (const node of graph.nodes) node.bag = { runtime, frame, onNode };
        await graph.runAsync(0, new AsyncDeliverySession(graph));
    };
}

export function createCounterHarness(): HarnessDefinition {
    const positions = [[30, 40], [280, 40], [530, 40], [780, 40], [780, 240], [1040, 240],
        [1040, 40], [1300, 40], [1560, 40], [1560, 430], [1300, 430], [1040, 430]];
    const nodes = HARNESS_NODES.map((entry, i) => ({ id: new entry.ctor().stage, type: entry.type, x: positions[i][0], y: positions[i][1] }));
    const edges = [
        ["observe", "state", "context", "state"], ["context", "context", "lookup", "context"],
        ["lookup", "candidates", "gate", "candidates"], ["gate", "policy", "merge", "policy"],
        ["gate", "fallback", "request", "fallback"], ["request", "request", "reason", "request"],
        ["reason", "decision", "merge", "reasoning"], ["merge", "decision", "guard", "decision"],
        ["guard", "authorized", "execute", "authorized"], ["execute", "result", "observe-after", "result"],
        ["observe-after", "outcome", "evaluate", "outcome"], ["evaluate", "experience", "record", "experience"],
    ].map(([from, output, to, input]) => ({ from, output, to, input }));
    return { version: 1, intention: { id: "reach-target", parameters: { target: 3 } }, nodes, edges };
}
