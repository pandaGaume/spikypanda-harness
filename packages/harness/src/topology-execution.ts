import { RuntimeNode, type ISession, type INodeState, type IPortDescriptor } from "@spiky-panda/core";
import { immutableCopy, checkAbort } from "./validation.js";
import { stableStringify } from "./canonical.js";
import type { JsonValue } from "./model.js";
import type { TopologyFrame, TopologySignal, TopologyEvidence, TopologyNodeTrace, TopologyProposal,
    TopologyPass, TopologyCondition, TopologyCombination, TopologyBranch, TopologyNodeDefinition } from "./topology-types.js";

const port = (slot: string): IPortDescriptor => ({ slot, type: "topology.support", optional: false, kind: "stream", capacity: 1 });
const key = (v: unknown) => stableStringify(v as JsonValue);
export interface TopologyExecutionState extends INodeState {
    frame?: TopologyFrame; abort?: AbortSignal; busy: boolean; boundDecision: string | null;
    seenObservations: Set<string>; seenDecisions: Set<string>; issued: WeakSet<object>;
    trace: TopologyNodeTrace[]; proposals: TopologyProposal[]; journal: JsonValue[];
    lastPass?: TopologyPass; lastKey?: string; claimed: boolean; closed: boolean; budget: number; lastTime: number | null;
    passes: number; attempts: number; deliveries: number; positives: number; completions: number; sourceFirings: number;
}
interface LocalState extends INodeState {
    lastDecision: string | null; visits: number; lastSignal?: TopologySignal;
}
interface Packet {
    readonly decisionId: string; readonly observationId: string; readonly memoryRevision: string;
    readonly schemaVersion: string; readonly edgeId: string; readonly from: string; readonly signal: TopologySignal;
}
export function unknownSignal(reason: string): TopologySignal {
    return { known: false, support: 0, evidence: [], blockers: [], missing: [reason], nodeIds: [], edgeIds: [] };
}
const strings = (xs: ReadonlyArray<string>): string[] => [...new Set(xs)].sort();
const evidences = (xs: ReadonlyArray<TopologyEvidence>): TopologyEvidence[] =>
    [...new Map(xs.map(x => [key(x), x])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, x]) => x);

/** Technical source and owner of the interaction state. No per-session field lives on this node. */
export class TopologyFrameSource extends RuntimeNode {
    readonly inputPorts = [];
    readonly outputPorts = [port("support")];
    createNodeState(): TopologyExecutionState {
        return { linksReady: 0, busy: false, boundDecision: null, seenObservations: new Set(), seenDecisions: new Set(),
            issued: new WeakSet(), trace: [], proposals: [], journal: [], claimed: false, closed: false, budget: 0, lastTime: null,
            passes: 0, attempts: 0, deliveries: 0, positives: 0, completions: 0, sourceFirings: 0 };
    }
    override reset(session: ISession): void {
        Object.assign(session.nodeStateOf(this)!, this.createNodeState(), { frame: undefined, abort: undefined, lastPass: undefined, lastKey: undefined });
    }
    state(session: ISession): TopologyExecutionState { return session.nodeStateOf(this) as TopologyExecutionState; }
    current(session: ISession): TopologyExecutionState & { frame: TopologyFrame } {
        const s = this.state(session);
        checkAbort(s.abort);
        if (!s.busy || !s.frame) throw new Error("No active topology frame");
        return s as TopologyExecutionState & { frame: TopologyFrame };
    }
    override fire(session: ISession): void {
        const s = this.current(session);
        if (s.sourceFirings + s.trace.length >= s.budget) throw new Error("Topology work budget exceeded");
        s.sourceFirings++;
        this.forward(session, this, { ...unknownSignal("observation-envelope"), known: true, support: 1, missing: [] });
    }
    forward(session: ISession, from: RuntimeNode, signal: TopologySignal): void {
        const s = this.current(session), f = s.frame;
        for (const channel of session.graph.links.filter(c => c.oini === from && c.slot === "support")) {
            const index = session.graph.links.indexOf(channel);
            const packet: Packet = immutableCopy({ decisionId: f.decisionId, observationId: f.observationId,
                memoryRevision: f.memoryRevision, schemaVersion: f.schemaVersion, edgeId: String(channel.id),
                from: String(from.id), signal });
            s.issued.add(packet);
            session.publish(index, packet);
        }
    }
    receive(session: ISession, node: RuntimeNode, slot: string): TopologySignal {
        const s = this.current(session), channels = session.graph.links.filter(c => c.ofin === node && c.toSlot === slot);
        if (!channels.length) return unknownSignal("unwired:" + node.id + ":" + slot);
        if (channels.length !== 1) throw new Error("Multiple topology producers on one input");
        const channel = channels[0], index = session.graph.links.indexOf(channel), packet = session.consume(index) as Packet;
        if (!packet || !s.issued.has(packet) || packet.decisionId !== s.frame.decisionId ||
            packet.observationId !== s.frame.observationId || packet.memoryRevision !== s.frame.memoryRevision ||
            packet.schemaVersion !== s.frame.schemaVersion || packet.edgeId !== channel.id ||
            packet.from !== channel.oini?.id) throw new Error("Foreign, stale or consumed topology packet");
        s.issued.delete(packet); s.deliveries++;
        return { ...packet.signal, edgeIds: strings([...packet.signal.edgeIds,
            ...(String(channel.id).startsWith("$") ? [] : [String(channel.id)])]) };
    }
}

