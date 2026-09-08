import type { PolicyDecision, PolicyFallback, PolicyFallbackInput } from "@spiky-panda/harness";

export type MockResolver = (input: PolicyFallbackInput) => PolicyDecision | Promise<PolicyDecision>;

export class MockReasoningProvider implements PolicyFallback {
    public calls = 0;

    public constructor(private readonly resolver: MockResolver) {}

    public async resolve(input: PolicyFallbackInput): Promise<PolicyDecision> {
        this.calls += 1;
        return this.resolver(input);
    }
}

