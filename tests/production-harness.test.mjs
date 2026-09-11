import assert from "node:assert/strict";
import test from "node:test";
import { StateObserverNode, ContextualPolicyLookupNode, CueObserverNode, CapabilityExecutorNode, AdaptiveCueObserver } from "../packages/harness/dist/index.js";
import { suite, freeze, generateCase } from "../benchmarks/production-v1/scenario.mjs";
import { ProductionPlant, authorize } from "../benchmarks/production-v1/plant.mjs";
import { runCase } from "../benchmarks/production-v1/runner.mjs";
import { createReferenceController } from "../benchmarks/production-v1/controllers/reference.mjs";
import { createProductionHarnessController, HARNESS_VARIANTS } from "../benchmarks/production-v1/controllers/harness.mjs";
import { buildProductionGraph } from "../benchmarks/production-v1/controllers/harness-graph.mjs";
import { measuredState, createEffectSignature, learningSkip } from "../benchmarks/production-v1/controllers/production-contract.mjs";
const init = freeze({ contractVersion: suite.contractVersion, objective: suite.objective, actions: suite.actions,
    stepSeconds: suite.stepSeconds, deadlineMs: suite.timing.deadlineMs });
const nominal = () => generateCase("nominal", 101), noClock = { clock: () => 0 };
function harness(variant, options = {}) { return createProductionHarnessController(init, { variant, ...options }); }
async function shortRun(controller, steps = 25, scenario = "nominal") {
    const plant = new ProductionPlant(generateCase(scenario, 101)), traces = [];
    for (let i = 0; i < steps; i++) {
        const before = plant.observe();
        const trace = await controller.step(before, proposed => {
            const permit = authorize(proposed.actionId, before), { observation: after } = plant.advance(permit.effective);
            return freeze({ before, requestedAction: proposed.actionId, dispatchedAction: permit.effective, refusal: permit.reason, after });
        });
        traces.push(trace.diagnostics);
    }
    return { traces, state: plant.observe(), inspection: controller.inspect() };
}
for (const variant of HARNESS_VARIANTS) test("real core graph executes and learns: " + variant, async () => {
    const graph = buildProductionGraph(variant), c = harness(variant, { graph }), result = await shortRun(c);
    assert.equal(graph.nodes.length, variant.startsWith("harness-v3") ? 13 : 12);
    assert.ok(graph.nodes.some(n => n instanceof StateObserverNode));
    assert.ok(graph.nodes.some(n => n instanceof CapabilityExecutorNode));
    if (variant === "harness-v2") assert.ok(graph.nodes.some(n => n instanceof ContextualPolicyLookupNode));
    if (variant.startsWith("harness-v3")) assert.ok(graph.nodes.some(n => n instanceof CueObserverNode));
    assert.equal(result.inspection.graphRuns, 25); assert.equal(result.inspection.completedGraphs, 25);
    assert.equal(result.inspection.stageCounts.execute, 25); assert.equal(result.inspection.stageCounts.record, 25);
    assert.equal(result.inspection.memory.experiences, 25); assert.ok(result.inspection.memory.transitions > 0);
    assert.ok(result.inspection.memory.serializedBytes > 0);
    if (!["harness-fallback", "harness-v1"].includes(variant)) assert.ok(result.inspection.memory.operatingModes > 0);
    if (variant === "harness-fallback") assert.equal(result.inspection.reasonerCalls, 25);
    else assert.ok(result.inspection.runtimeMetrics.policyHits > 0, "a real learned replay must occur");
    for (const trace of result.traces) {
        const stages = trace.nodesExecuted.map(n => n.stage);
        for (const stage of ["observe", "context", "lookup", "gate", "merge", "guard", "execute", "observe-after", "evaluate", "record"]) assert.ok(stages.includes(stage));
        assert.equal(stages.includes("reason"), trace.source === "fallback");
        assert.equal(stages.includes("cues"), variant.startsWith("harness-v3"));
    }
});

for (const scenario of suite.scenarios) test("forced graph reasoning preserves the physical trajectory: " + scenario.id, async () => {
    const sample = generateCase(scenario.id, 101);
    const direct = await runCase(sample, createReferenceController, noClock);
    const actual = await runCase(sample, contract => createProductionHarnessController(contract, { variant: "harness-fallback" }), noClock);
    assert.equal(actual.status, "completed"); assert.deepEqual(actual.metrics, direct.metrics);
    assert.equal(actual.controllerDiagnostics.reasonerCalls, 600);
    const physical = r => { const { diagnostics, ...rest } = r; return rest; };
    assert.deepEqual(actual.rows.map(physical), direct.rows.map(physical));
});

