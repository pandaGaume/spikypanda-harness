import "../../scripts/register-spikypanda-loader.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { signalScenarios, runSignalCase } from "./signals.mjs";
import { DEFAULT_TEMPORAL_EVIDENCE_CONFIG, DEFAULT_MODULATED_RESET_CONFIG } from "../../packages/harness/dist/index.js";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) throw new Error("Usage: npm run experiment:temporal -- [--out directory]");
const modes = ["instantaneous", "continuous", "spikes", "spikes-modulated"], runs = [];
for (const scenario of signalScenarios) for (const seed of [101, 102, 211]) for (const cadence of [0.25, 0.5, 1, 2]) {
    for (const mode of modes) {
        const started = performance.now(), run = runSignalCase(scenario, seed, cadence, mode);
        runs.push({ ...run, wallMs: performance.now() - started });
    }
}
const hash = path => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
const report = { benchmark: "temporal-evidence-signals@0.1.0", createdAt: new Date().toISOString(),
    purpose: "controlled propagation instrument, not a learned observer or an industrial benchmark",
    parameters: DEFAULT_TEMPORAL_EVIDENCE_CONFIG, resetModulation: DEFAULT_MODULATED_RESET_CONFIG, seeds: { development: [101, 102], frozenCheck: [211] },
    coverage: { calibratedCueScores: true, learnedRepresentations: false, generalizationMeasured: false },
    sources: Object.fromEntries(["./signals.mjs", "./run-signals.mjs", "../../packages/harness/dist/temporal-evidence.js",
        "../../node_modules/@spiky-panda/core/dist/neuralnetwork/snn/lif-neuron.node.js"].map(p => [p, hash(p)])),
    runs };
console.table(modes.map(mode => {
    const group = runs.filter(r => r.mode === mode), sum = field => group.reduce((n, r) => n + r.metrics[field], 0);
    return { mode, runs: group.length, wrongSeconds: sum("wrongActivationSeconds"),
        correctSeconds: sum("correctActivationSeconds"), abstentionSeconds: sum("abstentionSeconds"),
        outputEvents: group.reduce((n, r) => n + (r.work?.outputEvents ?? 0), 0) };
}));
console.log("Includes the deliberately misleading-cue case. No production or speed superiority conclusion.");
if (args.length) {
    const directory = resolve(args[1]); mkdirSync(directory, { recursive: true });
    const path = resolve(directory, "temporal-signals-" + Date.now() + "-" + randomUUID() + ".json");
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log("Report: " + path);
}
