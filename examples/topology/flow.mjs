import { RuntimeGraphBuilder } from "@spiky-panda/core";
import { createHarnessNode } from "../../packages/harness/dist/index.js";
import { createPolicyFlowDefinition } from "../shared/policy-flow.mjs";
import { topologyIntention } from "./fixture.mjs";

/** The sample owns this flow; only the three specialized nodes come from the library. */
export function buildTopologySampleFlow({ lookup, gate, recorder }) {
    const definition = createPolicyFlowDefinition(topologyIntention);
    const replacements = { lookup, gate, record: recorder };
    const nodes = definition.nodes.map(saved => {
        const node = replacements[saved.id] ?? createHarnessNode(saved.type);
        node.id = saved.id; return node;
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const builder = new RuntimeGraphBuilder().withMode("static").withNodes(...nodes);
    for (const edge of definition.edges) builder.withChannel(byId.get(edge.from), byId.get(edge.to), edge.output, edge.input);
    return builder.build();
}