/** Base handles provenance and transport; semantic behavior belongs to each concrete node. */
export abstract class TopologyRuntimeNode extends RuntimeNode {
    abstract readonly definition: TopologyNodeDefinition;
    readonly inputPorts: ReadonlyArray<IPortDescriptor>;
    readonly outputPorts: ReadonlyArray<IPortDescriptor> = [port("support")];
    constructor(readonly frameSource: TopologyFrameSource, slots: ReadonlyArray<string>) {
        super(); this.inputPorts = slots.map(port);
    }
    createNodeState(): LocalState { return { linksReady: 0, lastDecision: null, visits: 0 }; }
    override reset(session: ISession): void {
        Object.assign(session.nodeStateOf(this)!, { lastDecision: null, visits: 0, lastSignal: undefined });
    }
    override isReady(session: ISession): boolean {
        const frame = this.frameSource.state(session).frame;
        return !!frame && (session.nodeStateOf(this) as LocalState).lastDecision !== frame.decisionId && super.isReady(session);
    }
    override fire(session: ISession): void {
        const s = this.frameSource.current(session), local = session.nodeStateOf(this) as LocalState;
        if (s.sourceFirings + s.trace.length >= s.budget) throw new Error("Topology work budget exceeded");
        if (local.lastDecision === s.frame.decisionId) throw new Error("Duplicate topology firing");
        const inputs = this.inputPorts.map(p => this.frameSource.receive(session, this, String(p.slot)));
        const signal = immutableCopy(this.transformSignal(session, { ...this.evaluate(s.frame, inputs), nodeIds: strings([
            ...inputs.flatMap(x => x.nodeIds), String(this.id)]) }));
        local.lastDecision = s.frame.decisionId; local.visits++; local.lastSignal = signal;
        s.trace.push({ nodeId: String(this.id), implementation: this.constructor.name, signal });
        if (signal.known && signal.support > 0 && !signal.blockers.length) s.positives++; else s.completions++;
        this.afterEvaluation(session, signal);
        this.frameSource.forward(session, this, signal);
    }
    /** Optional local dynamics, executed once inside this memory node's passage. */
    protected transformSignal(_session: ISession, signal: TopologySignal): TopologySignal { return signal; }
    protected abstract evaluate(frame: TopologyFrame, inputs: ReadonlyArray<TopologySignal>): TopologySignal;
    protected afterEvaluation(_session: ISession, _signal: TopologySignal): void {}
}
export class TopologyConditionNode extends TopologyRuntimeNode {
    constructor(source: TopologyFrameSource, readonly definition: TopologyCondition) { super(source, ["frame"]); }
    protected evaluate(frame: TopologyFrame): TopologySignal {
        let value: unknown = frame.context.state.features;
        for (const part of this.definition.path) value = value && typeof value === "object" && !Array.isArray(value) &&
            Object.hasOwn(value, part) ? (value as Record<string, unknown>)[part] : undefined;
        const evidence = [{ observationId: frame.observationId, path: this.definition.path }];
        if (typeof value !== "number" || !Number.isFinite(value)) return { ...unknownSignal("missing:" + this.id), evidence };
        const support = Math.max(0, 1 - Math.abs(value - this.definition.center) / this.definition.tolerance);
        return { known: true, support, evidence, missing: [], nodeIds: [], edgeIds: [],
            blockers: support === 0 && this.definition.vetoOnMismatch ? [String(this.id)] : [] };
    }
}
export function combineSignals(inputs: ReadonlyArray<TopologySignal>, mode: "and" | "or"): TopologySignal {
    const known = mode === "and" ? inputs.every(x => x.known) : inputs.some(x => x.known);
    const blockers = strings(inputs.flatMap(x => x.blockers));
    const support = !known || blockers.length ? 0 : mode === "and" ? Math.min(...inputs.map(x => x.support)) :
        Math.max(...inputs.filter(x => x.known).map(x => x.support));
    return { known, support, blockers, evidence: evidences(inputs.flatMap(x => x.evidence)),
        missing: strings(inputs.flatMap(x => x.missing)), nodeIds: strings(inputs.flatMap(x => x.nodeIds)),
        edgeIds: strings(inputs.flatMap(x => x.edgeIds)) };
}
export class TopologyAndNode extends TopologyRuntimeNode {
    constructor(source: TopologyFrameSource, readonly definition: TopologyCombination) { super(source, definition.inputs); }
    protected evaluate(_frame: TopologyFrame, inputs: ReadonlyArray<TopologySignal>): TopologySignal { return combineSignals(inputs, "and"); }
}
export class TopologyOrNode extends TopologyAndNode {
    protected override evaluate(_frame: TopologyFrame, inputs: ReadonlyArray<TopologySignal>): TopologySignal { return combineSignals(inputs, "or"); }
}
export class TopologyBranchNode extends TopologyRuntimeNode {
    override readonly outputPorts = [];
    constructor(source: TopologyFrameSource, readonly definition: TopologyBranch) { super(source, definition.inputs); }
    protected evaluate(_frame: TopologyFrame, inputs: ReadonlyArray<TopologySignal>): TopologySignal { return inputs[0]; }
    protected override afterEvaluation(session: ISession, signal: TopologySignal): void {
        if (signal.known && signal.support > 0 && !signal.blockers.length) this.frameSource.current(session).proposals.push(
            immutableCopy({ branchId: String(this.id), support: signal.support, decision: this.definition.decision,
                stats: this.definition.stats, experienceIds: this.definition.experienceIds, signal }));
    }
}
