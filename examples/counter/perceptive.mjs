import { AdaptiveCueObserver, OperatingContextTracker, createGraphDriver, stableStringify, parseHarnessDefinition } from "../../packages/harness/dist/index.js";
import { counterEffectSignature, createCounterHarnessV2, createCounterPolicy } from "./contextual.mjs";
import { CounterWorld, createCounterRuntime } from "./world.mjs";

// A deliberately informative simulated sensor, not an industrial model.
// The observer receives numeric measurements, never this world's direction or sensor formula.
export class CounterCueWorld extends CounterWorld {
    cueVisibility = "visible";
    sensorPolarity = 1;
    sensorBias = 0;
    seed = 7;
    current() {
        const noise = Math.sin((this.revision + this.seed) * 17.13);
        return { id: this.value < this.target ? "below" : this.value > this.target ? "above" : "at-target",
            features: { value: this.value, target: this.target, revision: this.revision,
                telemetry: {
                    driveResponse: this.cueVisibility === "hidden" ? null : this.sensorBias + this.direction * this.sensorPolarity * 0.7 +
                        noise * (this.cueVisibility === "noisy" ? 1.2 : 0.04),
                    ambient: this.cueVisibility === "hidden" ? null : Math.cos((this.revision + this.seed) * 2.71),
                } } };
    }
    async observe() { return this.current(); }
    setCueVisibility(value) {
        if (!["visible", "hidden", "noisy"].includes(value)) throw new Error("Invalid sensor setting");
        this.cueVisibility = value; this.revision++;
    }
}
export const counterCueSchema = Object.freeze({
    id: "counter.telemetry", version: 1,
    fields: [
        { id: "drive-response", path: ["telemetry", "driveResponse"], scale: 1 },
        { id: "ambient", path: ["telemetry", "ambient"], scale: 1 },
    ],
});
export function createCounterCueMemory(snapshot, plasticity, operatingConfig) {
    const observer = snapshot?.version === 3 ? AdaptiveCueObserver.restore(snapshot) :
        new AdaptiveCueObserver(createCounterPolicy(snapshot, plasticity, operatingConfig), counterCueSchema);
    if (observer.policy.modelId !== counterEffectSignature.id || stableStringify(observer.schema) !== stableStringify(counterCueSchema)) {
        throw new Error("Cette mémoire utilise un autre modèle d'indices");
    }
    return observer;
}
/** Sample-owned V1/V2 upgrade, preserving the user's graph and browser save. */
export function upgradeCounterHarnessV3(value) {
    const def = parseHarnessDefinition(value);
    const lookups = def.nodes.filter(n => ["Harness.Policy:lookup", "Harness.Policy:contextual-lookup"].includes(n.type));
    if (!lookups.length) return def;
    if (lookups.length !== 1 || def.nodes.some(n => n.type === "Harness.Observation:cues" || n.type === "Harness.Policy:cue-lookup")) {
        throw new Error("Migration Counter ambiguë : vérifiez les nœuds d'observation et de lecture");
    }
    const lookup = lookups[0], inputs = def.edges.filter(e => e.to === lookup.id && e.input === "context");
    if (inputs.length !== 1) throw new Error("La lecture doit recevoir un contexte avant sa migration V3");
    let cueId = "cues";
    while (def.nodes.some(n => n.id === cueId)) cueId += "-v3";
    return parseHarnessDefinition({ ...def,
        nodes: [...def.nodes.map(n => ({ ...n, type: n.id === lookup.id ? "Harness.Policy:cue-lookup" :
            n.type === "Harness.Learning:record" ? "Harness.Learning:contextual-record" : n.type })),
            { id: cueId, type: "Harness.Observation:cues", x: lookup.x - 200, y: lookup.y - 180 }],
        edges: [...def.edges.map(e => e === inputs[0] ? { ...e, to: cueId } : e),
            { from: cueId, output: "context", to: lookup.id, input: "context" }] });
}
export function createCounterHarnessV3(target = 3) { return upgradeCounterHarnessV3(createCounterHarnessV2(target)); }
export function createCounterRuntimeV3(cueObserver, world, options = {}) {
    const policy = cueObserver.policy, operatingContexts = new OperatingContextTracker(policy, counterEffectSignature);
    return { ...createCounterRuntime(policy, world, { ...options, cueObserver, cueMode: options.cueMode ?? "shadow", operatingContexts,
        driver: options.driver ?? createGraphDriver(createCounterHarnessV3(world.target)) }),
        operatingContexts, cueObserver, policy };
}
