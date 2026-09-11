import assert from "node:assert/strict";
import test from "node:test";
import { signalTape, runSignalCase } from "../benchmarks/temporal-v1/signals.mjs";
test("the controlled signal tape is deterministic and does not change across propagation modes", () => {
    assert.deepEqual(signalTape("weak-evidence", 101, 1), signalTape("weak-evidence", 101, 1));
    assert.notDeepEqual(signalTape("weak-evidence", 101, 1), signalTape("weak-evidence", 211, 1));
    const runs = ["instantaneous", "continuous", "spikes"].map(mode => runSignalCase("return", 101, 1, mode));
    for (const run of runs) {
        const m = run.metrics;
        assert.equal(m.correctActivationSeconds + m.wrongActivationSeconds + m.abstentionSeconds, m.measuredSeconds);
        assert.deepEqual(run.rows.map(r => r.publicEvidence), runs[0].rows.map(r => r.publicEvidence));
        assert.equal(m.episodes.length, 2);
    }
});
test("signal metrics retain both filtered transients and persistent misleading evidence", () => {
    assert.equal(runSignalCase("brief-pulse", 101, 1, "instantaneous").metrics.wrongActivationSeconds, 1);
    for (const mode of ["continuous", "spikes"]) {
        assert.equal(runSignalCase("brief-pulse", 101, 1, mode).metrics.wrongActivationSeconds, 0);
        assert.ok(runSignalCase("misleading-cue", 101, 1, mode).metrics.wrongActivationSeconds > 0);
        assert.ok(runSignalCase("persistent-switch", 101, 1, mode).metrics.episodes[0].delaySeconds > 0);
    }
});
