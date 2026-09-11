import { suite } from "./scenario.mjs";
export function quantile(values, p) {
    if (!Number.isFinite(p) || p < 0 || p > 1 || values.some(n => !Number.isFinite(n))) throw new Error("Invalid quantile");
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
export function summarizeRun(rows, testCase, objective = suite.objective) {
    if (!Array.isArray(rows) || !rows.length || rows.length > testCase.frames.length) throw new Error("Missing or excessive trace");
    for (const [i, r] of rows.entries()) {
        if (r.tick !== i || r.seconds !== suite.stepSeconds ||
            !["temperatureC", "queueParts", "goodParts", "rejectedParts", "overflowParts", "arrivals", "energyKwh", "decisionWallMs", "learnWallMs"].every(k => Number.isFinite(r[k])) ||
            ["queueParts", "goodParts", "rejectedParts", "overflowParts", "arrivals", "energyKwh", "decisionWallMs", "learnWallMs"].some(k => r[k] < 0) ||
            !["guardRefused", "invalidAction", "controllerError", "deadlineMissed", "interlock", "decisionAttempted"].every(k => typeof r[k] === "boolean")) throw new Error("Malformed trace row");
    }
    const decisionTimes = rows.filter(r => r.decisionAttempted).map(r => r.decisionWallMs);
    const controlTimes = rows.filter(r => r.decisionAttempted).map(r => r.decisionWallMs + r.learnWallMs);
    const sum = key => rows.reduce((n, r) => n + r[key], 0);
    const duration = sum("seconds"), good = sum("goodParts"), rejected = sum("rejectedParts");
    const demand = testCase.initial.queueParts + sum("arrivals");
    const unsafe = r => r.temperatureC > objective.temperatureLimitC || r.queueParts > objective.queueLimitParts;
    const recoveries = testCase.markers.filter(e => e.probeRecovery && e.tick < rows.length).map(event => {
        const next = testCase.markers.find(e => e.tick > event.tick)?.tick ?? testCase.frames.length;
        const end = Math.min(next, rows.length, event.tick + objective.recoveryWindowSteps);
        let seconds = null, streak = 0;
        for (let i = event.tick; i < end; i++) {
            const r = rows[i];
            streak = !unsafe(r) && r.goodParts >= r.arrivals * objective.serviceFraction && !r.controllerError ? streak + 1 : 0;
            if (streak === objective.recoveryHoldSteps) { seconds = (i - event.tick + 1) * suite.stepSeconds; break; }
        }
        return { marker: event.id, kind: event.kind, atStep: event.tick, seconds,
            observationWindowSeconds: (end - event.tick) * suite.stepSeconds,
            censored: seconds === null, interruptedByNextEvent: next === end && next < testCase.frames.length };
    });
    const metrics = {
        plannedSeconds: testCase.frames.length * suite.stepSeconds, evaluatedSeconds: duration,
        completedTrace: rows.length === testCase.frames.length,
        goodParts: good, rejectedParts: rejected, overflowParts: sum("overflowParts"), totalDemandParts: demand,
        fulfillmentRatio: demand ? good / demand : null,
        throughputPartsPerMinute: good / duration * 60,
        rejectionRatio: good + rejected ? rejected / (good + rejected) : null,
        queuePartSeconds: rows.reduce((n, r) => n + r.queueParts * r.seconds, 0),
        peakQueueParts: Math.max(...rows.map(r => r.queueParts)),
        peakTemperatureC: Math.max(...rows.map(r => r.temperatureC)),
        constraintViolationSeconds: rows.filter(unsafe).reduce((n, r) => n + r.seconds, 0),
        thermalViolationSeconds: rows.filter(r => r.temperatureC > objective.temperatureLimitC).reduce((n, r) => n + r.seconds, 0),
        queueViolationSeconds: rows.filter(r => r.queueParts > objective.queueLimitParts).reduce((n, r) => n + r.seconds, 0),
        thermalExcessDegreeSeconds: rows.reduce((n, r) => n + Math.max(0, r.temperatureC - objective.temperatureLimitC) * r.seconds, 0),
        queueExcessPartSeconds: rows.reduce((n, r) => n + Math.max(0, r.queueParts - objective.queueLimitParts) * r.seconds, 0),
        energyKwh: sum("energyKwh"), kwhPer100GoodParts: good ? sum("energyKwh") / good * 100 : null,
        interlockSeconds: rows.filter(r => r.interlock).reduce((n, r) => n + r.seconds, 0),
        guardRefusals: rows.filter(r => r.guardRefused).length,
        invalidActions: rows.filter(r => r.invalidAction).length,
        unavailableSteps: rows.filter(r => r.controllerError).length,
        deadlineMisses: rows.filter(r => r.deadlineMissed).length,
        decisionAttempts: decisionTimes.length,
        decisionMsP50: quantile(decisionTimes, 0.5),
        decisionMsP95: quantile(decisionTimes, 0.95),
        decisionMsMax: decisionTimes.length ? Math.max(...decisionTimes) : null,
        learningMsTotal: sum("learnWallMs"),
        controlMsP50: quantile(controlTimes, 0.5), controlMsP95: quantile(controlTimes, 0.95),
        controlMsMax: controlTimes.length ? Math.max(...controlTimes) : null,
        recoveries, recoveredEvents: recoveries.filter(r => !r.censored).length,
        observedEvents: recoveries.length,
        recoverySecondsMedianAmongRecovered: quantile(recoveries.flatMap(r => r.seconds === null ? [] : [r.seconds]), 0.5),
    };
    // Candidate product gate, not a weighted score or an irreversible learning parameter.
    metrics.meetsCandidateEnvelope = metrics.completedTrace && metrics.constraintViolationSeconds === 0 && metrics.unavailableSteps === 0 &&
        metrics.invalidActions === 0 && metrics.deadlineMisses === 0 && metrics.fulfillmentRatio >= objective.serviceFraction;
    return metrics;
}
const compareKeys = ["suiteHash", "tapeHash", "contractVersion", "metricsVersion", "plantSourceHash", "generatorSourceHash",
    "metricSourceHash", "runnerSourceHash", "memoryProtocol", "providerFingerprint", "track"];
export function pairedDelta(left, right) {
    if (left.caseId !== right.caseId || compareKeys.some(k => !left.identity?.[k] || left.identity[k] !== right.identity?.[k])) throw new Error("Incomparable runs");
    const deltas = {};
    for (const key of ["goodParts", "constraintViolationSeconds", "thermalViolationSeconds", "queueViolationSeconds", "thermalExcessDegreeSeconds", "queuePartSeconds", "energyKwh", "guardRefusals", "invalidActions"]) {
        if (!Number.isFinite(left.metrics[key]) || !Number.isFinite(right.metrics[key])) throw new Error("Missing comparable metric");
        deltas[key] = right.metrics[key] - left.metrics[key];
    }
    return { caseId: left.caseId, left: left.controllerId, right: right.controllerId, deltas,
        interpretation: "right-minus-left; no aggregate winner; timing needs isolated repeated runs" };
}
