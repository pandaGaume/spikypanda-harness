import { pairedDelta, quantile } from "./metrics.mjs";
const ordered = value => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));
function runMap(report) {
    if (report?.reportVersion !== 2 || !Array.isArray(report.runs) || report.plannedRuns !== report.runs.length) throw new Error("Invalid or incomplete report");
    const runs = new Map();
    for (const run of report.runs) {
        if (!run.caseId || runs.has(run.caseId) || !["completed", "controller-error", "setup-error"].includes(run.status)) throw new Error("Invalid or duplicate case");
        runs.set(run.caseId, run);
    }
    if (!runs.size) throw new Error("Empty comparison");
    return runs;
}
/** Matched cases only. Failed full traces stay scored; setup failures stay visible without fabricated metrics. */
export function compareReports(left, right) {
    const a = runMap(left), b = runMap(right);
    if (left.benchmark !== right.benchmark || left.split !== right.split || a.size !== b.size ||
        left.referenceKernelHash !== right.referenceKernelHash) throw new Error("Incompatible reports");
    const pairs = [...a].map(([id, x]) => {
        const y = b.get(id);
        if (!y || !x.identity || ordered(x.identity) !== ordered(y.identity)) throw new Error("Incomparable case: " + id);
        const complete = x.status === "completed" && y.status === "completed";
        return { caseId: id, leftStatus: x.status, rightStatus: y.status, bothCompleted: complete,
            leftError: x.error ?? null, rightError: y.error ?? null,
            ...(x.metrics && y.metrics ? { delta: pairedDelta(x, y).deltas } : { delta: null }) };
    });
    const keys = [...new Set(pairs.flatMap(p => Object.keys(p.delta ?? {})))];
    return { left: left.controller, right: right.controller, pairedCases: pairs.length,
        bothCompleted: pairs.filter(p => p.bothCompleted).length,
        pairsWithoutMetrics: pairs.filter(p => !p.delta).length,
        failures: pairs.filter(p => !p.bothCompleted),
        deltas: keys.map(metric => {
            const values = pairs.flatMap(p => p.delta ? [p.delta[metric]] : []);
            return { metric, measuredPairs: values.length, median: quantile(values, 0.5),
                minimum: Math.min(...values), maximum: Math.max(...values) };
        }), pairs,
        interpretation: "right-minus-left; physical deltas only; no aggregate winner or generalization claim" };
}
