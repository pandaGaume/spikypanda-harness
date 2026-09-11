import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePolicyRuntime, CapabilityRegistry, OperatingContextTracker, createDecisionContext,
    createGraphDriver, createHarnessNode, CueObserverNode } from "../packages/harness/dist/index.js";
import { createCounterPolicy, createCounterRuntimeV2, counterEffectSignature } from "../examples/counter/contextual.mjs";
import { CounterCueWorld, createCounterCueMemory, createCounterRuntimeV3, createCounterHarnessV3 } from "../examples/counter/perceptive.mjs";
import { counterReasoner } from "../examples/counter/world.mjs";
const intention = { id: "reach-target", parameters: { target: 3 } };
function fixture(mode = "active", observer = createCounterCueMemory(), options = {}) {
    const world = new CounterCueWorld();
    return { world, observer, policy: observer.policy, ...createCounterRuntimeV3(observer, world, { cueMode: mode, ...options }) };
}
async function advance(f, count) {
    const traces = [];
    for (let i = 0; i < count; i++) {
        if (f.world.value === f.world.target) f.world.reset();
        traces.push(await f.runtime.step(intention));
    }
    return traces;
}
async function learned() {
    const f = fixture(); await advance(f, 24);
    f.world.reset(); f.world.invert(); await advance(f, 24); f.world.reset(); return f;
}
const mode = (f, gain) => f.policy.modes().find(m => m.signature.gain === gain);
const stats = (f, gain) => f.policy.getTransitionStats(f.world.current(), intention,
    { actionId: gain > 0 ? "increment" : "decrement", capabilityId: "counter.move", input: { delta: gain } }, mode(f, gain).id);

test("shadow observation preserves the exact V2 action, attribution and reliability sequence", async () => {
    const a = fixture("shadow"), b = { policy: createCounterPolicy(), world: new CounterCueWorld() };
    Object.assign(b, createCounterRuntimeV2(b.policy, b.world));
    for (let i = 0; i < 60; i++) {
        if ([18, 36, 48].includes(i)) for (const f of [a, b]) { f.world.reset(); f.world.invert(); }
        const [ta] = await advance(a, 1), [tb] = await advance(b, 1);
        assert.deepEqual(ta.decision, tb.decision); assert.deepEqual(ta.operatingAfter, tb.operatingAfter);
        assert.deepEqual(ta.transitionAfter && { ...ta.transitionAfter, lastUsedAt: 0 }, tb.transitionAfter && { ...tb.transitionAfter, lastUsedAt: 0 }); assert.equal(ta.cues.basis, "shadow");
        assert.equal(ta.attribution.current.status, tb.attribution.current.status);
    }
    assert.ok(a.policy.snapshot().experiences.some(e => e.cues.assessment.status === "recognized"));
});

test("active A-B-A-B recognizes known returns before acting and preserves dormant skill reliability", async () => {
    const f = await learned(), bBefore = stats(f, -1), snapshot = f.policy.snapshot();
    f.world.invert();
    const assessment = f.observer.assess(createDecisionContext(f.world.current(), intention));
    assert.equal(f.policy.mode(assessment.modeId).signature.gain, 1);
    assert.deepEqual(f.policy.snapshot(), snapshot);
    const [a] = await advance(f, 1);
    assert.equal(a.cues.basis, "cues"); assert.equal(a.source, "policy");
    assert.equal(a.operatingBefore.modeId, mode(f, 1).id); assert.equal(a.evaluation.success, true);
    assert.deepEqual(stats(f, -1), bBefore);
    f.world.reset(); f.world.invert(); const aBefore = stats(f, 1);
    const [b] = await advance(f, 1);
    assert.equal(b.cues.basis, "cues"); assert.equal(b.decision.action.id, "decrement");
    assert.equal(b.evaluation.success, true); assert.deepEqual(stats(f, 1), aBefore);
    assert.equal(f.policy.modes().length, 2);
});

test("misleading cues can cause a failure but actual effects correct attribution, not the dormant skill", async () => {
    const f = await learned(), aBefore = stats(f, 1);
    f.world.sensorPolarity = -1; f.world.revision++;
    const [trace] = await advance(f, 1);
    assert.equal(trace.cues.basis, "cues"); assert.equal(trace.evaluation.success, false);
    assert.equal(trace.operatingBefore.modeId, mode(f, 1).id);
    assert.equal(trace.attribution.current.modeId, mode(f, -1).id);
    assert.deepEqual(stats(f, 1), aBefore);
});

test("missing and novel cues disable direct replay without revealing hidden direction", async () => {
    const f = await learned();
    f.world.setCueVisibility("hidden"); f.world.invert();
    const before = f.observer.assess(createDecisionContext(f.world.current(), intention));
    assert.equal(before.status, "missing"); assert.equal(before.modeId, undefined);
    const [hidden] = await advance(f, 1);
    assert.equal(hidden.cues.basis, "uncertain"); assert.equal(hidden.source, "fallback");
    f.world.setCueVisibility("visible"); f.world.sensorBias = 5; f.world.revision++;
    const [novel] = await advance(f, 1);
    assert.equal(novel.cues.assessment.status, "novel"); assert.equal(novel.source, "fallback");
});

