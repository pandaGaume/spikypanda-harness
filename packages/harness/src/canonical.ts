import type { DecisionContext, Intention, JsonValue, State } from "./model.js";

export function stableStringify(value: JsonValue | ReadonlyArray<JsonValue>): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    const record = value as Readonly<Record<string, JsonValue>>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
        .join(",")}}`;
}

export function contextKey(state: State, intention: Intention): string {
    return stableStringify([state.id, intention.id]);
}

export function createDecisionContext(state: State, intention: Intention): DecisionContext {
    return { key: contextKey(state, intention), state, intention };
}

export function transitionKey(context: DecisionContext, actionId: string, capabilityId: string, input: JsonValue): string {
    return stableStringify([context.key, actionId, capabilityId, stableStringify(input)]);
}

