import assert from "node:assert/strict";
import test from "node:test";
import { suite, generateCase, caseList, validateSuite } from "../benchmarks/production-v1/scenario.mjs";
import { ProductionPlant, authorize } from "../benchmarks/production-v1/plant.mjs";
import { runCase } from "../benchmarks/production-v1/runner.mjs";
import { compareReports } from "../benchmarks/production-v1/report-comparison.mjs";
import { summarizeRun, quantile, pairedDelta } from "../benchmarks/production-v1/metrics.mjs";
import { createReferenceController, createStopController } from "../benchmarks/production-v1/controllers/reference.mjs";
const noClock = { clock: () => 0 };
const nominal = () => generateCase("nominal", 101);

test("the benchmark has ten scenario families and 330 disjoint seeded cases", () => {
    assert.equal(suite.scenarios.length, 10);
    const lists = ["development", "regression", "evaluation"].map(s => caseList(s));
    assert.deepEqual(lists.map(l => l.length), [30, 100, 200]);
    assert.equal(new Set(lists.flat().map(c => c.scenarioId + ":" + c.seed)).size, 330);
    assert.throws(() => caseList("typo"));
    for (const change of [s => { s.splits.evaluation[0] = s.splits.development[0]; },
        s => { s.scenarios[1].events[0].patch.label = 1; }, s => { s.objective.temperatureLimitC = 200; },
        s => { s.scenarios[1].events[0].duration = 1000; }]) {
        const value = structuredClone(suite); change(value); assert.throws(() => validateSuite(value));
    }
});

test("case generation is deterministic, immutable, and independent of controller action counts", () => {
    const a = generateCase("compound", 101), b = generateCase("compound", 101), c = generateCase("compound", 102);
    assert.deepEqual(a, b); assert.notEqual(a.tapeHash, c.tapeHash);
    assert.notDeepEqual(a.markers, c.markers);
    assert.throws(() => { a.frames[0].load = 999; });
    const x = new ProductionPlant(a), y = new ProductionPlant(a);
    for (let i = 0; i < 50; i++) {
        x.observe(); x.observe(); x.advance("boost"); y.advance("stop");
        assert.deepEqual(x.testCase.frames, y.testCase.frames);
    }
    assert.notEqual(x.state.goodParts, y.state.goodParts);
});

test("an unobservable future disturbance cannot change an earlier controller input", () => {
    const a = new ProductionPlant(nominal()), event = generateCase("unobservable-before-change", 101);
    const b = new ProductionPlant(event), first = event.markers[0].tick;
    for (let tick = 0; tick <= first; tick++) {
        assert.deepEqual(a.observe(), b.observe());
        a.advance("balanced"); b.advance("balanced");
    }
    assert.notDeepEqual(a.observe(), b.observe(), "an effect becomes measurable only after the affected interval");
});

test("stock conservation, continuous inertia and finite energy hold for every case", () => {
    for (const item of caseList("development")) {
        const sample = generateCase(item.scenarioId, item.seed), plant = new ProductionPlant(sample);
        for (let i = 0; i < sample.frames.length; i++) {
            const { truth } = plant.advance(i % 31 < 25 ? "boost" : "stop");
            for (const key of ["temperatureC", "goodParts", "queueParts", "energyKwh"]) assert.ok(Number.isFinite(truth[key]));
            assert.ok(truth.goodParts >= 0); assert.ok(truth.queueParts >= 0); assert.ok(truth.energyKwh > 0);
            const s = plant.state;
            assert.ok(Math.abs(sample.initial.queueParts + s.arrivedParts -
                s.queueParts - s.goodParts - s.rejectedParts - s.overflowParts) < 1e-8);
        }
        assert.throws(() => plant.advance("balanced"), /complete/);
    }
    const plant = new ProductionPlant(nominal());
    const a = plant.advance("boost"); const b = plant.advance("stop");
    assert.ok(a.observation.speed > 0 && a.observation.speed < 1);
    assert.ok(b.observation.speed > 0, "mechanical inertia does not reset with a command");
});

test("actuator lag is physical delay, not a hidden immediate command switch", () => {
    const c = generateCase("delayed-actuator", 101), p = new ProductionPlant(c), start = c.markers[0].tick;
    for (let i = 0; i < start; i++) p.advance("balanced");
    for (let i = 0; i < 5; i++) assert.equal(p.advance("stop").observation.appliedAction, "balanced");
    assert.equal(p.advance("stop").observation.appliedAction, "stop");
});