test("V3 shadow retains V2 decisions and learning on the same observations", async () => {
    const v2 = await shortRun(harness("harness-v2"), 45);
    const shadow = await shortRun(harness("harness-v3-shadow"), 45);
    assert.deepEqual(v2.state, shadow.state);
    assert.deepEqual(v2.inspection.runtimeMetrics, shadow.inspection.runtimeMetrics);
    assert.equal(v2.inspection.memory.operatingModes, shadow.inspection.memory.operatingModes);
    assert.deepEqual(v2.traces.map(t => [t.source, t.evaluation]), shadow.traces.map(t => [t.source, t.evaluation]));
    assert.ok(shadow.traces.every(t => t.cue?.basis === "shadow"));
});

test("a disconnected or disabled production graph cannot be replaced by direct-code fallback", async () => {
    const graph = buildProductionGraph("harness-v1"); graph.nodes.find(n => n.stage === "execute").enabled = false;
    assert.throws(() => harness("harness-v1", { graph }), /Disabled/);
    const c = harness("harness-v1"); let dispatches = 0;
    await assert.rejects(c.step(new ProductionPlant(nominal()).observe(), () => { dispatches++; throw new Error("host unavailable"); }), /host unavailable/);
    assert.equal(dispatches, 1); assert.equal(c.snapshot().experiences.length, 0);
    assert.equal(c.inspect().stageCounts.record ?? 0, 0);
});

test("refusal and unapplied commands have a graph trace but no learned causal credit", async () => {
    for (const variant of ["harness-v1", "harness-v2", "harness-v3-active"]) {
        const c = harness(variant), before = new ProductionPlant(nominal()).observe();
        const output = await c.step(before, p => freeze({ before, requestedAction: p.actionId,
            dispatchedAction: "stop", refusal: "temperature-guard", after: { ...before, step: 1, timeSeconds: 1, appliedAction: "stop" } }));
        assert.equal(output.diagnostics.learningDisposition, "skipped");
        assert.equal(c.inspect().memory.experiences, 0);
        assert.equal(c.inspect().stageCounts.record, 1);
    }
    const c = harness("harness-v2"), before = new ProductionPlant(nominal()).observe();
    const output = await c.step(before, p => freeze({ before, requestedAction: p.actionId, dispatchedAction: p.actionId, refusal: null,
        after: { ...before, step: 1, timeSeconds: 1, appliedAction: "stop" } }));
    assert.equal(output.diagnostics.learningSkip, "command-not-yet-applied"); assert.equal(c.inspect().memory.experiences, 0);
});

test("cold controllers do not share memory and the reasoner sees only public measurements", async () => {
    const calls = [], c = harness("harness-v2", { reasoner: (observation) => {
        calls.push(observation);
        for (const key of ["seed", "scenarioId", "frames", "friction", "cooling", "temperatureBias", "truth"]) assert.equal(observation[key], undefined);
        assert.ok(Object.isFrozen(observation));
        return { actionId: "balanced" };
    } });
    await shortRun(c);
    const fresh = harness("harness-v2");
    assert.equal(fresh.inspect().memory.experiences, 0);
    assert.ok(c.inspect().memory.experiences > 0); assert.ok(calls.length > 0);
});

test("measured context and effect encoding use neither action prefixes nor hidden phase labels", () => {
    const observation = new ProductionPlant(nominal()).observe(), signature = createEffectSignature(init.actions);
    assert.equal(measuredState(observation).id, measuredState({ ...observation, appliedAction: "boost" }).id);
    const input = { decision: { invocation: { input: { actionId: "balanced" } } },
        result: { ok: true, output: { learningSkip: null } }, stateAfter: measuredState({ ...observation, speed: 0.6, currentA: 3.3 }) };
    assert.deepEqual(Object.keys(signature.describe(input)).sort(), ["currentPerDrive", "flowPerFan", "speedPerDrive"]);
    assert.equal(signature.describe({ ...input, result: { ok: false } }), null);
    assert.equal(learningSkip({ refusal: null, requestedAction: "balanced", before: observation,
        after: { ...observation, temperatureC: null } }), "missing-outcome-measurement");
});

test("graph dispatch advances exactly once even if a second call is swallowed", async () => {
    const run = await runCase(nominal(), () => ({ id: "double", async step(_o, dispatch) {
        dispatch({ actionId: "balanced" }); try { dispatch({ actionId: "boost" }); } catch {}
    } }), noClock);
    assert.equal(run.status, "controller-error");
    assert.match(run.error, /Only one dispatch/);
    assert.equal(run.rows[0].after.step, 1); assert.equal(run.rows.at(-1).after.step, 600);
    assert.equal(run.rows[0].dispatchedAction, "balanced");
});

