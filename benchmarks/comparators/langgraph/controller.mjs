import { readFileSync } from "node:fs";
import { referenceDecision } from "../../production-v1/controllers/reference.mjs";

// Local benchmark only. Never activate commercial tracing inherited from the shell.
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.LANGSMITH_TRACING = "false";
const { StateGraph, StateSchema, START, END } = await import("@langchain/langgraph");
const { z } = await import("zod");
export const langGraphVersion = JSON.parse(readFileSync(new URL("./node_modules/@langchain/langgraph/package.json", import.meta.url), "utf8")).version;

/** First admission check: the same controller logic executed by the real LangGraph runtime.
 * No claim that this one-node workflow represents LangGraph's best product architecture.
 */
export function createLangGraphController() {
    const State = new StateSchema({ observation: z.unknown(), decision: z.unknown().optional() });
    const graph = new StateGraph(State)
        .addNode("decide", state => ({ decision: referenceDecision(state.observation) }))
        .addEdge(START, "decide").addEdge("decide", END).compile();
    return { id: "langgraph-" + langGraphVersion + "-reference-kernel",
        async decide(observation) { return (await graph.invoke({ observation }, { recursionLimit: 8 })).decision; } };
}
