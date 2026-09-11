import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cases, cadences, variants, createTape } from "../benchmarks/topology-t2/cases.mjs";
import { runCampaign, measureCase } from "../benchmarks/topology-t2/measure.mjs";

test("the first T2 campaign is reproducible without CPU timings in its comparison fingerprint", () => {
    const baseline = JSON.parse(readFileSync(new URL("./fixtures/topology-t2-baseline.json", import.meta.url)));
    const report = runCampaign(), compact = report.runs.map(({ timing, frames, ...run }) => run);
    assert.equal(report.protocol, baseline.protocol); assert.equal(report.runs.length, baseline.runs);
    assert.equal(createHash("sha256").update(JSON.stringify(compact)).digest("hex"), baseline.sha256);
    for (const scenario of cases) for (const cadence of cadences) {
        const runs = report.runs.filter(r => r.scenario === scenario.id && r.cadence === cadence);
        assert.equal(new Set(runs.map(r => r.tapeSha256)).size, 1);
        assert.equal(new Set(runs.map(r => r.observations)).size, 1);
        for (const run of runs) {
            assert.equal(run.correct + run.wrong + run.fallbacks, run.observations);
            assert.equal(run.nodeFirings, (run.variant === "t1" ? 8 : 12) * run.observations);
            assert.ok(run.spikes <= run.observations * 2);
            assert.ok(Number.isFinite(run.timing.p95Ms) && run.timing.p95Ms >= run.timing.p50Ms);
        }
    }
});

test("the stable case distinguishes replay coverage from spike count and from total traversals", () => {
    const stable = cases.find(c => c.id === "stable-a");
    const rows = variants.map(v => measureCase(stable, "1", v));
    assert.deepEqual(rows.map(r => r.correct), [21, 18, 6, 18]);
    assert.deepEqual(rows.map(r => r.fallbacks), [0, 3, 15, 3]);
    assert.deepEqual(rows.map(r => r.spikes), [0, 0, 6, 18]);
    assert.deepEqual(rows.map(r => r.nodeFirings), [168, 252, 252, 252]);
});

test("the tape declares boundaries and missing measurements independently of the controller", () => {
    for (const scenario of cases) for (const cadence of cadences) {
        const tape = createTape(scenario, cadence);
        assert.deepEqual(tape, createTape(scenario, cadence));
        assert.ok(tape.every((x, i) => i === 0 || x.timeSeconds > tape[i - 1].timeSeconds));
        assert.ok(tape.every(x => !Object.hasOwn(x.features, "expected") && !Object.hasOwn(x.features, "scenario")));
    }
    assert.throws(() => createTape(cases[0], "bad"));
});

test("misleading observations cannot be distinguished using report-only truth", () => {
    const stable = cases.find(c => c.id === "stable-a"), misleading = cases.find(c => c.id === "misleading");
    for (const variant of variants) {
        const a = measureCase(stable, "1", variant), b = measureCase(misleading, "1", variant);
        assert.deepEqual(b.frames.map(f => f.route), a.frames.slice(0, b.frames.length).map(f => f.route));
        assert.equal(b.correct, 0); assert.equal(b.latencies[0].latencySeconds, null);
    }
});

test("conflicts and cut paths retain their failures and non-recoveries in the report", () => {
    for (const variant of variants) {
        const conflict = measureCase(cases.find(c => c.id === "conflict"), "1", variant);
        assert.equal(conflict.wrong, conflict.frames.filter(f => f.route !== null && f.route !== f.expected).length);
        const cut = measureCase(cases.find(c => c.id === "cut"), "1", variant);
        assert.equal(cut.selected, 0); assert.equal(cut.fallbacks, cut.observations);
        assert.equal(cut.latencies[0].latencySeconds, null);
    }
});
