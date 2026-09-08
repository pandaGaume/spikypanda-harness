import type { State, StateMatcher } from "./model.js";

export class ExactStateMatcher implements StateMatcher {
    public similarity(a: State, b: State): number {
        return a.id === b.id ? 1 : 0;
    }
}