test("common authorization treats missing data and invalid commands consistently", () => {
    assert.equal(authorize("boost", { temperatureC: null }).effective, "stop");
    assert.equal(authorize("boost", { temperatureC: 81 }).allowed, false);
    assert.equal(authorize("stop", { temperatureC: null }).allowed, true);
    assert.equal(authorize("invented", { temperatureC: 20 }).reason, "invalid-action");
});

test("every adapter sees only frozen measured data and public feedback", async () => {
    const inputs = [], feedback = [];
    const run = await runCase(generateCase("sensor-bias", 101), init => {
        assert.deepEqual(Object.keys(init).sort(), ["actions", "contractVersion", "deadlineMs", "objective", "stepSeconds"]);
        return { id: "inspect", decide(o) {
            inputs.push(o); assert.ok(Object.isFrozen(o));
            for (const key of ["seed", "scenarioId", "frames", "markers", "friction", "cooling", "temperatureBias"]) assert.equal(o[key], undefined);
            return { actionId: "balanced" };
        }, learn(f) { assert.ok(Object.isFrozen(f.after)); feedback.push(f); } };
    }, noClock);
    assert.equal(inputs.length, 600); assert.equal(feedback.length, 600);
    assert.equal(run.rows.length, 600);
    assert.ok(run.rows.some(r => Math.abs(r.before.temperatureC - r.temperatureC) > 10));
    assert.ok(feedback.every(f => !Object.hasOwn(f, "truth") && !Object.hasOwn(f, "events")));
});

function row(tick, values = {}) {
    return { tick, seconds: 1, temperatureC: 70, queueParts: 2, goodParts: 1, rejectedParts: 0,
        overflowParts: 0, arrivals: 1, energyKwh: 0.001, decisionWallMs: 2, learnWallMs: 1,
        decisionAttempted: true, guardRefused: false, invalidAction: false, controllerError: false, deadlineMissed: false, interlock: false, ...values };
}

test("metric formulas have explicit units, denominators and union-of-constraint duration", () => {
    const rows = [row(0), row(1, { temperatureC: 85, queueParts: 41, energyKwh: 0.002 }),
        row(2, { temperatureC: 90, queueParts: 42, goodParts: 0, rejectedParts: 1, energyKwh: 0.003 })];
    const m = summarizeRun(rows, nominal());
    assert.equal(m.goodParts, 2); assert.equal(m.totalDemandParts, 8);
    assert.equal(m.fulfillmentRatio, 0.25); assert.equal(m.throughputPartsPerMinute, 40);
    assert.equal(m.constraintViolationSeconds, 2, "simultaneous violations must not double-count time");
    assert.equal(m.thermalExcessDegreeSeconds, 15); assert.equal(m.queueExcessPartSeconds, 3);
    assert.equal(m.queuePartSeconds, 85); assert.equal(m.rejectionRatio, 1 / 3);
    assert.ok(Math.abs(m.kwhPer100GoodParts - 0.3) < 1e-12);
    assert.equal(m.completedTrace, false); assert.equal(m.meetsCandidateEnvelope, false);
});

test("zero production cannot masquerade as perfect quality or zero cost per delivered part", () => {
    const m = summarizeRun([row(0, { goodParts: 0 })], nominal());
    assert.equal(m.rejectionRatio, null); assert.equal(m.kwhPer100GoodParts, null);
    assert.equal(m.fulfillmentRatio, 0);
    assert.throws(() => summarizeRun([], nominal()));
});

test("invalid metric samples, missing flags and invalid quantiles are rejected", () => {
    for (const override of [{ energyKwh: -1 }, { decisionWallMs: NaN }, { temperatureC: Infinity }, { tick: 4 }, { controllerError: undefined }]) {
        assert.throws(() => summarizeRun([row(0, override)], nominal()));
    }
    assert.equal(quantile([], 0.95), null);
    assert.equal(quantile([9, 1, 4, 2], 0.5), 2);
    assert.equal(quantile([9, 1, 4, 2], 0.95), 9);
    assert.throws(() => quantile([NaN], 0.5)); assert.throws(() => quantile([1], 2));
});

