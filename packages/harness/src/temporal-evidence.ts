import { LifNeuronNode, RuntimeGraphBuilder, RuntimeNode, Session,
    type ISession, type IPortDescriptor, type INodeState, type ILifNeuronState, type ISpike } from "@spiky-panda/core";
import { immutableCopy } from "./validation.js";

export type TemporalPropagation = "continuous" | "spikes" | "spikes-modulated";
export interface ModulatedResetConfig { readonly alpha: number; }
export const DEFAULT_MODULATED_RESET_CONFIG: ModulatedResetConfig = Object.freeze({ alpha: 0.8 });
export function validateModulatedResetConfig(config: ModulatedResetConfig): void {
    if (!config || Object.keys(config).some(k => k !== "alpha") ||
        !Number.isFinite(config.alpha) || config.alpha < 0 || config.alpha >= 1) throw new Error("Invalid modulated reset configuration");
}
export interface TemporalEvidenceConfig {
    readonly timeConstantSeconds: number;
    readonly threshold: number;
    readonly activationLifetimeSeconds: number;
    readonly maximumGapSeconds: number;
    readonly maximumScopes: number;
    readonly maximumModes: number;
}
export const DEFAULT_TEMPORAL_EVIDENCE_CONFIG: TemporalEvidenceConfig = Object.freeze({
    timeConstantSeconds: 3, threshold: 1.5, activationLifetimeSeconds: 3,
    maximumGapSeconds: 2, maximumScopes: 64, maximumModes: 8,
});
export function validateTemporalEvidenceConfig(config: TemporalEvidenceConfig): void {
    if (!config || Object.keys(config).some(k => !Object.hasOwn(DEFAULT_TEMPORAL_EVIDENCE_CONFIG, k)) ||
        ![config.timeConstantSeconds, config.threshold, config.activationLifetimeSeconds, config.maximumGapSeconds]
            .every(n => Number.isFinite(n) && n > 0) ||
        config.threshold >= config.timeConstantSeconds ||
        !Number.isSafeInteger(config.maximumScopes) || config.maximumScopes < 1 || config.maximumScopes > 256 ||
        !Number.isSafeInteger(config.maximumModes) || config.maximumModes < 1 || config.maximumModes > 64) {
        throw new Error("Invalid temporal evidence configuration");
    }
}
interface Work { sourceFirings: number; integratorFirings: number; readoutFirings: number; inputEvents: number; outputEvents: number; }
const work = (): Work => ({ sourceFirings: 0, integratorFirings: 0, readoutFirings: 0, inputEvents: 0, outputEvents: 0 });
const port = (slot: string, type: string): IPortDescriptor => ({ slot, type, optional: false, kind: "stream", capacity: 1 });
interface SourceState extends INodeState { amplitude: number; firings: number; evidenceRate?: number; }
class EvidenceSource extends RuntimeNode {
    readonly inputPorts = [];
    readonly outputPorts = [port("spike", "spike")];
    createNodeState(): SourceState { return { linksReady: 0, amplitude: 0, firings: 0 }; }
    override reset(session: ISession): void {
        const state = session.nodeStateOf(this) as SourceState;
        Object.assign(state, { amplitude: 0, firings: 0 });
        delete state.evidenceRate;
    }
    override fire(session: ISession, t: number): void {
        const state = session.nodeStateOf(this) as SourceState;
        state.firings++;
        const spike: ISpike & { evidenceRate?: number } = { timestamp: t, amplitude: state.amplitude, source: this };
        if (state.evidenceRate !== undefined) spike.evidenceRate = state.evidenceRate;
        this.publishAll(session, "spike", spike);
    }
}
interface CountedLifState extends ILifNeuronState { firings: number; }
class CountedLif extends LifNeuronNode {
    override createNodeState(): CountedLifState { return { ...super.createNodeState(), firings: 0 }; }
    override reset(session: ISession): void { super.reset(session); (session.nodeStateOf(this) as CountedLifState).firings = 0; }
    override fire(session: ISession, t: number): void {
        (session.nodeStateOf(this) as CountedLifState).firings++; super.fire(session, t);
    }
}
interface ModulatedLifState extends CountedLifState { evidenceRate: number; lastResetPotential: number | null; }
/** Only the post-spike membrane value changes. Observed evidence travels with the input token.
 * The model resetPotential is never changed: the residual belongs to this session alone.
 */
