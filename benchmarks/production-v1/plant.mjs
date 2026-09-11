import { freeze, suite } from "./scenario.mjs";

export const ACTIONS = suite.actions;
export function validAction(id) { return typeof id === "string" && ACTIONS.some(a => a.id === id); }
/** Common host envelope. A refusal is not an executed command or proof of observer quality. */
export function authorize(id, observation) {
    if (!validAction(id)) return { allowed: false, reason: "invalid-action", effective: "stop" };
    if (id !== "stop" && (observation.temperatureC === null || observation.temperatureC >= suite.objective.temperatureLimitC)) {
        return { allowed: false, reason: "temperature-guard", effective: "stop" };
    }
    return { allowed: true, reason: null, effective: id };
}
/** Synthetic continuous stock/thermal model, not a calibrated industrial digital twin.
 * Frames and true state are owned by the evaluator, never passed to a controller.
 * Exogenous changes affect the interval AFTER its pre-action observation.
 */
export class ProductionPlant {
    constructor(testCase) {
        this.testCase = testCase; this.tick = 0; this.pending = []; this.command = ACTIONS.find(a => a.id === "balanced");
        this.state = { ...testCase.initial, speed: 0, currentA: 0.5, vibration: 0.04, coolant: 0.65,
            goodParts: 0, rejectedParts: 0, overflowParts: 0, arrivedParts: 0, energyKwh: 0, interlock: false, producedLastStep: 0 };
    }
    observe() {
        const s = this.state;
        // Last completed interval's sensor status. Never reveal the next interval's fault.
        const frame = this.tick === 0 ? { temperatureMissing: 0, temperatureBias: 0, vibrationBias: 0, ambientC: s.temperatureC - 4,
            noise: { temperature: 0, current: 0, vibration: 0, cooling: 0 } } : this.testCase.frames[this.tick - 1];
        return freeze({ step: this.tick, timeSeconds: this.tick * suite.stepSeconds, temperatureC: frame.temperatureMissing ? null : s.temperatureC + frame.temperatureBias + frame.noise.temperature,
            speed: s.speed, currentA: s.currentA + frame.noise.current,
            vibration: Math.max(0, s.vibration + frame.vibrationBias + frame.noise.vibration),
            coolantFlow: Math.max(0, s.coolant + frame.noise.cooling), ambientC: frame.ambientC,
            queueParts: s.queueParts, goodParts: s.goodParts, rejectedParts: s.rejectedParts,
            overflowParts: s.overflowParts, producedLastStep: s.producedLastStep, interlock: s.interlock,
            appliedAction: this.command.id });
    }
    advance(actionId) {
        if (!validAction(actionId)) throw new Error("Unknown action");
        if (this.tick >= this.testCase.frames.length) throw new Error("Scenario complete");
        const frame = this.testCase.frames[this.tick], s = this.state, dt = suite.stepSeconds;
        const action = ACTIONS.find(a => a.id === actionId);
        this.pending.push({ due: this.tick + frame.delaySteps, issued: this.tick, action });
        // Reject delayed stale commands after a newer command was applied.
        const due = this.pending.filter(p => p.due <= this.tick).sort((a, b) => a.issued - b.issued);
        for (const p of due) if (p.issued >= (this.lastApplied ?? -1)) { this.command = p.action; this.lastApplied = p.issued; }
        this.pending = this.pending.filter(p => p.due > this.tick && p.issued > (this.lastApplied ?? -1));
        const interlock = s.temperatureC >= 92;
        const drive = interlock ? 0 : this.command.drive, fan = interlock ? 1 : this.command.fan;
        s.speed += 0.3 * (drive / (1 + 0.7 * frame.friction + 0.1 * frame.load) - s.speed);
        s.currentA = 0.5 + 4 * drive * (frame.load + 2 * frame.friction);
        s.coolant = fan * frame.cooling;
        s.vibration = 0.04 + 0.08 * s.speed + 0.35 * frame.friction * s.speed ** 2;
        const powerKw = 0.05 + 0.012 * s.currentA ** 2 + 0.4 * fan ** 3;
        s.temperatureC += dt * (0.09 * s.currentA ** 2 - frame.cooling * (0.05 + 0.35 * fan) * (s.temperatureC - frame.ambientC));
        const available = s.queueParts + frame.arrivals;
        const processed = Math.min(available, 1.6 * s.speed * dt);
        const rejectedFraction = Math.max(0, Math.min(0.8, (s.temperatureC - 60) / 35 + 0.04 * frame.friction * drive));
        const good = processed * (1 - rejectedFraction), rejected = processed - good;
        const overflow = Math.max(0, available - processed - 80);
        s.queueParts = available - processed - overflow;
        s.goodParts += good; s.rejectedParts += rejected; s.overflowParts += overflow;
        s.arrivedParts += frame.arrivals; s.energyKwh += powerKw * dt / 3600;
        s.interlock = interlock; s.producedLastStep = good;
        const truth = freeze({ tick: this.tick, seconds: dt, temperatureC: s.temperatureC, queueParts: s.queueParts,
            goodParts: good, rejectedParts: rejected, overflowParts: overflow, arrivals: frame.arrivals,
            energyKwh: powerKw * dt / 3600, interlock, actualAction: interlock ? "interlock-stop" : this.command.id });
        this.tick++;
        return { truth, observation: this.observe() };
    }
}
