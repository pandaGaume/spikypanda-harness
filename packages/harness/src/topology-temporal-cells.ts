import { RuntimeGraphBuilder, RuntimeNode, LifNeuronNode, Session,
    type INodeState, type ISession, type ISpike } from "@spiky-panda/core";
import { TopologyBranchNode, type TopologyFrameSource } from "./topology-execution.js";
import type { TopologyBranch, TopologySignal } from "./topology-types.js";
import type { TopologyTemporalConfig, TopologyBranchDynamics } from "./topology-temporal-types.js";
import { immutableCopy } from "./validation.js";

const port = (slot: string) => ({ slot, type: "spike", optional: false, kind: "stream" as const, capacity: 1 });
interface InputState extends INodeState { charge: number; rate: number; }
class ChargeSource extends RuntimeNode {
    readonly inputPorts = [];
    readonly outputPorts = [port("spike")];
    createNodeState(): InputState { return { linksReady: 0, charge: 0, rate: 0 }; }
    override reset(session: ISession): void { Object.assign(session.nodeStateOf(this)!, { charge: 0, rate: 0 }); }
    override fire(session: ISession, t: number): void {
        const s = session.nodeStateOf(this) as InputState;
        this.publishAll(session, "spike", { timestamp: t, amplitude: s.charge, rate: s.rate, source: this });
    }
}
class ZeroResetCell extends LifNeuronNode {
    override readonly inputPorts = [port("spike")];
    override readonly outputPorts = [];
}
class ContinuousCell extends ZeroResetCell {}
class ModulatedResetCell extends ZeroResetCell {
    constructor(readonly alpha: number) { super(); }
    override fire(session: ISession, t: number): void {
        const input = this.inputChannels("spike")[0];
        const token = session.peek(this.channelIndex(session, input)) as ISpike & { rate: number };
        if (!token || token.timestamp !== t || !Number.isFinite(token.rate) || token.rate < 0 || token.rate > 1)
            throw new Error("Invalid topology reset evidence");
        const state = this.stateOf(session)!, before = state.spikeCount;
        super.fire(session, t);
        if (state.spikeCount !== before) state.membranePotential = this.threshold * this.alpha * token.rate;
    }
}
type BaseState = ReturnType<TopologyBranchNode["createNodeState"]>;
interface BranchState extends BaseState {
    integrator: Session;
    previousRate: number;
    lastObserved: number | null;
    lastDynamics: TopologyBranchDynamics | null;
    integratorFirings: number;
    totalSpikes: number;
    resets: number;
    failureResets: number;
}
/** The nested Core unit is part of this branch's implementation, not a regime classifier.
 * Its Session is owned by this branch's INodeState. Both graphs are inspectable.
 */
