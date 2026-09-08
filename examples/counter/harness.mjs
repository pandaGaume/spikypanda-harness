import { createPolicyFlowDefinition } from "../shared/policy-flow.mjs";

/** The Counter scenario belongs to the sample, never to the generic library. */
export function createCounterHarness(target = 3) {
    return createPolicyFlowDefinition({ id: "reach-target", parameters: { target } });
}
