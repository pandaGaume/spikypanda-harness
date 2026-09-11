import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
};
export const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const suite = freeze(JSON.parse(readFileSync(new URL("./suite.json", import.meta.url), "utf8")));
const allowed = new Set(["load", "friction", "cooling", "temperatureMissing", "temperatureBias", "vibrationBias", "delaySteps"]);
export function validateSuite(value) {
    if (!value || value.version !== "0.2.0" || value.stepSeconds !== 1 || value.horizonSteps !== 600 ||
        value.contractVersion !== "2" || value.metricsVersion !== "2" || value.generatorVersion !== "1" || value.plantVersion !== "1" ||
        !Array.isArray(value.scenarios) || !value.scenarios.length || !Array.isArray(value.actions) || !value.actions.length) {
        throw new Error("Unsupported or invalid benchmark suite");
    }
    if (value.objective.temperatureLimitC !== 80 || value.objective.queueLimitParts !== 40 ||
        value.objective.recoveryHoldSteps !== 10 || value.objective.recoveryWindowSteps !== 90 ||
        value.objective.serviceFraction !== 0.9 || value.timing.deadlineMs !== 1000 ||
        value.memoryProtocol !== "cold-per-case-online-within-case") throw new Error("Version the benchmark before changing its contract");
    const ids = new Set(), seeds = new Set();
    for (const action of value.actions) {
        if (ids.has(action.id) || typeof action.id !== "string" || !action.id ||
            ![action.drive, action.fan].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("Invalid action");
        ids.add(action.id);
    }
    if (!value.actions.some(a => a.id === "stop" && a.drive === 0 && a.fan === 1)) throw new Error("Missing fail-safe action");
    for (const split of ["development", "regression", "evaluation"]) {
        if (!Array.isArray(value.splits?.[split]) || !value.splits[split].length) throw new Error("Missing split");
        for (const seed of value.splits[split]) {
            if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff || seeds.has(seed)) throw new Error("Invalid or overlapping seeds");
            seeds.add(seed);
        }
    }
    ids.clear();
    for (const scenario of value.scenarios) {
        if (ids.has(scenario.id) || typeof scenario.id !== "string" || !scenario.id || !["service", "stress"].includes(scenario.role) || !Array.isArray(scenario.events)) throw new Error("Invalid scenario");
        ids.add(scenario.id);
        for (const event of scenario.events) {
            if (!Number.isInteger(event.at) || event.at < 30 || !Number.isInteger(event.duration) || event.duration < 20 ||
                event.at + event.duration > value.horizonSteps - 30 || typeof event.probeRecovery !== "boolean" ||
                !event.patch || !Object.keys(event.patch).length ||
                Object.keys(event.patch).some(k => !allowed.has(k)) ||
                Object.values(event.patch).some(n => !Number.isFinite(n)) ||
                (event.rampSteps !== undefined && (!Number.isInteger(event.rampSteps) || event.rampSteps < 1 || event.rampSteps > event.duration))) throw new Error("Invalid disturbance");
            for (const [key, n] of Object.entries(event.patch)) {
                const range = { load: [0.5, 2], friction: [0, 2], cooling: [0.1, 1],
                    temperatureMissing: [0, 1], temperatureBias: [-30, 30], vibrationBias: [-0.4, 0.4], delaySteps: [0, 8] }[key];
                if (n < range[0] || n > range[1] || (["temperatureMissing", "delaySteps"].includes(key) && !Number.isInteger(n))) throw new Error("Disturbance out of bounds");
            }
        }
    }
}
validateSuite(suite);

/** Counter-based noise: action choice and number of observations cannot shift the random stream. */
export function uniform(seed, channel, tick) {
    let x = (seed ^ Math.imul(channel + 1, 0x9e3779b1) ^ Math.imul(tick + 1, 0x85ebca6b)) >>> 0;
    x = Math.imul(x ^ x >>> 16, 0x7feb352d); x = Math.imul(x ^ x >>> 15, 0x846ca68b);
    return ((x ^ x >>> 16) >>> 0) / 4294967296;
}
export function generateCase(scenarioId, seed, definition = suite) {
    validateSuite(definition);
    const scenario = definition.scenarios.find(s => s.id === scenarioId);
    if (!scenario || !Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) throw new Error("Unknown scenario or invalid seed");
    const events = scenario.events.map((e, i) => ({ ...e, at: e.at + Math.floor(uniform(seed, 30 + i, 0) * 37) - 18 }));
    const ambient = 22 + (uniform(seed, 0, 0) - 0.5) * 2;
    const frames = Array.from({ length: definition.horizonSteps }, (_, tick) => {
        const base = { load: 1, friction: 0, cooling: 1, temperatureMissing: 0, temperatureBias: 0, vibrationBias: 0, delaySteps: 0 };
        for (const event of events) if (tick >= event.at && tick < event.at + event.duration) {
            const ratio = event.rampSteps ? Math.min(1, (tick - event.at + 1) / event.rampSteps) : 1;
            for (const [key, target] of Object.entries(event.patch)) base[key] += (target - base[key]) * ratio;
        }
        base.delaySteps = Math.round(base.delaySteps);
        return { ...base, ambientC: ambient, arrivals: 0.8 + 0.12 * (uniform(seed, 1, tick) - 0.5),
            noise: { temperature: (uniform(seed, 2, tick) - 0.5) * 0.6,
                current: (uniform(seed, 3, tick) - 0.5) * 0.08,
                vibration: (uniform(seed, 4, tick) - 0.5) * 0.025,
                cooling: (uniform(seed, 5, tick) - 0.5) * 0.02 } };
    });
    const markers = events.flatMap((e, i) => [
        { tick: e.at, id: "event-" + i + "-start", kind: "start", changes: e.patch, probeRecovery: e.probeRecovery },
        { tick: e.at + e.duration, id: "event-" + i + "-return", kind: "return", changes: e.patch, probeRecovery: e.probeRecovery },
    ]).sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    const result = { id: scenarioId + ":" + seed, scenarioId, seed, initial: { temperatureC: ambient + 4, queueParts: 5 },
        frames, markers };
    return freeze({ ...result, tapeHash: sha256(result), suiteHash: sha256(definition) });
}
export function caseList(split = "development", definition = suite) {
    validateSuite(definition);
    if (!Object.hasOwn(definition.splits, split)) throw new Error("Unknown split");
    return definition.scenarios.flatMap(s => definition.splits[split].map(seed => ({ scenarioId: s.id, seed })));
}
