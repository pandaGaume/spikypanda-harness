import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { suite, caseList, generateCase, sha256 } from "./scenario.mjs";
import { runCase, sourceIdentity } from "./runner.mjs";
import { quantile } from "./metrics.mjs";
import { createReferenceController, createStopController } from "./controllers/reference.mjs";

const options = { split: "development", controller: "reference", out: null, traces: false, scenario: null, seed: null };
for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--traces") options.traces = true;
    else if (["--split", "--controller", "--out", "--scenario", "--seed"].includes(arg) && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) options[arg.slice(2)] = process.argv[++i];
    else throw new Error("Unknown or incomplete option: " + arg);
}
const factories = { reference: createReferenceController, stop: createStopController };
let adapterSource = new URL("./controllers/reference.mjs", import.meta.url), dependencyLockHash = null, dependencyVersion = null;
if (options.controller === "langgraph") {
    adapterSource = new URL("../comparators/langgraph/controller.mjs", import.meta.url);
    const comparator = await import(adapterSource.href);
    factories.langgraph = comparator.createLangGraphController;
    dependencyLockHash = sha256(readFileSync(new URL("../comparators/langgraph/package-lock.json", import.meta.url), "utf8"));
    dependencyVersion = comparator.langGraphVersion;
}
if (options.controller.startsWith("harness-")) {
    await import(new URL("../../scripts/register-spikypanda-loader.mjs", import.meta.url));
    adapterSource = new URL("./controllers/harness.mjs", import.meta.url);
    const adapter = await import(adapterSource.href);
    if (!adapter.HARNESS_VARIANTS.includes(options.controller)) throw new Error("Unknown harness variant");
    factories[options.controller] = init => adapter.createProductionHarnessController(init, { variant: options.controller });
}
if (!factories[options.controller]) throw new Error("Unknown controller");
let list = caseList(options.split);
if (options.scenario) {
    if (!suite.scenarios.some(s => s.id === options.scenario)) throw new Error("Unknown scenario");
    list = list.filter(c => c.scenarioId === options.scenario);
}
if (options.seed !== null) {
    const seed = Number(options.seed);
    if (!suite.splits[options.split].includes(seed)) throw new Error("Seed is not in the selected split");
    list = list.filter(c => c.seed === seed);
}
if (!list.length) throw new Error("Empty selection");
const runs = [];
for (const item of list) {
    const testCase = generateCase(item.scenarioId, item.seed);
    try {
        const run = await runCase(testCase, factories[options.controller]);
        runs.push(options.traces ? run : (({ rows, ...rest }) => rest)(run));
    } catch (error) {
        runs.push({ caseId: testCase.id, scenarioId: item.scenarioId, seed: item.seed, status: "setup-error", metrics: null,
            error: String(error?.message ?? error), identity: { ...sourceIdentity, suiteHash: testCase.suiteHash, tapeHash: testCase.tapeHash } });
    }
}
const implementationSources = {};
function hashTree(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) hashTree(url, prefix + entry.name + "/");
        else if (/\.(js|mjs|json)$/.test(entry.name)) implementationSources[prefix + entry.name] = sha256(readFileSync(url, "utf8"));
    }
}
if (options.controller.startsWith("harness-")) {
    hashTree(new URL("../../packages/harness/dist/", import.meta.url), "harness/");
    hashTree(new URL("../../node_modules/@spiky-panda/core/dist/", import.meta.url), "core/");
    for (const name of ["harness-graph.mjs", "production-contract.mjs"]) implementationSources[name] = sha256(readFileSync(new URL("./controllers/" + name, import.meta.url), "utf8"));
}
let gitRevision = null, gitDirty = null;
try {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    gitDirty = !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch { /* Archive exports may not have Git metadata. Source hashes remain present. */ }
const report = {
    reportVersion: 2, benchmark: suite.id + "@" + suite.version, split: options.split, selection: { scenario: options.scenario, seed: options.seed === null ? null : Number(options.seed) },
    createdAt: new Date().toISOString(), coverage: suite.coverage, purpose: "closed-loop prototype comparison; not a product superiority or generalization claim",
    controller: options.controller, implementationSources, adapterSourceHash: sha256(readFileSync(adapterSource, "utf8")), dependencyLockHash, dependencyVersion,
    referenceKernelHash: sha256(readFileSync(new URL("./controllers/reference.mjs", import.meta.url), "utf8")),
    host: { node: process.version, platform: process.platform, arch: process.arch, gitRevision, gitDirty },
    plannedRuns: list.length, completedRuns: runs.filter(r => r.status === "completed").length,
    failures: runs.filter(r => r.status !== "completed").map(r => ({ caseId: r.caseId, status: r.status, error: r.error ?? r.rows?.find(s => s.error)?.error })),
    scenarios: suite.scenarios.filter(s => runs.some(r => r.scenarioId === s.id)).map(s => {
        const group = runs.filter(r => r.scenarioId === s.id), measured = group.filter(r => r.metrics);
        return { scenario: s.id, role: s.role, planned: group.length, completed: group.filter(r => r.status === "completed").length,
            goodPartsMedian: quantile(measured.map(r => r.metrics.goodParts), 0.5),
            constraintViolationSecondsMedian: quantile(measured.map(r => r.metrics.constraintViolationSeconds), 0.5),
            fulfillmentMedian: quantile(measured.map(r => r.metrics.fulfillmentRatio), 0.5),
            queuePartSecondsMedian: quantile(measured.map(r => r.metrics.queuePartSeconds), 0.5),
            kwhPer100GoodPartsMedian: quantile(measured.flatMap(r => r.metrics.kwhPer100GoodParts === null ? [] : [r.metrics.kwhPer100GoodParts]), 0.5),
            guardRefusalsMedian: quantile(measured.map(r => r.metrics.guardRefusals), 0.5),
            policyHitsMedian: quantile(measured.flatMap(r => r.controllerDiagnostics?.runtimeMetrics ? [r.controllerDiagnostics.runtimeMetrics.policyHits] : []), 0.5),
            reasonerCallsMedian: quantile(measured.flatMap(r => r.controllerDiagnostics ? [r.controllerDiagnostics.reasonerCalls] : []), 0.5),
            controlMsP95Median: quantile(measured.map(r => r.metrics.controlMsP95), 0.5),
            candidateEnvelopePasses: measured.filter(r => r.metrics.meetsCandidateEnvelope).length };
    }), runs,
};
console.table(report.scenarios);
console.log(report.completedRuns + "/" + report.plannedRuns + " completed. No architecture superiority conclusion.");
if (options.out) {
    const directory = resolve(options.out); mkdirSync(directory, { recursive: true });
    const path = resolve(directory, options.controller + "-" + options.split + "-" + Date.now() + "-" + randomUUID() + ".json");
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log("Report: " + path);
}
if (report.failures.length) process.exitCode = 1;