test("non-recovery remains censored and cannot improve the reported recovery average", () => {
    const sample = { ...nominal(), markers: [
        { tick: 0, id: "a", kind: "start", probeRecovery: true },
        { tick: 12, id: "b", kind: "return", probeRecovery: true },
    ] };
    const rows = Array.from({ length: 40 }, (_, i) => row(i, { goodParts: i < 12 ? 1 : 0 }));
    const m = summarizeRun(rows, sample);
    assert.equal(m.recoveredEvents, 1); assert.equal(m.observedEvents, 2);
    assert.equal(m.recoveries[0].seconds, 10);
    assert.equal(m.recoveries[1].seconds, null); assert.equal(m.recoveries[1].censored, true);
    assert.equal(m.recoverySecondsMedianAmongRecovered, 10);
});

test("interrupting disturbances shorten recovery windows instead of silently discarding hard events", () => {
    const sample = { ...nominal(), markers: [
        { tick: 0, id: "a", kind: "start", probeRecovery: true },
        { tick: 3, id: "b", kind: "return", probeRecovery: true },
    ] };
    const m = summarizeRun(Array.from({ length: 30 }, (_, i) => row(i)), sample);
    assert.equal(m.recoveries[0].seconds, null);
    assert.equal(m.recoveries[0].observationWindowSeconds, 3);
    assert.equal(m.recoveries[0].interruptedByNextEvent, true);
    assert.equal(m.recoveries[1].seconds, 10);
});

test("a controller failure preserves the full horizon and records remaining unavailability", async () => {
    let calls = 0;
    const run = await runCase(nominal(), () => ({ id: "fails", decide() {
        if (++calls === 11) throw new Error("broken adapter");
        return { actionId: "balanced" };
    } }), noClock);
    assert.equal(run.status, "controller-error"); assert.equal(calls, 11);
    assert.equal(run.error, "broken adapter"); assert.equal(run.metrics.decisionAttempts, 11);
    assert.equal(run.rows.length, 600); assert.equal(run.metrics.unavailableSteps, 590);
    assert.equal(run.metrics.invalidActions, 0); assert.equal(run.metrics.meetsCandidateEnvelope, false);
    assert.ok(run.rows.slice(10).every(r => r.dispatchedAction === "stop"));
});

test("a malformed action is refused, scored and cannot pollute JSON feedback", async () => {
    const cyclic = {}; cyclic.self = cyclic;
    const run = await runCase(nominal(), () => ({ id: "invalid", decide: () => ({ actionId: cyclic }) }), noClock);
    assert.equal(run.metrics.invalidActions, 600);
    assert.equal(run.metrics.meetsCandidateEnvelope, false);
    assert.ok(run.rows.every(r => r.dispatchedAction === "stop"));
    assert.doesNotThrow(() => JSON.stringify(run));
});

test("a non-returning asynchronous adapter times out and cannot act later", async () => {
    const run = await runCase(nominal(), () => ({ id: "hung", decide: () => new Promise(() => {}) }));
    assert.equal(run.status, "controller-error");
    assert.equal(run.metrics.deadlineMisses, 1); assert.equal(run.metrics.unavailableSteps, 600);
    assert.equal(run.metrics.decisionAttempts, 1);
    assert.ok(run.metrics.decisionMsP50 >= 900, "fallback intervals must not dilute the actual timeout latency");
    assert.ok(run.rows.every(r => r.dispatchedAction === "stop"));
});

test("a successful physical action followed by learning failure remains in the scored trace", async () => {
    const run = await runCase(nominal(), () => ({ id: "learn-fails",
        decide: () => ({ actionId: "balanced" }), learn() { throw new Error("learn failed"); } }), noClock);
    assert.ok(run.rows[0].goodParts > 0);
    assert.equal(run.rows[0].dispatchedAction, "balanced");
    assert.equal(run.metrics.unavailableSteps, 600);
});

test("the same factory produces reproducible cold runs without persisting a hidden mode", async () => {
    let created = 0;
    const factory = () => { created++; let index = 0;
        return { id: "fresh", decide: () => ({ actionId: ++index < 20 ? "stop" : "balanced" }) }; };
    const a = await runCase(nominal(), factory, noClock), b = await runCase(nominal(), factory, noClock);
    assert.equal(created, 2); assert.deepEqual(a.metrics, b.metrics); assert.deepEqual(a.rows, b.rows);
});

