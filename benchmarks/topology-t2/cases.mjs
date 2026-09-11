export const variants = ["t1", "continuous", "spikes", "spikes-modulated"];
export const cadences = ["0.25", "0.5", "1", "irregular"];
const A = { x: 1, y: 1, z: 0 }, B = { x: 0, y: 1, z: 1 };
const inside = (t, start, end) => t >= start && t < end;
/** Truth is used by the reporter only, never placed in the observer's features. */
export const cases = [
    { id: "stable-a", duration: 20, at: () => ({ features: A, expected: "a" }), targets: [[0, 20, "a"]] },
    { id: "a-b-a", duration: 24, at: t => ({ features: inside(t, 8, 16) ? B : A,
        expected: inside(t, 8, 16) ? "b" : "a" }), targets: [[0, 8, "a"], [8, 16, "b"], [16, 24, "a"]] },
    { id: "transient", duration: 14, at: t => ({ features: inside(t, 6, 6.5) ? B : A, expected: "a" }),
        targets: [[0, 6, "a"], [6.5, 14, "a"]] },
    { id: "missing", duration: 14, at: t => ({ features: inside(t, 6, 8) ? {} : A, expected: "a" }),
        targets: [[0, 6, "a"], [8, 14, "a"]] },
    { id: "gap", duration: 16, skip: t => t > 6 && t < 10, at: () => ({ features: A, expected: "a" }),
        targets: [[0, 6, "a"], [10, 16, "a"]] },
    { id: "conflict", duration: 14, at: t => ({ features: inside(t, 6, 10) ? { x: 1, y: 1, z: 1 } : A,
        expected: inside(t, 6, 10) ? null : "a" }), targets: [[0, 6, "a"], [10, 14, "a"]] },
    { id: "cut", duration: 14, cut: true, at: () => ({ features: A, expected: "a" }), targets: [[0, 14, "a"]] },
    { id: "misleading", duration: 14, at: () => ({ features: A, expected: "b" }), targets: [[0, 14, "b"]] },
];
export function createTape(scenario, cadence) {
    if (!cases.includes(scenario) || !cadences.includes(String(cadence))) throw new Error("Unknown T2 case or cadence");
    const pattern = cadence === "irregular" ? [0.2, 0.8, 0.5, 1.3, 0.7] : [Number(cadence)];
    const tape = []; let t = 0, i = 0;
    while (t <= scenario.duration) {
        if (!scenario.skip?.(t)) tape.push({ timeSeconds: t, ...structuredClone(scenario.at(t)) });
        if (t === scenario.duration) break;
        t = Math.min(scenario.duration, Math.round((t + pattern[i++ % pattern.length]) * 1e6) / 1e6);
    }
    return tape;
}
