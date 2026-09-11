import type { TopologyDefinition, TopologyConfig, TopologyFrame, TopologyPass } from "./topology-types.js";
import { DEFAULT_TOPOLOGY_CONFIG } from "./topology-types.js";
import { DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, type TopologyTemporalConfig } from "./topology-temporal-types.js";
import { TopologyMemory, topologyKey } from "./topology-memory.js";
import { TopologyActivationSession } from "./topology-session.js";
import { TopologyConditionNode, TopologyAndNode, TopologyOrNode } from "./topology-execution.js";
import { TemporalTopologyBranchNode } from "./topology-temporal-cells.js";
import { createTopologyHarness, type TopologyHarnessOptions } from "./topology-nodes.js";
import { immutableCopy } from "./validation.js";

export function validateTopologyTemporalConfig(config: TopologyTemporalConfig): void {
    if (!config || Object.keys(config).some(k => !Object.hasOwn(DEFAULT_TOPOLOGY_TEMPORAL_CONFIG, k)) ||
        config.version !== 1 || !["continuous", "spikes", "spikes-modulated"].includes(config.mode) ||
        ![config.timeConstantSeconds, config.threshold, config.maximumGapSeconds].every(n => Number.isFinite(n) && n > 0) ||
        config.threshold >= config.timeConstantSeconds || !Number.isFinite(config.resetAlpha) ||
        config.resetAlpha < 0 || config.resetAlpha >= 1 || (config.mode !== "spikes-modulated" && config.resetAlpha !== 0))
        throw new Error("Invalid topology temporal configuration");
}
export class TemporalTopologyMemory extends TopologyMemory {
    readonly dynamics: TopologyTemporalConfig;
    readonly branches: ReadonlyArray<TemporalTopologyBranchNode>;
    constructor(definition: TopologyDefinition, dynamics: TopologyTemporalConfig = DEFAULT_TOPOLOGY_TEMPORAL_CONFIG,
        config: TopologyConfig = DEFAULT_TOPOLOGY_CONFIG) {
        validateTopologyTemporalConfig(dynamics);
        const saved = immutableCopy(dynamics);
        super(definition, config, (source, def) => def.kind === "condition" ? new TopologyConditionNode(source, def) :
            def.kind === "and" ? new TopologyAndNode(source, def) :
            def.kind === "or" ? new TopologyOrNode(source, def) : new TemporalTopologyBranchNode(source, def as import("./topology-types.js").TopologyBranch, saved));
        this.dynamics = saved;
        this.branches = Object.freeze(this.graph.nodes.filter((n): n is TemporalTopologyBranchNode => n instanceof TemporalTopologyBranchNode));
    }
    override assertIntact(): void {
        super.assertIntact();
        for (const node of this.branches) node.assertIntact();
    }
}
/** Branch-local dynamics. T1 semantics, arbitration and execution authority remain the reference. */
export class TemporalTopologySession extends TopologyActivationSession {
    declare readonly memory: TemporalTopologyMemory;
    constructor(memory: TemporalTopologyMemory) {
        if (!(memory instanceof TemporalTopologyMemory)) throw new Error("Expected a temporal topology memory");
        super(memory);
        Object.assign(memory.frameSource.state(this.session), { temporalProtocol: "branch-temporal-v1" });
    }
    override activate(frame: TopologyFrame, options: { signal?: AbortSignal; maximumNodeFirings?: number } = {}): TopologyPass {
        const state = this.memory.frameSource.state(this.session);
        if (state.lastKey && topologyKey(frame) !== state.lastKey &&
            frame.observedAtSeconds <= JSON.parse(state.lastKey).observedAtSeconds)
            throw new Error("Topology measurement clock must increase; batch simultaneous measurements");
        const totalBudget = options.maximumNodeFirings ?? this.memory.graph.nodes.length + this.memory.branches.length * 2;
        if (!Number.isSafeInteger(totalBudget) || totalBudget < 1) throw new Error("Invalid topology work budget");
        const attempts = state.attempts;
        try {
            return super.activate(frame, { ...options, maximumNodeFirings: Math.max(1, totalBudget - 2 * this.memory.branches.length) });
        } catch (error) {
            if (state.attempts !== attempts) for (const branch of this.memory.branches) branch.clearAfterFailure(this.session);
            throw error;
        }
    }
    protected override decoratePass(pass: TopologyPass): TopologyPass {
        const branches = this.memory.branches.map(b => b.dynamicsOf(this.session)!);
        const nodeFirings = branches.length * 2, deliveries = branches.length;
        return { ...pass, temporal: { kind: "branch-temporal-v1", config: this.memory.dynamics,
            branches: [...branches].sort((a, b) => a.branchId.localeCompare(b.branchId)),
            integratorNodeFirings: nodeFirings, integratorDeliveries: deliveries },
            work: { ...pass.work, nodeFirings: pass.work.nodeFirings + nodeFirings,
                relationDeliveries: pass.work.relationDeliveries + deliveries,
                spikeEvents: branches.filter(b => b.spiked).length } };
    }
    override inspect() {
        return immutableCopy({ ...super.inspect(), kind: "topology-activation-t2", dynamics: this.memory.dynamics,
            integrators: this.memory.branches.map(b => b.inspectDynamics(this.session)) });
    }
}
/** Experimental comparator: a not-yet-emitting competitor can be hidden from arbitration.
 * See RESULTATS_TOPOLOGIE_T2.md before considering a production integration.
 */
export function createTemporalTopologyHarness(options: Omit<TopologyHarnessOptions, "activation" | "memory"> & { memory: TemporalTopologyMemory }) {
    const activation = new TemporalTopologySession(options.memory);
    return { ...createTopologyHarness({ ...options, activation }), activation };
}