function controlled(observer, { approved = true, allowed = true, stale = false, malformed = false } = {}) {
    const world = new CounterCueWorld(), policy = observer.policy;
    let executed = 0, approvals = 0;
    const capabilities = new CapabilityRegistry({ approve: async () => {
        approvals++; if (stale) world.invert(); return approved;
    } });
    capabilities.register({ descriptor: { id: "counter.move", description: "Move", replayPolicy: "approval-required",
        inputSchema: { type: "object", properties: { delta: { type: "integer", enum: [-1, 1] } }, required: ["delta"], additionalProperties: false } },
        async execute({ delta }) { executed++; world.value += world.direction * delta; world.revision++; return { ok: true }; } });
    const runtime = new AdaptivePolicyRuntime({ policy, cueObserver: observer, cueMode: "active",
        operatingContexts: new OperatingContextTracker(policy, counterEffectSignature), observer: world, capabilities,
        driver: createGraphDriver(createCounterHarnessV3()), fallback: { async decide(input) {
            const result = counterReasoner(input);
            return malformed ? { ...result, invocation: { ...result.invocation, input: { delta: 100 } } } : result;
        } },
        safetyGuard: { async validate() { return { allowed, reason: "Host denied" }; } },
        evaluator: { evaluate() { return { success: true, reward: 1 }; } } });
    return { runtime, world, counts: () => ({ executed, approvals }) };
}

test("a recognized observer never bypasses host refusal, approval or last-moment freshness", async () => {
    const trained = await learned();
    for (const options of [{ allowed: false }, { approved: false }, { stale: true }]) {
        const f = controlled(trained.observer, options), before = trained.policy.snapshot();
        await assert.rejects(f.runtime.step(intention), /Host denied|Approval|Stale/);
        assert.equal(f.counts().executed, 0); assert.deepEqual(trained.policy.snapshot(), before);
        if (options.allowed !== false) assert.equal(f.counts().approvals, 1);
    }
});

test("malformed fallback invocations never create observer or policy evidence", async () => {
    const observer = createCounterCueMemory(), f = controlled(observer, { malformed: true });
    await assert.rejects(f.runtime.step(intention));
    assert.equal(f.counts().executed, 0); assert.equal(observer.policy.snapshot().experiences.length, 0);
});

test("host can replace the observer service and override its node without changing runtime dispatch", async () => {
    const trained = await learned(); let assessments = 0, nodes = 0;
    const service = { policy: trained.policy,
        assess(context) { assessments++; return trained.observer.assess(context); },
        validateAssessment(context, assessment) { trained.observer.validateAssessment(context, assessment); } };
    class HostCueNode extends CueObserverNode { async execute(context, session) { nodes++; return super.execute(context, session); } }
    const driver = createGraphDriver(createCounterHarnessV3(), undefined,
        type => type === "Harness.Observation:cues" ? new HostCueNode() : createHarnessNode(type));
    const f = fixture("active", service, { driver }); const [trace] = await advance(f, 1);
    assert.equal(assessments, 1); assert.equal(nodes, 1); assert.equal(trace.cues.basis, "cues");
    assert.equal(trace.evaluation.success, true);
});

test("a cue lookup wired without an observer fails before any execution or learning", async () => {
    const graph = createCounterHarnessV3();
    const broken = { ...graph, nodes: graph.nodes.filter(n => n.type !== "Harness.Observation:cues"),
        edges: graph.edges.filter(e => e.from !== "cues").map(e => e.to === "cues" ? { ...e, to: "lookup" } : e) };
    const f = fixture("active", createCounterCueMemory(), { driver: createGraphDriver(broken) });
    await assert.rejects(f.runtime.step(intention), /Missing cue observation/);
    assert.equal(f.world.value, 0); assert.equal(f.policy.snapshot().experiences.length, 0);
});

test("a shared V3 graph and observer keep concurrent runtimes' local hypotheses independent", async () => {
    const trained = await learned(), driver = createGraphDriver(createCounterHarnessV3());
    const a = fixture("active", trained.observer, { driver }), b = fixture("active", trained.observer, { driver });
    b.world.invert();
    const [[ta], [tb]] = await Promise.all([advance(a, 1), advance(b, 1)]);
    assert.equal(ta.decision.action.id, "increment"); assert.equal(tb.decision.action.id, "decrement");
    assert.equal(ta.evaluation.success, true); assert.equal(tb.evaluation.success, true);
    assert.notEqual(a.operatingContexts.belief(a.world.current(), intention).modeId,
        b.operatingContexts.belief(b.world.current(), intention).modeId);
});
