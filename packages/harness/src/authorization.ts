import type { CapabilityRegistry } from "./capability.js";
import type { AuthorizedDecision, ExecutedDecision, SelectedDecision } from "./contracts.js";
import type { DecisionContext, ExecutionContext, Intention, JsonValue, SafetyGuard, StateObserver } from "./model.js";
import { stableStringify } from "./canonical.js";
import { immutableCopy, validateDecision, validateIntention, validateState } from "./validation.js";

export interface ExecutionAuthorityOptions {
    readonly decisionId: string;
    readonly intention: Intention;
    readonly signal: AbortSignal;
    readonly capabilities: CapabilityRegistry;
    readonly guard: SafetyGuard;
    readonly observer: StateObserver;
    readonly assertActive: () => void;
}

/** Authorization is enforced at the actuator boundary, independent of node wiring. */
export class ExecutionAuthority {
    readonly #permits = new Map<string, SelectedDecision>();
    #started = false;
    #completed?: ExecutedDecision;

    public constructor(private readonly options: ExecutionAuthorityOptions) {}

    public context(context: DecisionContext): ExecutionContext {
        this.options.assertActive();
        validateState(context.state); validateIntention(context.intention);
        if (stableStringify(context.intention as unknown as JsonValue) !== stableStringify(this.options.intention as unknown as JsonValue)) {
            throw new Error("Foreign decision intention");
        }
        return Object.freeze({ decisionId: this.options.decisionId, state: context.state,
            intention: context.intention, signal: this.options.signal });
    }

    public listAvailable(context: DecisionContext) {
        return this.options.capabilities.listAvailable(this.context(context));
    }

    public async authorize(value: SelectedDecision): Promise<AuthorizedDecision> {
        this.options.assertActive();
        if (this.#started) throw new Error("A capability was already dispatched for this decision");
        const selected = immutableCopy(value);
        this.context(selected.context);
        validateDecision(selected.decision);
        this.options.capabilities.validate(selected.decision);
        const result = await this.options.guard.validate(selected.decision, selected.context);
        this.options.assertActive();
        if (result.allowed !== true) throw new Error(result.reason ?? "Decision rejected by safety guard");
        const authorizationId = globalThis.crypto.randomUUID();
        this.#permits.set(authorizationId, selected);
        return Object.freeze({ authorizationId });
    }

    public async execute(receipt: AuthorizedDecision): Promise<ExecutedDecision> {
        this.options.assertActive();
        const selected = receipt && this.#permits.get(receipt.authorizationId);
        if (!selected) throw new Error("Missing, foreign or consumed execution authorization");
        if (this.#started) throw new Error("A capability was already dispatched for this decision");
        this.#started = true;
        this.#permits.clear();
        const result = await this.options.capabilities.execute(selected.decision, this.context(selected.context), async () => {
            const current = immutableCopy(await this.options.observer.observe());
            validateState(current);
            this.options.assertActive();
            if (stableStringify(current as unknown as JsonValue) !== stableStringify(selected.context.state as unknown as JsonValue)) {
                throw new Error("Stale decision: observed world changed before execution");
            }
        });
        this.options.assertActive();
        this.#completed = immutableCopy({ ...selected, result });
        return this.#completed;
    }

    public assertExecuted(value: ExecutedDecision): void {
        this.options.assertActive();
        const actual = immutableCopy({ context: value.context, decision: value.decision, candidate: value.candidate, result: value.result });
        if (!this.#completed || stableStringify(actual as unknown as JsonValue) !== stableStringify(this.#completed as unknown as JsonValue)) {
            throw new Error("Experience does not belong to a completed execution in this session");
        }
    }

    public close(): void { this.#permits.clear(); }
}

