import { Session } from "@spiky-panda/core";
import { contextKey } from "./canonical.js";
import { immutableCopy, validateIntention, validateState, checkAbort } from "./validation.js";
import { TopologyMemory, topologyKey } from "./topology-memory.js";
import type { TopologyArbitration, TopologyFrame, TopologyPass, TopologyProposal, TopologyExperience } from "./topology-types.js";
import type { DecisionContext, Experience } from "./model.js";

/** One interaction session, not one decision. T1 has no membrane dynamics or learning. */
export class TopologyActivationSession {
    readonly session: Session;
    constructor(readonly memory: TopologyMemory) { this.session = new Session(memory.graph); }
    private get state() { return this.memory.frameSource.state(this.session); }
    beginDecision(id: string): void {
        this.memory.assertIntact();
        if (!id || this.state.busy || this.state.boundDecision) throw new Error("Topology interaction already in use");
        this.state.boundDecision = id; this.state.closed = false; this.state.lastPass = undefined;
    }
    endDecision(id: string): void {
        if (this.state.boundDecision !== id) throw new Error("Foreign topology decision lease");
        this.state.boundDecision = null; this.state.closed = true;
    }
    assertBound(timeSeconds?: number): void {
        this.memory.assertIntact();
        if (!this.state.boundDecision || this.state.closed) throw new Error("Topology decision session closed");
        const pass = this.state.lastPass;
        if (timeSeconds !== undefined && (!Number.isFinite(timeSeconds) || (pass &&
            (timeSeconds < pass.timeSeconds || timeSeconds - pass.observedAtSeconds > this.memory.config.maximumObservationAgeSeconds))))
            throw new Error("Topology observation expired before execution");
    }
    reset(): void {
        if (this.state.busy || this.state.boundDecision) throw new Error("Cannot reset an active topology decision");
        // The audit journal is not temporal activation state.
        const journal = this.state.journal;
        this.session.reset(); this.state.journal = journal;
    }
    activate(frame: TopologyFrame, options: { signal?: AbortSignal; maximumNodeFirings?: number } = {}): TopologyPass {
        checkAbort(options.signal); this.memory.assertIntact();
        frame = immutableCopy(frame);
        if (Object.keys(frame).some(k => !["observationId", "decisionId", "observedAtSeconds", "availableAtSeconds", "timeSeconds",
            "memoryRevision", "schemaVersion", "context"].includes(k))) throw new Error("Unexpected topology frame field");
        if (!frame.observationId || typeof frame.observationId !== "string" || !frame.decisionId || typeof frame.decisionId !== "string") throw new Error("Missing topology frame identity");
        validateState(frame.context?.state); validateIntention(frame.context?.intention);
        if (frame.context.operatingContextId !== undefined || frame.context.cues !== undefined ||
            frame.context.key !== contextKey(frame.context.state, frame.context.intention) || frame.context.key !== this.memory.definition.contextKey ||
            frame.memoryRevision !== this.memory.definition.revision || frame.schemaVersion !== this.memory.definition.schemaVersion) throw new Error("Foreign topology context, regime or revision");
        if (![frame.observedAtSeconds, frame.availableAtSeconds, frame.timeSeconds].every(t => Number.isFinite(t) && t >= 0) ||
            frame.observedAtSeconds > frame.availableAtSeconds || frame.availableAtSeconds > frame.timeSeconds ||
            frame.timeSeconds - frame.observedAtSeconds > this.memory.config.maximumObservationAgeSeconds) throw new Error("Invalid or stale topology observation time");
        const s = this.state, fingerprint = topologyKey(frame);
        if (s.busy || (s.boundDecision && s.boundDecision !== frame.decisionId)) throw new Error("Foreign or overlapping topology decision");
        if (!s.closed && s.lastKey === fingerprint && s.lastPass) return s.lastPass;
        if (s.seenObservations.has(frame.observationId) || s.seenDecisions.has(frame.decisionId)) throw new Error("Repeated topology observation or decision");
        if (s.lastTime !== null && frame.timeSeconds <= s.lastTime) throw new Error("Topology clock must increase");
        if (s.attempts >= this.memory.config.maximumPasses) throw new Error("Topology session capacity reached");
        const budget = options.maximumNodeFirings ?? this.memory.graph.nodes.length;
        if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("Invalid topology work budget");
        Object.assign(s, { frame, abort: options.signal, busy: true, closed: false, claimed: false, lastPass: undefined,
            lastKey: fingerprint, trace: [], proposals: [], issued: new WeakSet(), sourceFirings: 0, deliveries: 0,
            positives: 0, completions: 0, budget, lastTime: frame.timeSeconds });
        s.seenObservations.add(frame.observationId); s.seenDecisions.add(frame.decisionId); s.attempts++;
        try {
            this.session.run(frame.timeSeconds);
            checkAbort(options.signal); this.memory.assertIntact();
            if (s.trace.length !== this.memory.definition.nodes.length || s.sourceFirings !== 1) throw new Error("Incomplete topology passage");
            const pass: TopologyPass = immutableCopy(this.decoratePass({ kind: "topology-activation", version: 1, completed: true,
                observationId: frame.observationId, decisionId: frame.decisionId, memoryRevision: frame.memoryRevision,
                schemaVersion: frame.schemaVersion, timeSeconds: frame.timeSeconds, contextKey: frame.context.key,
                observedAtSeconds: frame.observedAtSeconds, availableAtSeconds: frame.availableAtSeconds,
                proposals: s.proposals.slice().sort((a, b) => a.branchId.localeCompare(b.branchId)), trace: s.trace,
                work: { sourceFirings: s.sourceFirings, nodeFirings: s.sourceFirings + s.trace.length,
                    relationDeliveries: s.deliveries, positiveOutputs: s.positives, completionOnlyOutputs: s.completions, spikeEvents: 0 } }));
            s.lastPass = pass; s.passes++;
            return pass;
        } finally {
            s.busy = false; s.abort = undefined; s.frame = undefined;
            this.session.queue.splice(0); this.session.deferred.splice(0);
            for (const n of this.session.nodeStates) {
                n.inputBuffers?.forEach(buffer => { buffer.length = 0; }); n.linksReady = 0;
            }
        }
    }
    protected decoratePass(pass: TopologyPass): TopologyPass { return pass; }
    assertPass(pass: TopologyPass, context?: DecisionContext, decisionId?: string): void {
        this.memory.assertIntact();
        const s = this.state;
        if (s.closed || !s.lastPass || topologyKey(s.lastPass) !== topologyKey(pass) ||
            (decisionId !== undefined && pass.decisionId !== decisionId) ||
            (context && (context.key !== pass.contextKey || !s.lastKey ||
                topologyKey(context) !== topologyKey(JSON.parse(s.lastKey).context)))) throw new Error("Foreign, stale or closed topology result");
    }
    arbitrate(pass: TopologyPass): TopologyArbitration {
        this.assertPass(pass);
        const config = this.memory.config, grouped = new Map<string, TopologyProposal[]>();
        for (const proposal of pass.proposals) {
            const key = topologyKey(proposal.decision.invocation);
            grouped.set(key, [...(grouped.get(key) ?? []), proposal]);
        }
        const ranked = [...grouped].map(([invocationKey, proposals]) => ({
            invocationKey, proposals, support: Math.max(...proposals.map(p => p.support)),
        })).sort((a, b) => b.support - a.support || a.invocationKey.localeCompare(b.invocationKey));
        const groups = ranked.map(g => ({ invocationKey: g.invocationKey, support: g.support,
            branchIds: g.proposals.map(p => p.branchId).sort() }));
        const result = (reason: TopologyArbitration["reason"], selected?: TopologyProposal) => immutableCopy({ reason, groups, ...(selected ? { selected } : {}) });
        const best = ranked[0], next = ranked[1];
        if (!best) return result("empty");
        if (best.support < config.minimumSupport) return result("insufficient");
        if (next && best.support - next.support < config.minimumMargin) return result("ambiguous");
        // Do not borrow the activation of a novel branch to authorize a weaker mature branch.
        const eligible = best.proposals.filter(p => p.stats.directEligible && p.stats.confidence >= config.minimumConfidence &&
            p.support >= config.minimumSupport && (!next || p.support - next.support >= config.minimumMargin))
            .sort((a, b) => b.support - a.support || a.branchId.localeCompare(b.branchId))[0];
        return eligible ? result("selected", eligible) : result("unreliable");
    }
    claim(pass: TopologyPass, context: DecisionContext, decisionId: string): TopologyArbitration {
        this.assertBound(); this.assertPass(pass, context, decisionId);
        if (this.state.boundDecision !== decisionId || this.state.claimed) throw new Error("Topology result already claimed");
        this.state.claimed = true;
        return this.arbitrate(pass);
    }
    /** Called only after the harness authority checked the executed receipt. No credit assignment in T1. */
    appendExecutedExperience(experience: Experience): void {
        this.assertBound();
        if (!this.state.claimed || experience.decisionId !== this.state.boundDecision ||
            this.state.journal.some(e => (e as unknown as Experience).decisionId === experience.decisionId)) throw new Error("Foreign or duplicate topology experience");
        const activation = this.state.lastPass!;
        const record: TopologyExperience = { ...experience, activation, arbitration: this.arbitrate(activation) };
        this.state.journal.push(immutableCopy(record) as unknown as import("./model.js").JsonValue);
    }
    journal(): ReadonlyArray<TopologyExperience> { return immutableCopy(this.state.journal) as unknown as ReadonlyArray<TopologyExperience>; }
    inspect() {
        const s = this.state;
        return immutableCopy({ kind: "topology-activation-t1", engine: "spikypanda-core",
            memoryRevision: this.memory.definition.revision, scheduling: this.memory.graph.mode,
            passes: s.passes, attempts: s.attempts, experiences: s.journal.length,
            lastPass: s.lastPass ?? null, nodes: this.memory.graph.nodes.map(n => ({
                id: String(n.id), implementation: n.constructor.name,
                visits: (this.session.nodeStateOf(n) as { visits?: number })?.visits ?? s.passes,
            })), edges: this.memory.graph.links.map(e => ({
                id: String(e.id), from: String(e.oini!.id), to: String(e.ofin!.id), input: e.toSlot,
            })) });
    }
}
