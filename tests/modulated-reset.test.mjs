import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Session } from "@spiky-panda/core";
import { TemporalEvidenceNetwork, DEFAULT_MODULATED_RESET_CONFIG, DEFAULT_TEMPORAL_EVIDENCE_CONFIG,
    validateModulatedResetConfig } from "../packages/harness/dist/index.js";
import { signalScenarios, runSignalCase } from "../benchmarks/temporal-v1/signals.mjs";
const config = DEFAULT_TEMPORAL_EVIDENCE_CONFIG;
const advance = (n, t, rate = 1, winner = "A") => n.advance("scope", ["A", "B"], winner, rate, t);

test("modulation changes only the post-spike residual, with an identical first crossing", () => {
    const zero = new TemporalEvidenceNetwork("spikes"), mod = new TemporalEvidenceNetwork("spikes-modulated");
    for (let t = 0; t <= 3; t++) {
        const a = advance(zero, t), b = advance(mod, t);
        assert.equal(a.modeId, b.modeId);
        assert.equal(a.units[0].spikes, b.units[0].spikes);
        if (t < 3) assert.equal(a.units[0].potential, b.units[0].potential);
        else {
            assert.equal(a.units[0].potential, 0);
            assert.equal(b.units[0].potential, config.threshold * 0.8);
            assert.equal(b.units[0].lastResetPotential, b.units[0].potential);
            assert.equal(b.units[0].resetEvidence, 1);
        }
    }
    assert.deepEqual(mod.inspect().resetModulation, DEFAULT_MODULATED_RESET_CONFIG);
    assert.ok(mod.inspect().graphs[0].nodes.some(n => n.implementation === "ModulatedResetLif"));
    assert.ok(mod.inspect().spikeEvents > 0);
});
test("the reset follows the observed evidence, not a stored or self-reinforcing confidence", () => {
    const n = new TemporalEvidenceNetwork("spikes-modulated");
    let count = 0, checked = 0;
    for (let t = 0; t < 30; t++) {
        const rate = t < 10 ? 0.6 : 0.9;
        const u = advance(n, t, rate).units[0];
        if (u.spikes > count) {
            assert.equal(u.potential, config.threshold * 0.8 * rate);
            assert.equal(u.lastResetPotential, u.potential); checked++;
        }
        count = u.spikes;
    }
    assert.ok(checked > 3);
});
test("a residual still leaks and does not emit or authorize without positive observed evidence", () => {
    const n = new TemporalEvidenceNetwork("spikes-modulated");
    let last;
    for (let t = 0; t <= 3; t++) last = advance(n, t);
    const residual = last.units[0].potential, spikes = last.units[0].spikes;
    for (let t = 4; t <= 12; t++) {
        const r = advance(n, t, 0);
        assert.equal(r.modeId, null);
        assert.equal(r.units[0].spikes, spikes);
        assert.ok(Math.abs(r.units[0].potential - residual * Math.exp(-(t - 3) / 3)) < 1e-12);
    }
    assert.equal(advance(n, 13, 1, "B").units[0].potential, 0);
});
test("alpha zero reproduces the zero-reset controller on every controlled signal tape", () => {
    for (const scenario of signalScenarios) for (const seed of [101, 102, 211]) for (const cadence of [0.25, 0.5, 1, 2]) {
        const a = runSignalCase(scenario, seed, cadence, "spikes");
        const b = runSignalCase(scenario, seed, cadence, "spikes-modulated", config, { alpha: 0 });
        assert.deepEqual(a.rows, b.rows, scenario);
        assert.deepEqual(a.metrics, b.metrics, scenario);
        assert.deepEqual(a.work, b.work, scenario);
    }
});
test("session-local resets do not mutate a shared neuron definition or another session", () => {
    const n = new TemporalEvidenceNetwork("spikes-modulated");
    for (let t = 0; t <= 3; t++) advance(n, t);
    const bank = [...n.sessionState.banks.values()][0], unit = bank.units[0];
    const a = bank.session, b = new Session(a.graph), previous = unit.neuron.stateOf(a).membranePotential;
    const source = b.nodeStateOf(unit.source);
    source.amplitude = 2; source.evidenceRate = 0.25;
    // Every input token contains the observed evidence for its own candidate and session.
    b.nodeStateOf(bank.units[1].source).evidenceRate = 0;
    b.run(10);
    assert.equal(unit.neuron.stateOf(b).membranePotential, config.threshold * 0.8 * 0.25);
    assert.equal(unit.neuron.stateOf(a).membranePotential, previous);
    assert.equal(unit.neuron.resetPotential, 0);
    assert.equal(Object.hasOwn(unit.neuron, "evidenceRate"), false);
    b.reset();
    assert.equal(b.nodeStateOf(unit.source).evidenceRate, undefined);
    assert.equal(b.nodeStateOf(unit.neuron).evidenceRate, 0);
    assert.equal(b.nodeStateOf(unit.neuron).lastResetPotential, null);
    assert.equal(unit.neuron.stateOf(b).membranePotential, 0);
    n.session.reset();
    assert.equal(n.inspect().scopes, 0);
});
test("malformed observed confidence is rejected before a modulated neuron emits", () => {
    const n = new TemporalEvidenceNetwork("spikes-modulated"); advance(n, 0);
    const bank = [...n.sessionState.banks.values()][0], unit = bank.units[0];
    bank.session.nodeStateOf(unit.source).evidenceRate = NaN;
    bank.session.nodeStateOf(unit.source).amplitude = 2;
    assert.throws(() => bank.session.run(1), /Invalid observed reset evidence/);
    assert.equal(unit.neuron.stateOf(bank.session).spikeCount, 0);
    assert.equal(unit.neuron.stateOf(bank.session).membranePotential, 0);
});
test("reset modulation is explicit, bounded and rejected on existing variants", () => {
    for (const value of [-0.1, 1, 2, NaN, Infinity]) assert.throws(() => validateModulatedResetConfig({ alpha: value }));
    for (const bad of [null, {}, { alpha: 0.8, learnedConfidence: 1 }]) assert.throws(() => validateModulatedResetConfig(bad));
    assert.throws(() => new TemporalEvidenceNetwork("spikes", config, { alpha: 0.8 }), /own variant/);
    assert.throws(() => new TemporalEvidenceNetwork("spikes-modulated", config, null), /Invalid/);
    for (const alpha of [0, 0.8, 0.999]) {
        const n = new TemporalEvidenceNetwork("spikes-modulated", config, { alpha });
        for (let t = 0; t < 12; t++) assert.ok(advance(n, t).units[0].potential < config.threshold);
    }
});

test("all 252 original signal results remain byte-identical to the pre-modulation campaign", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/temporal-signals-baseline.json", import.meta.url)));
    const runs = [];
    for (const scenario of signalScenarios) for (const seed of [101, 102, 211]) for (const cadence of [0.25, 0.5, 1, 2]) {
        for (const mode of ["instantaneous", "continuous", "spikes"]) runs.push(runSignalCase(scenario, seed, cadence, mode));
    }
    assert.equal(runs.length, golden.runs);
    assert.equal(createHash("sha256").update(JSON.stringify(runs)).digest("hex"), golden.sha256);
});