class ModulatedResetLif extends CountedLif {
    constructor(readonly alpha: number) { super(); }
    override createNodeState(): ModulatedLifState {
        return { ...super.createNodeState(), evidenceRate: 0, lastResetPotential: null };
    }
    override reset(session: ISession): void {
        super.reset(session);
        Object.assign(session.nodeStateOf(this)!, { evidenceRate: 0, lastResetPotential: null });
    }
    override fire(session: ISession, t: number): void {
        const channels = this.inputChannels("spike").filter(c => c.enabled);
        if (channels.length !== 1) throw new Error("Modulated reset requires one observed-evidence channel");
        const index = this.channelIndex(session, channels[0]);
        const token = index >= 0 ? session.peek(index) as (ISpike & { evidenceRate?: number }) | undefined : undefined;
        if (!token || token.timestamp !== t || !Number.isFinite(token.amplitude) ||
            typeof token.evidenceRate !== "number" || !Number.isFinite(token.evidenceRate) ||
            token.evidenceRate < 0 || token.evidenceRate > 1) throw new Error("Invalid observed reset evidence");
        const state = session.nodeStateOf(this) as ModulatedLifState;
        state.evidenceRate = token.evidenceRate;
        const previousCount = state.spikeCount;
        super.fire(session, t);
        if (state.spikeCount !== previousCount) {
            state.lastResetPotential = this.threshold * this.alpha * state.evidenceRate;
            state.membranePotential = state.lastResetPotential;
        }
    }
}
/** Same core leak/integration, with an unreachable firing threshold and no reset.
 * Publishes the continuous membrane level, not a spike.
 */
