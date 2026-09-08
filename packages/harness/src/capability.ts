import type { CapabilityDescriptor, CapabilityResult, ExecutionContext, JsonValue, PolicyDecision, SafetyGuard, DecisionContext } from "./model.js";
import { assertJson, checkAbort, compileInputSchema, immutableCopy, validateDecision } from "./validation.js";

export interface HarnessCapability {
    readonly descriptor: CapabilityDescriptor;
    execute(input: JsonValue, context: ExecutionContext): Promise<CapabilityResult>;
    isAvailable?(context: ExecutionContext): Promise<boolean> | boolean;
}

export interface CapabilityRegistryOptions {
    /** Host-owned approval, requested again for every invocation, including learned replays. */
    readonly approve?: (decision: PolicyDecision, context: ExecutionContext) => Promise<boolean>;
}

export class CapabilityRegistry {
    private readonly capabilities = new Map<string, HarnessCapability>();
    private readonly validators = new Map<string, (value: unknown) => void>();
    private inFlight = false;

    public constructor(private readonly options: CapabilityRegistryOptions = {}) {}

    public register(capability: HarnessCapability): void {
        const descriptor = immutableCopy(capability.descriptor);
        if (!descriptor.id || this.capabilities.has(descriptor.id)) throw new Error(`Invalid or duplicate capability: ${descriptor.id}`);
        if (descriptor.replayPolicy && !["automatic", "approval-required", "never"].includes(descriptor.replayPolicy)) {
            throw new Error("Invalid replay policy");
        }
        this.validators.set(descriptor.id, descriptor.inputSchema === undefined ? assertJson : compileInputSchema(descriptor.inputSchema));
        this.capabilities.set(descriptor.id, {
            descriptor, execute: capability.execute.bind(capability), isAvailable: capability.isAvailable?.bind(capability),
        });
    }

    public get(id: string): HarnessCapability | undefined { return this.capabilities.get(id); }
    public list(): CapabilityDescriptor[] { return [...this.capabilities.values()].map(c => c.descriptor); }

    public async listAvailable(context: ExecutionContext): Promise<CapabilityDescriptor[]> {
        const available: CapabilityDescriptor[] = [];
        for (const capability of this.capabilities.values()) {
            checkAbort(context.signal);
            if (capability.descriptor.replayPolicy === "never") continue;
            if (capability.descriptor.replayPolicy === "approval-required" && !this.options.approve) continue;
            if (!capability.isAvailable || await capability.isAvailable(context)) available.push(capability.descriptor);
        }
        checkAbort(context.signal);
        return available;
    }

    public validate(decision: PolicyDecision): void {
        validateDecision(decision);
        const capability = this.get(decision.invocation.capabilityId);
        if (!capability) throw new Error(`Unknown capability: ${decision.invocation.capabilityId}`);
        if (capability.descriptor.replayPolicy === "never") throw new Error("Capability forbidden to the harness");
        this.validators.get(capability.descriptor.id)!(decision.invocation.input);
    }

    public async execute(decision: PolicyDecision, context: ExecutionContext, beforeExecute?: () => Promise<void>): Promise<CapabilityResult> {
        checkAbort(context.signal);
        this.validate(decision);
        if (this.inFlight) throw new Error("A previous capability execution is still in flight; reconcile it before retrying");
        this.inFlight = true;
        try {
            const capability = this.get(decision.invocation.capabilityId)!;
            if (capability.isAvailable && !await capability.isAvailable(context)) throw new Error("Capability unavailable");
            checkAbort(context.signal);
            if (capability.descriptor.replayPolicy === "approval-required") {
                if (!this.options.approve || !await this.options.approve(immutableCopy(decision), context)) throw new Error("Approval required or denied");
            }
            checkAbort(context.signal);
            await beforeExecute?.();
            checkAbort(context.signal);
            const result = await capability.execute(immutableCopy(decision.invocation.input), context);
            checkAbort(context.signal);
            assertJson(result);
            if (typeof result.ok !== "boolean") throw new Error("Invalid capability result");
            return immutableCopy(result);
        } finally {
            this.inFlight = false;
        }
    }
}

/** Explicitly permissive local default; production hosts must inject their own guard. */
export class AllowAllSafetyGuard implements SafetyGuard {
    public async validate(_decision: PolicyDecision, _context: DecisionContext) { return { allowed: true }; }
}
