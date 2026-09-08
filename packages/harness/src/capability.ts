import type {
    CapabilityDescriptor,
    CapabilityResult,
    ExecutionContext,
    JsonValue,
    PolicyDecision,
    SafetyDecision,
    SafetyGuard,
    DecisionContext,
} from "./model.js";

export interface HarnessCapability {
    readonly descriptor: CapabilityDescriptor;
    execute(input: JsonValue, context: ExecutionContext): Promise<CapabilityResult>;
    isAvailable?(context: ExecutionContext): Promise<boolean> | boolean;
}

export class CapabilityRegistry {
    private readonly capabilities = new Map<string, HarnessCapability>();

    public register(capability: HarnessCapability): void {
        if (this.capabilities.has(capability.descriptor.id)) {
            throw new Error(`Capability already registered: ${capability.descriptor.id}`);
        }
        this.capabilities.set(capability.descriptor.id, capability);
    }

    public get(id: string): HarnessCapability | undefined {
        return this.capabilities.get(id);
    }

    public list(): CapabilityDescriptor[] {
        return [...this.capabilities.values()].map((capability) => capability.descriptor);
    }

    public async listAvailable(context: ExecutionContext): Promise<CapabilityDescriptor[]> {
        const available: CapabilityDescriptor[] = [];
        for (const capability of this.capabilities.values()) {
            if (!capability.isAvailable || (await capability.isAvailable(context))) available.push(capability.descriptor);
        }
        return available;
    }

    public async execute(decision: PolicyDecision, context: ExecutionContext): Promise<CapabilityResult> {
        const capability = this.capabilities.get(decision.invocation.capabilityId);
        if (!capability) return { ok: false, error: `Unknown capability: ${decision.invocation.capabilityId}` };
        if (capability.descriptor.replayPolicy === "never") {
            return { ok: false, error: `Capability cannot be executed by a harness: ${capability.descriptor.id}` };
        }
        if (capability.isAvailable && !(await capability.isAvailable(context))) {
            return { ok: false, error: `Capability unavailable: ${capability.descriptor.id}` };
        }
        try {
            return await capability.execute(decision.invocation.input, context);
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
}

export class AllowAllSafetyGuard implements SafetyGuard {
    public async validate(_decision: PolicyDecision, _context: DecisionContext): Promise<SafetyDecision> {
        return { allowed: true };
    }
}

