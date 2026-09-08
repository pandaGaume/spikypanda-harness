import { HARNESS_NODES } from "../../packages/harness/dist/index.js";

/** Example topology, not a default imposed by the harness library. */
export function createPolicyFlowDefinition(intention) {
    const positions = [[30, 40], [280, 40], [530, 40], [780, 40], [780, 240], [1040, 240],
        [1040, 40], [1300, 40], [1560, 40], [1560, 430], [1300, 430], [1040, 430]];
    const nodes = HARNESS_NODES.map((entry, i) => ({ id: new entry.ctor().stage, type: entry.type, x: positions[i][0], y: positions[i][1] }));
    const edges = [
        ["observe", "state", "context", "state"], ["context", "context", "lookup", "context"],
        ["lookup", "candidates", "gate", "candidates"], ["gate", "policy", "merge", "policy"],
        ["gate", "fallback", "request", "fallback"], ["request", "request", "reason", "request"],
        ["reason", "decision", "merge", "reasoning"], ["merge", "decision", "guard", "decision"],
        ["guard", "authorized", "execute", "authorized"], ["execute", "result", "observe-after", "result"],
        ["observe-after", "outcome", "evaluate", "outcome"], ["evaluate", "experience", "record", "experience"],
    ].map(([from, output, to, input]) => ({ from, output, to, input }));
    return { version: 1, intention, nodes, edges };
}
