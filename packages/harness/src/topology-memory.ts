import { GraphBuilder, GraphNode, GraphOLink, RuntimeGraphBuilder, Scheduler, type RuntimeGraph, type Channel } from "@spiky-panda/core";
import { immutableCopy, validateDecision, assertJson } from "./validation.js";
import { stableStringify } from "./canonical.js";
import type { JsonValue } from "./model.js";
import { DEFAULT_TOPOLOGY_CONFIG, type TopologyConfig, type TopologyDefinition, type TopologyNodeDefinition, type TopologyBranch } from "./topology-types.js";
import { TopologyFrameSource, TopologyRuntimeNode, TopologyConditionNode, TopologyAndNode, TopologyOrNode, TopologyBranchNode } from "./topology-execution.js";

export const topologyKey = (value: unknown): string => stableStringify(value as JsonValue);
const identifier = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !v.startsWith("$");
const objectKeys = (v: unknown, allowed: string[]): void => {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k))) throw new Error("Invalid topology fields");
};
export function validateTopologyConfig(config: TopologyConfig): void {
    objectKeys(config, Object.keys(DEFAULT_TOPOLOGY_CONFIG));
    if (![config.minimumSupport, config.minimumMargin, config.minimumConfidence].every(n => Number.isFinite(n) && n > 0 && n <= 1) ||
        !Number.isFinite(config.maximumObservationAgeSeconds) || config.maximumObservationAgeSeconds < 0 ||
        ![config.maximumNodes, config.maximumEdges, config.maximumPasses].every(n => Number.isSafeInteger(n) && n > 0) ||
        config.maximumNodes > 1024 || config.maximumEdges > 8192 || config.maximumPasses > 100000) throw new Error("Invalid topology limits");
}
export function validateTopologyDefinition(value: TopologyDefinition, config: TopologyConfig): void {
    assertJson(value);
    objectKeys(value, ["version", "revision", "schemaVersion", "contextKey", "nodes", "edges"]);
    if (value.version !== 1 || !identifier(value.revision) || !identifier(value.schemaVersion) ||
        typeof value.contextKey !== "string" || !value.contextKey || !Array.isArray(value.nodes) || !Array.isArray(value.edges) ||
        !value.nodes.length || value.nodes.length > config.maximumNodes || value.edges.length > config.maximumEdges) throw new Error("Invalid topology definition or budget");
    const ids = new Map<string, TopologyNodeDefinition>();
    for (const n of value.nodes) {
        if (!identifier(n?.id) || ids.has(n.id)) throw new Error("Invalid or duplicate topology node");
        if (n.kind === "condition") {
            objectKeys(n, ["id", "kind", "path", "center", "tolerance", "vetoOnMismatch"]);
            if (!Array.isArray(n.path) || !n.path.length || n.path.length > 8 || n.path.some((p: string) =>
                !identifier(p) || ["__proto__", "prototype", "constructor"].includes(p)) ||
                !Number.isFinite(n.center) || !Number.isFinite(n.tolerance) || n.tolerance <= 0 ||
                (n.vetoOnMismatch !== undefined && typeof n.vetoOnMismatch !== "boolean")) throw new Error("Invalid topology condition");
        } else if (n.kind === "and" || n.kind === "or" || n.kind === "branch") {
            objectKeys(n, n.kind === "branch" ? ["id", "kind", "inputs", "decision", "stats", "experienceIds"] : ["id", "kind", "inputs"]);
            if (!Array.isArray(n.inputs) || !n.inputs.length || n.inputs.length > 32 || new Set(n.inputs).size !== n.inputs.length ||
                n.inputs.some((p: string) => !identifier(p) || p.startsWith("_"))) throw new Error("Invalid topology input slots");
            if (n.kind === "branch") {
                if (topologyKey(n.inputs) !== '["support"]') throw new Error("A branch requires one support input");
                validateDecision(n.decision);
                if (Object.hasOwn(n.decision, "source")) throw new Error("A memory proposal cannot declare a decision source");
                objectKeys(n.stats, ["totalUsageCount", "totalSuccessCount", "totalFailureCount", "rewardEma", "confidence", "effectiveEvidence",
                    "consecutiveFailures", "directEligible", "lastUsedAt"]);
                const s = n.stats;
                if (![s.totalUsageCount, s.totalSuccessCount, s.totalFailureCount, s.consecutiveFailures].every(v => Number.isSafeInteger(v) && v >= 0) ||
                    s.totalSuccessCount + s.totalFailureCount !== s.totalUsageCount || s.consecutiveFailures > s.totalFailureCount ||
                    !Number.isFinite(s.rewardEma) || Math.abs(s.rewardEma) > 1 || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1 ||
                    !Number.isFinite(s.effectiveEvidence) || s.effectiveEvidence < 0 || s.effectiveEvidence > s.totalUsageCount ||
                    typeof s.directEligible !== "boolean" || (s.lastUsedAt !== undefined && !Number.isFinite(s.lastUsedAt))) throw new Error("Invalid branch statistics");
                if (!Array.isArray(n.experienceIds) || new Set(n.experienceIds).size !== n.experienceIds.length ||
                    n.experienceIds.some((id: string) => !identifier(id)) || (s.directEligible && !n.experienceIds.length)) throw new Error("Invalid branch provenance");
            }
        } else throw new Error("Unknown topology node kind");
        ids.set(n.id, n);
    }
    if (!value.nodes.some(n => n.kind === "condition") || !value.nodes.some(n => n.kind === "branch")) throw new Error("Topology needs conditions and branches");
    const edgeIds = new Set<string>(), destinations = new Set<string>();
    for (const edge of value.edges) {
        objectKeys(edge, ["id", "from", "to", "input"]);
        const from = ids.get(edge.from), to = ids.get(edge.to), slot = topologyKey([edge.to, edge.input]);
        if (!identifier(edge.id) || edgeIds.has(edge.id) || !from || !to || from.kind === "branch" || to.kind === "condition" ||
            !to.inputs.includes(edge.input) || destinations.has(slot)) throw new Error("Invalid topology relation or duplicate producer");
        edgeIds.add(edge.id); destinations.add(slot);
    }
}
export type TopologyNodeFactory = (source: TopologyFrameSource, definition: TopologyNodeDefinition) => TopologyRuntimeNode;
const createTopologyNode: TopologyNodeFactory = (source, def) => def.kind === "condition" ? new TopologyConditionNode(source, def) :
    def.kind === "and" ? new TopologyAndNode(source, def) :
    def.kind === "or" ? new TopologyOrNode(source, def) : new TopologyBranchNode(source, def as TopologyBranch);