class ContinuousEvidenceNode extends CountedLif {
    override readonly outputPorts = [port("level", "number")];
    override fire(session: ISession, t: number): void {
        super.fire(session, t);
        this.publishAll(session, "level", this.stateOf(session)!.membranePotential);
    }
}
interface ReadoutState extends INodeState { lastActivation: number | null; lastValue: number; firings: number; }
class EvidenceReadout extends RuntimeNode {
    readonly inputPorts: ReadonlyArray<IPortDescriptor>;
    readonly outputPorts = [];
    constructor(private readonly mode: TemporalPropagation, private readonly threshold: number) {
        super(); this.inputPorts = [port(mode !== "continuous" ? "spike" : "level", mode !== "continuous" ? "spike" : "number")];
    }
    createNodeState(): ReadoutState { return { linksReady: 0, lastActivation: null, lastValue: 0, firings: 0 }; }
    override reset(session: ISession): void { Object.assign(session.nodeStateOf(this)!, { lastActivation: null, lastValue: 0, firings: 0 }); }
    override fire(session: ISession, t: number): void {
        const channel = this.inputChannels(this.inputPorts[0].slot)[0];
        const payload = session.consume(this.channelIndex(session, channel));
        const state = session.nodeStateOf(this) as ReadoutState;
        state.firings++;
        state.lastValue = this.mode !== "continuous" ? (payload as ISpike).amplitude : payload as number;
        if (this.mode !== "continuous" || state.lastValue >= this.threshold) state.lastActivation = t;
    }
}
interface Bank {
    session: Session;
    units: { id: string; source: EvidenceSource; neuron: LifNeuronNode; readout: EvidenceReadout }[];
    lastTime: number | null;
    previousRate: number;
    winner: string | null;
}
export interface TemporalEvidenceResult {
    readonly mode: TemporalPropagation;
    readonly timeSeconds: number;
    readonly winner: string | null;
    readonly modeId: string | null;
    readonly units: ReadonlyArray<{ modeId: string; potential: number; lastActivation: number | null; spikes: number;
        resetEvidence?: number; lastResetPotential?: number | null }>;
}
interface TemporalSessionState extends INodeState {
    banks: Map<string, Bank>;
    counts: Work;
    resets: number;
    evictions: number;
    graphBuilds: number;
    cueCache?: unknown;
}
/** The owning session carries the scope registry, child sessions, counters and validation cache. */
class TemporalSessionStateNode extends RuntimeNode {
    createNodeState(): TemporalSessionState {
        return { linksReady: 0, banks: new Map(), counts: work(), resets: 0, evictions: 0, graphBuilds: 0 };
    }
    override reset(session: ISession): void { Object.assign(session.nodeStateOf(this)!, this.createNodeState(), { cueCache: undefined }); }
}
/** Bounded, ephemeral temporal state. It never creates policy modes or updates confidence. */
export class TemporalEvidenceNetwork {
    readonly config: TemporalEvidenceConfig;
    readonly resetModulation?: ModulatedResetConfig;
    private readonly stateNode = new TemporalSessionStateNode();
    /** A host may reset this core session to discard all temporal state, without touching the policy. */
    readonly session = new Session(new RuntimeGraphBuilder().withNodes(this.stateNode).build());
    get sessionState(): TemporalSessionState { return this.session.nodeStateOf(this.stateNode) as TemporalSessionState; }
    constructor(readonly mode: TemporalPropagation, config: TemporalEvidenceConfig = DEFAULT_TEMPORAL_EVIDENCE_CONFIG,
        resetModulation?: ModulatedResetConfig) {
        if (!["continuous", "spikes", "spikes-modulated"].includes(mode)) throw new Error("Unknown temporal propagation");
        validateTemporalEvidenceConfig(config); this.config = immutableCopy(config);
        if (mode === "spikes-modulated") {
            const reset = resetModulation === undefined ? DEFAULT_MODULATED_RESET_CONFIG : resetModulation;
            validateModulatedResetConfig(reset); this.resetModulation = immutableCopy(reset);
        } else if (resetModulation !== undefined) throw new Error("Reset modulation requires its own variant");
    }
    private create(ids: ReadonlyArray<string>): Bank {
        const units = ids.map(id => {
            const source = new EvidenceSource();
            const neuron = this.mode === "spikes-modulated" ? new ModulatedResetLif(this.resetModulation!.alpha) :
                this.mode === "spikes" ? new CountedLif() : new ContinuousEvidenceNode();
            neuron.membraneTimeConstant = this.config.timeConstantSeconds;
            neuron.threshold = this.mode !== "continuous" ? this.config.threshold : Number.MAX_VALUE;
            neuron.refractoryPeriod = 0;
            const readout = new EvidenceReadout(this.mode, this.config.threshold);
            source.id = id + ":input"; neuron.id = id + ":integrator"; readout.id = id + ":readout";
            return { id, source, neuron, readout };
        });
        const builder = new RuntimeGraphBuilder().withMode("dynamic");
        for (const unit of units) builder.withNodes(unit.source, unit.neuron, unit.readout)
            .withChannel(unit.source, unit.neuron, "spike", "spike")
            .withChannel(unit.neuron, unit.readout, this.mode !== "continuous" ? "spike" : "level");
        this.sessionState.graphBuilds++;
        return { units, session: new Session(builder.build()), lastTime: null, previousRate: 0, winner: null };
    }
    /** Missing/novel evidence invalidates temporary activations, not durable experience. */
    forget(scope: string): void { if (this.sessionState.banks.delete(scope)) this.sessionState.resets++; }
    advance(scope: string, ids: ReadonlyArray<string>, winner: string | null, rate: number, timeSeconds: number): TemporalEvidenceResult {
        if (!scope || !Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isFinite(rate) || rate < 0 || rate > 1 ||
            !ids.length || ids.length > this.config.maximumModes || new Set(ids).size !== ids.length ||
            ids.some(id => typeof id !== "string" || !id) || (winner !== null && !ids.includes(winner)) ||
            (winner === null && rate !== 0)) throw new Error("Invalid temporal evidence input");
        let bank = this.sessionState.banks.get(scope);
        if (bank?.lastTime !== null && bank?.lastTime !== undefined && timeSeconds <= bank.lastTime) {
            throw new Error("Temporal observations require an increasing clock");
        }
        const sorted = [...ids].sort();
        const topologyChanged = bank && JSON.stringify(bank.units.map(u => u.id)) !== JSON.stringify(sorted);
        const interrupted = bank && bank.lastTime !== null && timeSeconds - bank.lastTime > this.config.maximumGapSeconds;
        if (topologyChanged || interrupted || (bank && winner !== bank.winner)) { this.forget(scope); bank = undefined; }
        if (!bank) {
            if (this.sessionState.banks.size >= this.config.maximumScopes) {
                this.sessionState.banks.delete(this.sessionState.banks.keys().next().value!); this.sessionState.evictions++;
            }
            bank = this.create(sorted);
        }
        this.sessionState.banks.delete(scope); this.sessionState.banks.set(scope, bank);
        const dt = bank.lastTime === null ? 0 : timeSeconds - bank.lastTime;
        // Only corroborated intervals count. First samples and discontinuities contribute zero duration.
        const supportedRate = Math.min(rate, bank.previousRate);
        const input = supportedRate * this.config.timeConstantSeconds * -Math.expm1(-dt / this.config.timeConstantSeconds);
        const before = this.bankWork(bank);
        for (const unit of bank.units) {
            const source = bank.session.nodeStateOf(unit.source) as SourceState;
            source.amplitude = unit.id === winner ? input : 0;
            if (this.mode === "spikes-modulated") source.evidenceRate = unit.id === winner ? rate : 0;
        }
        bank.session.run(timeSeconds);
        const after = this.bankWork(bank);
        for (const key of Object.keys(after) as (keyof Work)[]) this.sessionState.counts[key] += after[key] - before[key];
        bank.lastTime = timeSeconds; bank.previousRate = rate; bank.winner = winner;
        const units = bank.units.map(unit => ({
            modeId: unit.id, potential: unit.neuron.stateOf(bank!.session)!.membranePotential,
            lastActivation: (bank!.session.nodeStateOf(unit.readout) as ReadoutState).lastActivation,
            spikes: unit.neuron.stateOf(bank!.session)!.spikeCount,
            ...(unit.neuron instanceof ModulatedResetLif ? {
                resetEvidence: (bank!.session.nodeStateOf(unit.neuron) as ModulatedLifState).evidenceRate,
                lastResetPotential: (bank!.session.nodeStateOf(unit.neuron) as ModulatedLifState).lastResetPotential,
            } : {}),
        }));
        const activated = units.find(u => u.modeId === winner);
        const modeId = rate > 0 && activated?.lastActivation !== null && activated?.lastActivation !== undefined &&
            timeSeconds - activated.lastActivation <= this.config.activationLifetimeSeconds ? winner : null;
        return immutableCopy({ mode: this.mode, timeSeconds, winner, modeId, units });
    }
    private bankWork(bank: Bank): Work {
        const sourceFirings = bank.units.reduce((n, u) => n + (bank.session.nodeStateOf(u.source) as SourceState).firings, 0);
        const integratorFirings = bank.units.reduce((n, u) => n + (bank.session.nodeStateOf(u.neuron) as CountedLifState).firings, 0);
        const readoutFirings = bank.units.reduce((n, u) => n + (bank.session.nodeStateOf(u.readout) as ReadoutState).firings, 0);
        return { sourceFirings, integratorFirings, readoutFirings, inputEvents: sourceFirings, outputEvents: readoutFirings };
    }
    inspect() {
        const graphs = [...this.sessionState.banks.entries()].map(([scope, bank]) => ({
            scope, engine: "spikypanda-core", builder: "RuntimeGraphBuilder", scheduling: "dynamic",
            nodes: bank.session.graph.nodes.map(n => ({ id: String(n.id), implementation: n.constructor.name })),
            edges: bank.session.graph.links.map(l => ({ from: String(l.oini?.id), to: String(l.ofin?.id), output: l.slot, input: l.toSlot })),
            state: bank.units.map(u => ({ modeId: u.id, potential: u.neuron.stateOf(bank.session)!.membranePotential,
                lastActivation: (bank.session.nodeStateOf(u.readout) as ReadoutState).lastActivation })),
        }));
        return immutableCopy({ mode: this.mode, config: this.config,
            ...(this.resetModulation ? { resetModulation: this.resetModulation } : {}), ...this.sessionState.counts,
            nodeFirings: this.sessionState.counts.sourceFirings + this.sessionState.counts.integratorFirings + this.sessionState.counts.readoutFirings,
            spikeEvents: this.mode !== "continuous" ? this.sessionState.counts.outputEvents : 0,
            scopes: this.sessionState.banks.size, graphBuilds: this.sessionState.graphBuilds, resets: this.sessionState.resets, evictions: this.sessionState.evictions,
            liveNodes: graphs.reduce((n, g) => n + g.nodes.length, 0), graphs });
    }
}