test("paired comparison rejects different scenarios, tapes, providers and metric definitions", async () => {
    const a = await runCase(nominal(), createReferenceController, noClock);
    assert.equal(pairedDelta(a, a).deltas.goodParts, 0);
    for (const key of ["tapeHash", "suiteHash", "metricsVersion", "providerFingerprint", "memoryProtocol", "track"]) {
        const b = { ...a, identity: { ...a.identity, [key]: "different" } };
        assert.throws(() => pairedDelta(a, b), /Incomparable/);
    }
    assert.throws(() => pairedDelta(a, { ...a, caseId: "different" }));
    const corrupt = structuredClone(nominal()); corrupt.frames[0].arrivals += 1;
    await assert.rejects(runCase(corrupt, createReferenceController), /Corrupt/);
});

test("stopping forever does not win a product benchmark by avoiding thermal excursions", async () => {
    const stopped = await runCase(nominal(), createStopController, noClock);
    const reference = await runCase(nominal(), createReferenceController, noClock);
    assert.equal(stopped.metrics.goodParts, 0); assert.equal(stopped.metrics.thermalExcessDegreeSeconds, 0);
    assert.equal(stopped.metrics.meetsCandidateEnvelope, false);
    assert.ok(stopped.metrics.queueExcessPartSeconds > 0);
    assert.ok(reference.metrics.fulfillmentRatio > 0.9);
});

test("nominal and difficult cases distinguish output, backlog, energy and hidden sensor error", async () => {
    const normal = await runCase(nominal(), createReferenceController, noClock);
    const compound = await runCase(generateCase("compound", 101), createReferenceController, noClock);
    const biased = await runCase(generateCase("sensor-bias", 101), createReferenceController, noClock);
    assert.equal(normal.metrics.constraintViolationSeconds, 0);
    assert.ok(compound.metrics.constraintViolationSeconds > 0);
    assert.ok(biased.metrics.thermalExcessDegreeSeconds > 0);
    assert.ok(compound.metrics.fulfillmentRatio > 0.9, "high total output must not hide a poor constraint history");
    assert.equal(compound.metrics.meetsCandidateEnvelope, false);
});

test("latency statistics exclude unattempted fallback steps after controller failure", () => {
    const m = summarizeRun([row(0, { decisionWallMs: 100 }),
        row(1, { decisionAttempted: false, decisionWallMs: 0, controllerError: true })], nominal());
    assert.equal(m.decisionAttempts, 1); assert.equal(m.decisionMsP50, 100); assert.equal(m.decisionMsP95, 100);
    const missing = summarizeRun([row(0, { decisionAttempted: false, decisionWallMs: 0 })], nominal());
    assert.equal(missing.decisionMsP50, null); assert.equal(missing.decisionMsMax, null);
});

test("report comparisons require exact matched cohorts and retain failed cases", async () => {
    const run = await runCase(nominal(), createReferenceController, noClock);
    const report = { reportVersion: 2, benchmark: suite.id + "@" + suite.version, split: "development",
        controller: "reference", referenceKernelHash: "common-reference", plannedRuns: 1, runs: [run] };
    const equal = compareReports(report, report);
    assert.equal(equal.pairedCases, 1); assert.equal(equal.bothCompleted, 1);
    assert.ok(equal.deltas.every(d => d.minimum === 0 && d.maximum === 0));
    for (const right of [{ ...report, runs: [] }, { ...report, plannedRuns: 2, runs: [run, run] },
        { ...report, benchmark: "old" }, { ...report, runs: [{ ...run, caseId: "other" }] },
        { ...report, runs: [{ ...run, identity: { ...run.identity, contractVersion: "old" } }] }]) {
        assert.throws(() => compareReports(report, right));
    }
    const setup = compareReports(report, { ...report, runs: [{ ...run, status: "setup-error", metrics: null, error: "cannot load" }] });
    assert.equal(setup.pairsWithoutMetrics, 1); assert.equal(setup.bothCompleted, 0);
    assert.equal(setup.failures.length, 1); assert.equal(setup.deltas.length, 0);
    const failed = compareReports(report, { ...report, runs: [{ ...run, status: "controller-error", error: "failed after actuation" }] });
    assert.equal(failed.failures.length, 1); assert.equal(failed.pairsWithoutMetrics, 0);
});
