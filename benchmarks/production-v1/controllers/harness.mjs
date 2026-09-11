import { Buffer } from "node:buffer";
import { AdaptivePolicyRuntime, PolicyGraph, ContextualPolicyGraph, OperatingContextTracker,
    AdaptiveCueObserver, TemporalCueObserver, DEFAULT_TEMPORAL_EVIDENCE_CONFIG, DEFAULT_OPERATING_CONTEXT_CONFIG, DEFAULT_CONSOLIDATION_CONFIG, CapabilityRegistry, createRuntimeGraphDriver } from "../../../packages/harness/dist/index.js";
import { referenceDecision } from "./reference.mjs";
import { buildProductionGraph, HARNESS_VARIANTS } from "./harness-graph.mjs";
import { measuredState, learningSkip, createEffectSignature, createProductionEvaluator, productionCueSchema, contextEncoding } from "./production-contract.mjs";

export { HARNESS_VARIANTS };
/** Declared sample horizon, shared by all scenarios, not a learned or hidden world label. */
export const productionConsolidationConfig = Object.freeze({ ...DEFAULT_CONSOLIDATION_CONFIG, minimumDurationMs: 10000 });
/** Receives only the public contract. The dispatch callback is supplied afresh by each host step. */
export function createProductionHarnessController(init, { variant = "harness-v3-active", reasoner = referenceDecision, consolidation = productionConsolidationConfig, temporal = DEFAULT_TEMPORAL_EVIDENCE_CONFIG, resetModulation, graph = buildProductionGraph(variant) } = {}) {
    if (init.contractVersion !== "2" || !HARNESS_VARIANTS.includes(variant)) throw new Error("Unsupported production harness contract");
    let current = null;
    const propagation = variant === "harness-v3-continuous" ? "continuous" : variant === "harness-v3-spikes" ? "spikes" :
        variant === "harness-v3-spikes-modulated" ? "spikes-modulated" : null;
    const contextual = !["harness-fallback", "harness-v1"].includes(variant);
    const model = createEffectSignature(init.actions), policy = contextual ? new ContextualPolicyGraph(model.id, (variant === "harness-v3-consolidated" || propagation)
        ? { ...DEFAULT_OPERATING_CONTEXT_CONFIG, consolidation } : undefined) : new PolicyGraph();
    const tracker = contextual ? new OperatingContextTracker(policy, model) : undefined;
    const metricObserver = variant.startsWith("harness-v3") ? new AdaptiveCueObserver(policy, productionCueSchema) : undefined;
    const cueObserver = propagation ? new TemporalCueObserver(metricObserver, propagation, () => current?.timeSeconds ?? 0, temporal, resetModulation) : metricObserver;
    const cueMode = (variant.startsWith("harness-v3") && variant !== "harness-v3-shadow") ? "active" : "shadow";
    const intention = Object.freeze({ id: "production-service", parameters: { ...init.objective } });
    const capabilities = new CapabilityRegistry(), validActions = new Set(init.actions.map(a => a.id));
    let active = null, nextId = 0, graphRuns = 0, completedGraphs = 0, reasonerCalls = 0, skipped = 0;
    const stageCounts = {};
    capabilities.register({ descriptor: { id: "production.command", description: "Request one production command through the common host guard",
        replayPolicy: "automatic", inputSchema: { type: "object", properties: { actionId: { type: "string", enum: [...validActions] } },
            required: ["actionId"], additionalProperties: false } },
        async execute(input) {
            if (!active) throw new Error("No active production step");
            const feedback = active.dispatch({ actionId: input.actionId, rationale: active.proposal?.rationale ?? "Learned policy replay" });
            if (feedback.before.step !== current.step || feedback.requestedAction !== input.actionId || feedback.after.step !== current.step + 1) {
                throw new Error("Foreign or stale production feedback");
            }
            current = feedback.after;
            return { ok: feedback.refusal === null, output: { requestedAction: feedback.requestedAction,
                dispatchedAction: feedback.dispatchedAction, refusal: feedback.refusal,
                appliedAction: feedback.after.appliedAction, learningSkip: learningSkip(feedback) } };
        } });
    const runtime = new AdaptivePolicyRuntime({ policy, operatingContexts: tracker, cueObserver, cueMode, capabilities,
        observer: { async observe() { if (!current) throw new Error("No observation"); return measuredState(current); } },
        evaluator: createProductionEvaluator(init.objective),
        fallback: { async resolve(request) {
            reasonerCalls++;
            const proposed = await reasoner(request.state.features, request.signal);
            if (!validActions.has(proposed?.actionId)) throw new Error("Reasoner proposed an unknown production action");
            return { action: { id: proposed.actionId, description: "Production command " + proposed.actionId },
                invocation: { actionId: proposed.actionId, capabilityId: "production.command", input: { actionId: proposed.actionId } },
                rationale: proposed.rationale };
        } },
        // This guard authorizes submission, not physical safety. Host dispatch applies the common physical guard to every request.
        safetyGuard: { async validate(decision) {
            active.proposal = decision;
            return { allowed: validActions.has(decision.invocation.input?.actionId) };
        } },
        timeoutMs: init.deadlineMs, clock: () => (current?.timeSeconds ?? 0) * 1000,
        idFactory: () => "production-step-" + (++nextId),
        driver: createRuntimeGraphDriver(graph, (id, stage) => { active.nodes.push({ id, stage }); }),
        onStage: event => { if (event.status === "complete") stageCounts[event.stage] = (stageCounts[event.stage] ?? 0) + 1; },
    });
    const snapshot = () => cueObserver ? cueObserver.snapshot() : policy.snapshot();
    return {
        id: variant,
        async step(observation, dispatch, signal) {
            if (active) throw new Error("Overlapping production harness step");
            if (signal?.aborted) throw signal.reason;
            current = observation; active = { dispatch, proposal: null, nodes: [] }; graphRuns++;
            try {
                const trace = await runtime.step(intention, signal);
                completedGraphs++;
                const learningDisposition = trace.result.output?.learningSkip ? "skipped" : "recorded";
                if (learningDisposition === "skipped") skipped++;
                return { diagnostics: { kind: "spikypanda", variant, decisionId: trace.decisionId, source: trace.source,
                    nodesExecuted: active.nodes, learningDisposition, learningSkip: trace.result.output?.learningSkip ?? null,
                    evaluation: trace.evaluation, candidateConfidence: trace.candidateConfidence ?? null,
                    operatingBefore: trace.operatingBefore ?? null, operatingAfter: trace.operatingAfter ?? null,
                    attribution: trace.attribution?.current ?? null,
                    consolidation: tracker?.consolidation(trace.stateBefore, intention) ?? null,
                    cue: trace.cues ? { mode: trace.cues.mode, basis: trace.cues.basis, status: trace.cues.assessment.status,
                        modeId: trace.cues.assessment.modeId ?? null, coverage: trace.cues.assessment.coverage,
                        temporal: trace.cues.assessment.temporal ?? null,
                        features: trace.cues.assessment.features, candidates: trace.cues.assessment.candidates } : null } };
            } finally { active = null; }
        },
        snapshot,
        inspect() {
            const memory = snapshot(), data = cueObserver ? memory.policy : memory;
            return { kind: "spikypanda", variant, graphRuns, completedGraphs, reasonerCalls, skippedExperiences: skipped,
                temporal: propagation ? cueObserver.inspect() : null,
                consolidationConfig: contextual ? policy.contextConfig.consolidation ?? null : null,
                runtimeMetrics: runtime.metrics.snapshot(), stageCounts: { ...stageCounts }, contextEncoding,
                memory: { contexts: data.contexts.length, actions: data.actions.length, experiences: data.experiences.length,
                    attributions: Object.fromEntries(["pending", "transient", "confirmed", "anomaly", "unresolved", "revised"]
                        .map(status => [status, data.experiences.filter(e => e.attribution?.current.status === status).length])),
                    transitions: data.transitions.length, operatingModes: data.operatingMemory?.modes.length ?? 0,
                    serializedBytes: Buffer.byteLength(JSON.stringify(memory), "utf8") },
                graph: { engine: "spikypanda-core", builder: "RuntimeGraphBuilder", nodeCount: graph.nodes.length,
                    nodes: graph.nodes.map(n => ({ id: String(n.id), stage: n.stage, implementation: n.constructor.name })),
                    edges: graph.links.map(l => ({ from: String(l.oini.id), output: l.slot, to: String(l.ofin.id), input: l.toSlot })) } };
        },
    };
}