export class TemporalTopologyBranchNode extends TopologyBranchNode {
    readonly source = new ChargeSource();
    readonly neuron: LifNeuronNode;
    readonly integratorGraph;
    private readonly integratorShape: string;
    private readonly integratorNodes;
    private readonly integratorLinks;
    constructor(source: TopologyFrameSource, definition: TopologyBranch, readonly dynamics: TopologyTemporalConfig) {
        super(source, definition);
        this.source.id = definition.id + ":charge";
        this.neuron = dynamics.mode === "continuous" ? new ContinuousCell() :
            dynamics.mode === "spikes" ? new ZeroResetCell() : new ModulatedResetCell(dynamics.resetAlpha);
        this.neuron.id = definition.id + ":lif";
        this.neuron.membraneTimeConstant = dynamics.timeConstantSeconds;
        this.neuron.threshold = dynamics.mode === "continuous" ? Number.MAX_VALUE : dynamics.threshold;
        this.neuron.refractoryPeriod = 0;
        this.integratorGraph = new RuntimeGraphBuilder().withMode("static").withNodes(this.source, this.neuron)
            .withChannel(this.source, this.neuron, "spike", "spike").build();
        this.integratorNodes = [...this.integratorGraph.nodes]; this.integratorLinks = [...this.integratorGraph.links];
        this.integratorShape = this.shape();
    }
    private shape(): string {
        return JSON.stringify({ mode: this.integratorGraph.mode, nodes: this.integratorGraph.nodes.map(n => ({
            id: n.id, enabled: n.enabled, input: (n as ChargeSource | LifNeuronNode).inputPorts, output: (n as ChargeSource | LifNeuronNode).outputPorts,
        })), edges: this.integratorGraph.links.map(l => ({ from: l.oini?.id, to: l.ofin?.id, slot: l.slot,
            input: l.toSlot, enabled: l.enabled, delayed: l.delayed })),
        lif: [this.neuron.restingPotential, this.neuron.initialPotential, this.neuron.threshold, this.neuron.resetPotential,
            this.neuron.membraneTimeConstant, this.neuron.refractoryPeriod, this.neuron.spikeAmplitude],
        dynamics: this.dynamics, alpha: this.neuron instanceof ModulatedResetCell ? this.neuron.alpha : 0 });
    }
    assertIntact(): void {
        if (this.shape() !== this.integratorShape || this.integratorNodes.length !== this.integratorGraph.nodes.length ||
            this.integratorLinks.length !== this.integratorGraph.links.length ||
            !this.integratorNodes.every((n, i) => this.integratorGraph.nodes[i] === n) ||
            !this.integratorLinks.every((l, i) => this.integratorGraph.links[i] === l)) throw new Error("Topology integrator projection changed");
    }
    override createNodeState(): BranchState {
        return { ...super.createNodeState(), integrator: new Session(this.integratorGraph), previousRate: 0,
            lastObserved: null, lastDynamics: null, integratorFirings: 0, totalSpikes: 0, resets: 0, failureResets: 0 };
    }
    override reset(session: ISession): void {
        super.reset(session);
        const state = this.local(session);
        state.integrator.reset();
        Object.assign(state, { previousRate: 0, lastObserved: null, lastDynamics: null,
            integratorFirings: 0, totalSpikes: 0, resets: 0, failureResets: 0 });
    }
    private local(session: ISession): BranchState { return session.nodeStateOf(this) as BranchState; }
    clearAfterFailure(session: ISession): void {
        const state = this.local(session);
        state.integrator.reset(); state.previousRate = 0; state.lastObserved = null; state.lastDynamics = null;
        state.resets++; state.failureResets++;
    }
    protected override transformSignal(session: ISession, signal: TopologySignal): TopologySignal {
        this.assertIntact();
        const owner = this.frameSource.current(session);
        if ((owner as unknown as { temporalProtocol?: string }).temporalProtocol !== "branch-temporal-v1")
            throw new Error("Temporal topology requires a temporal activation session");
        const s = this.local(session), cfg = this.dynamics, time = owner.frame.observedAtSeconds;
        const cell = this.neuron.stateOf(s.integrator)!;
        const dt = s.lastObserved === null ? 0 : time - s.lastObserved;
        if (dt < 0 || (s.lastObserved !== null && dt === 0)) throw new Error("Topology observation clock must increase");
        const previousPotential = cell.membranePotential;
        const resetReason = signal.blockers.length ? "contradiction" : dt > cfg.maximumGapSeconds ? "gap" : null;
        if (resetReason) {
            // Preserve lifetime event counts; reset only the local physical state.
            cell.membranePotential = 0; cell.lastUpdateTime = null; cell.lastSpikeTime = null;
            s.previousRate = 0; s.resets++;
        }
        const rate = signal.known && !signal.blockers.length ? signal.support : 0;
        const corroboratedRate = resetReason ? 0 : Math.min(rate, s.previousRate);
        const charge = corroboratedRate * cfg.timeConstantSeconds * -Math.expm1(-dt / cfg.timeConstantSeconds);
        const beforeReset = cell.membranePotential * Math.exp(-dt / cfg.timeConstantSeconds) + charge;
        Object.assign(s.integrator.nodeStateOf(this.source)!, { charge, rate });
        const spikesBefore = cell.spikeCount;
        // Actual Core source and LifNeuronNode execution, on the measurement clock.
        s.integrator.run(time);
        s.integratorFirings += 2;
        const spiked = cell.spikeCount > spikesBefore;
        if (spiked) s.totalSpikes++;
        const active = rate > 0 && (cfg.mode === "continuous" ? cell.membranePotential >= cfg.threshold : spiked);
        s.lastObserved = time; s.previousRate = rate;
        s.lastDynamics = immutableCopy({ branchId: String(this.id), observedAtSeconds: time, elapsedSeconds: dt,
            rawSupport: rate, corroboratedRate, charge, previousPotential, potentialBeforeReset: beforeReset,
            potential: cell.membranePotential, lastResetPotential: spiked ? cell.membranePotential : null,
            active, spiked, spikes: s.totalSpikes, resetReason });
        return { ...signal, support: active ? signal.support : 0 };
    }
    dynamicsOf(session: ISession): TopologyBranchDynamics | null { return this.local(session).lastDynamics; }
    inspectDynamics(session: ISession) {
        const s = this.local(session), cell = this.neuron.stateOf(s.integrator)!;
        return { branchId: String(this.id), potential: cell.membranePotential, lastObserved: s.lastObserved,
            previousRate: s.previousRate, spikes: s.totalSpikes, resets: s.resets, failureResets: s.failureResets,
            nodeFirings: s.integratorFirings, nodes: this.integratorGraph.nodes.map(n => ({ id: String(n.id), implementation: n.constructor.name })),
            edges: this.integratorGraph.links.map(l => ({ from: String(l.oini!.id), to: String(l.ofin!.id), slot: l.slot, input: l.toSlot })) };
    }
}
