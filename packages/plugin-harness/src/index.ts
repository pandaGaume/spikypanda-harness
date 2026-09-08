import { HARNESS_NODES, createHarnessNode } from "./nodes.js";
import type { HarnessPlugin } from "./plugin-types.js";
export * from "./nodes.js";
export * from "./graph.js";
export * from "./plugin-types.js";

const subPlugins: Record<string, HarnessPlugin> = {};
for (const category of new Set(HARNESS_NODES.map(entry => entry.type.split(":")[0]))) {
    subPlugins[category] = { activate(ctx) {
        for (const entry of HARNESS_NODES.filter(entry => entry.type.startsWith(`${category}:`))) {
            const sample = createHarnessNode(entry.type);
            ctx.nodes.register(entry.type, () => createHarnessNode(entry.type), {
                label: entry.label, category, inputPorts: sample.inputPorts, outputPorts: sample.outputPorts,
            });
        }
    } };
}
const plugin: HarnessPlugin = { activate() {}, subPlugins };
export default plugin;
