import Ajv from "ajv";
import type { PolicyDecision, State, Intention, OutcomeEvaluation } from "./model.js";

const ajv = new Ajv({ strict: true, allErrors: true });
const decisionValidator = ajv.compile({
    type: "object", required: ["action", "invocation"], additionalProperties: false,
    properties: {
        source: { enum: ["policy", "fallback"] },
        action: { type: "object", required: ["id", "description"], additionalProperties: false,
            properties: { id: { type: "string", minLength: 1 }, description: { type: "string" } } },
        invocation: { type: "object", required: ["actionId", "capabilityId", "input"], additionalProperties: false,
            properties: { actionId: { type: "string", minLength: 1 }, capabilityId: { type: "string", minLength: 1 }, input: {} } },
        expectedOutcome: { type: "object", required: ["description"], additionalProperties: false,
            properties: { description: { type: "string" }, observableConditions: { type: "object" } } },
        rationale: { type: "string" },
    },
});

/** Reject functions, cyclic values, exotic objects and non-finite numbers. */
export function assertJson(value: unknown, ancestors = new Set<object>()): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || !value || ancestors.has(value)) throw new Error("Expected finite, acyclic JSON data");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new Error("Expected a plain JSON object");
    }
    ancestors.add(value);
    for (const item of Object.values(value)) assertJson(item, ancestors);
    ancestors.delete(value);
}

export function validateDecision(value: unknown): asserts value is PolicyDecision {
    const data = jsonCopy(value);
    assertJson(data);
    if (!decisionValidator(data)) throw new Error(`Invalid decision: ${ajv.errorsText(decisionValidator.errors)}`);
    const decision = data as PolicyDecision;
    assertJson(decision.invocation.input);
    if (decision.action.id !== decision.invocation.actionId) throw new Error("Action and invocation IDs differ");
}

/** Snapshot plain data, permitting undefined only for optional object fields. */
export function jsonCopy<T>(value: T): T {
    const visit = (item: unknown, seen: Set<object>): unknown => {
        if (item === null || typeof item === "string" || typeof item === "boolean") return item;
        if (typeof item === "number" && Number.isFinite(item)) return item;
        if (!item || typeof item !== "object" || seen.has(item)) throw new Error("Invalid JSON snapshot value");
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
            throw new Error("Snapshot must contain plain data only");
        }
        seen.add(item);
        const result = Array.isArray(item) ? item.map(value => visit(value, seen)) :
            Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).map(([key, value]) => [key, visit(value, seen)]));
        seen.delete(item);
        return result;
    };
    return visit(value, new Set()) as T;
}

export function immutableCopy<T>(value: T): T {
    const freeze = (item: unknown): void => {
        if (!item || typeof item !== "object") return;
        Object.values(item).forEach(freeze);
        Object.freeze(item);
    };
    const copy = jsonCopy(value);
    freeze(copy);
    return copy;
}

export function compileInputSchema(schema: unknown): (input: unknown) => void {
    assertJson(schema);
    const validate = ajv.compile(schema as object);
    return input => {
        assertJson(input);
        if (!validate(input)) throw new Error(`Invalid capability arguments: ${ajv.errorsText(validate.errors)}`);
    };
}

export function validateState(value: State): void {
    if (!value || typeof value.id !== "string" || !value.id || !value.features || typeof value.features !== "object" || Array.isArray(value.features)) throw new Error("Invalid observation");
    assertJson(value.features);
    if (value.embedding && (!Array.isArray(value.embedding) || !value.embedding.every(Number.isFinite))) throw new Error("Invalid embedding");
}

export function validateIntention(value: Intention): void {
    if (!value || typeof value.id !== "string" || !value.id ||
        (value.parameters !== undefined && (!value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)))) throw new Error("Invalid intention");
    if (value.parameters) assertJson(value.parameters);
}

export function validateEvaluation(value: OutcomeEvaluation): void {
    if (!value || typeof value.success !== "boolean" || !Number.isFinite(value.reward) || Math.abs(value.reward) > 1) throw new Error("Invalid outcome evaluation");
}

export function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Execution cancelled");
}

export function abortable<T>(work: () => Promise<T> | T, signal: AbortSignal): Promise<T> {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const cancel = () => reject(signal.reason ?? new Error("Execution cancelled"));
        signal.addEventListener("abort", cancel, { once: true });
        Promise.resolve().then(() => { checkAbort(signal); return work(); }).then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", cancel));
    });
}