test("a retained dispatch cannot execute after its originating step", async () => {
    let retained, checked = false;
    const run = await runCase(nominal(), () => ({ id: "retained", step(o, dispatch) {
        if (o.step === 1) { assert.throws(() => retained({ actionId: "boost" }), /closed step/); checked = true; }
        retained = dispatch; dispatch({ actionId: "balanced" });
    } }), noClock);
    assert.equal(run.status, "completed"); assert.equal(checked, true);
    assert.throws(() => retained({ actionId: "boost" }), /closed step/);
});

test("missing dispatch or post-dispatch failure keeps the horizon and real action intact", async () => {
    const absent = await runCase(nominal(), () => ({ id: "absent", step() {} }), noClock);
    assert.equal(absent.status, "controller-error"); assert.equal(absent.metrics.unavailableSteps, 600);
    const failed = await runCase(nominal(), () => ({ id: "failed", step(_o, dispatch) {
        dispatch({ actionId: "balanced" }); throw new Error("record failed");
    } }), noClock);
    assert.equal(failed.rows[0].dispatchedAction, "balanced"); assert.ok(failed.rows[0].goodParts > 0);
    assert.equal(failed.metrics.unavailableSteps, 600); assert.equal(failed.metrics.invalidActions, 0);
});

test("timeout revokes the callback and signals the actual runtime", async () => {
    let retained, signal;
    const run = await runCase(nominal(), () => ({ id: "hung-graph", step(_o, dispatch, s) {
        retained = dispatch; signal = s; return new Promise(() => {});
    } }));
    assert.equal(run.status, "controller-error"); assert.equal(signal.aborted, true);
    assert.equal(run.metrics.deadlineMisses, 1); assert.equal(run.metrics.unavailableSteps, 600);
    assert.throws(() => retained({ actionId: "boost" }), /closed step/);
});

test("common host authorization cannot be skipped by an eager graph controller", async () => {
    const run = await runCase(generateCase("missing-temperature", 101), () => ({ id: "ignores-missing",
        step(_o, dispatch) { dispatch({ actionId: "boost" }); } }), noClock);
    assert.ok(run.rows.some(r => r.before.temperatureC === null && r.guardRefused));
    assert.ok(run.rows.filter(r => r.before.temperatureC === null).every(r => r.dispatchedAction === "stop"));
});

test("V3 consolidation filters nominal startup phases without changing the cue algorithm", async () => {
    const c = harness("harness-v3-consolidated"), result = await shortRun(c, 45);
    assert.equal(result.inspection.memory.operatingModes, 1);
    assert.ok(result.inspection.memory.attributions.transient > 0);
    assert.ok(result.inspection.runtimeMetrics.policyHits > 0);
    assert.equal(result.inspection.consolidationConfig.minimumDurationMs, 10000);
    const mode = c.snapshot().policy.operatingMemory.modes[0];
    const evidence = c.snapshot().policy.experiences.filter(e => mode.consolidationSupport.includes(e.id));
    assert.ok(evidence.at(-1).observedAt - evidence[0].observedAt >= 10000);
    assert.equal(result.traces.at(-1).cue.status, "learning", "one mode is insufficient for discriminative cue recognition");
    assert.equal(result.traces.at(-1).cue.basis, "effect-history", "the gain comes from cleaner memory, not better cue discrimination");
    assert.deepEqual(AdaptiveCueObserver.restore(c.snapshot()).snapshot(), c.snapshot());
});

test("a skipped physical outcome interrupts an unfinished V3 consolidation", async () => {
    const c = harness("harness-v3-consolidated");
    const { state: before } = await shortRun(c, 7);
    assert.ok(c.snapshot().policy.experiences.some(e => e.attribution.current.status === "pending"));
    const output = await c.step(before, p => freeze({ before, requestedAction: p.actionId,
        dispatchedAction: "stop", refusal: "temperature-guard",
        after: { ...before, step: before.step + 1, timeSeconds: before.timeSeconds + 1, appliedAction: "stop" } }));
    assert.equal(output.diagnostics.learningDisposition, "skipped");
    assert.equal(c.inspect().memory.experiences, 7);
    assert.equal(c.inspect().memory.attributions.pending, 0);
    assert.equal(c.inspect().memory.operatingModes, 0);
});