class MemoryElement extends GraphNode {
    constructor(readonly definition: TopologyNodeDefinition) { super(); this.id = definition.id; this.type = "Harness.Topology:" + definition.kind; }
}
/** Immutable knowledge snapshot and its Core projections; activation state is elsewhere. */
export class TopologyMemory {
    readonly definition: TopologyDefinition;
    readonly config: TopologyConfig;
    readonly frameSource = new TopologyFrameSource();
    readonly graph: RuntimeGraph<TopologyRuntimeNode | TopologyFrameSource, Channel>;
    readonly memoryGraph;
    private readonly nodeRefs;
    private readonly linkRefs;
    private readonly shape: string;
    constructor(definition: TopologyDefinition, config: TopologyConfig = DEFAULT_TOPOLOGY_CONFIG, factory: TopologyNodeFactory = createTopologyNode) {
        validateTopologyConfig(config); this.config = immutableCopy(config);
        this.definition = immutableCopy(definition); validateTopologyDefinition(this.definition, this.config);
        const savedNodes = this.definition.nodes.map(n => new MemoryElement(n));
        const saved = new Map(savedNodes.map(n => [String(n.id), n]));
        const data = new GraphBuilder<MemoryElement, GraphOLink>().withNodes(...savedNodes);
        for (const edge of this.definition.edges) {
            const link = new GraphOLink(saved.get(edge.from)!, saved.get(edge.to)!); link.id = edge.id;
            data.withLinks(link);
        }
        this.memoryGraph = data.build();
        this.frameSource.id = "$observation";
        const nodes = this.definition.nodes.map(def => {
            const node = factory(this.frameSource, def);
            if (!(node instanceof TopologyRuntimeNode) || node.frameSource !== this.frameSource || node.definition !== def)
                throw new Error("Foreign topology node factory result");
            node.id = def.id; return node;
        });
        if (new Set(nodes).size !== nodes.length) throw new Error("Topology factory reused a node");
        const byId = new Map(nodes.map(n => [String(n.id), n]));
        const builder = new RuntimeGraphBuilder<TopologyRuntimeNode | TopologyFrameSource, Channel>()
            .withMode("static").withNodes(this.frameSource, ...nodes);
        for (const n of nodes) if (n instanceof TopologyConditionNode) builder.withChannel(this.frameSource, n, "support", "frame");
        for (const edge of this.definition.edges) builder.withChannel(byId.get(edge.from)!, byId.get(edge.to)!, "support", edge.input);
        this.graph = builder.build();
        for (const link of this.graph.links) {
            const edge = this.definition.edges.find(e => e.from === link.oini?.id && e.to === link.ofin?.id && e.input === link.toSlot);
            link.id = edge?.id ?? "$observation:" + link.ofin!.id;
        }
        Scheduler.GetStaticOrder(this.graph);
        this.nodeRefs = [...this.graph.nodes]; this.linkRefs = [...this.graph.links]; this.shape = this.graphShape();
    }
    private graphShape(): string {
        return topologyKey({ mode: this.graph.mode, nodes: this.graph.nodes.map(n => ({
            id: n.id, enabled: n.enabled, inputs: n.inputPorts, outputs: n.outputPorts,
            definition: n instanceof TopologyRuntimeNode ? n.definition : null,
        })), edges: this.graph.links.map(e => ({ id: e.id, from: e.oini?.id, to: e.ofin?.id,
            slot: e.slot, input: e.toSlot, enabled: e.enabled, delayed: e.delayed })) });
    }
    assertIntact(): void {
        if (this.nodeRefs.length !== this.graph.nodes.length || this.linkRefs.length !== this.graph.links.length ||
            !this.nodeRefs.every((n, i) => n === this.graph.nodes[i]) || !this.linkRefs.every((n, i) => n === this.graph.links[i]) ||
            this.shape !== this.graphShape()) throw new Error("Topology projection changed: construct an explicit memory revision");
    }
}
