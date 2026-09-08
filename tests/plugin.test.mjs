import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../packages/plugin-harness/dist/index.js";

test("visual plugin registers the expected harness nodes", () => {
    const registered = [];
    const context = {
        id: "test",
        nodes: {
            register(type, factory, meta) {
                registered.push({ type, factory, meta });
            },
        },
    };
    for (const [id, subPlugin] of Object.entries(plugin.subPlugins)) {
        subPlugin.activate({ ...context, id });
    }
    assert.deepEqual(
        registered.map((item) => item.type),
        [
            "Harness.Policy:lookup",
            "Harness.Policy:confidence-gate",
            "Harness.Reasoning:provider",
            "Harness.Safety:guard",
            "Harness.Execution:capability",
            "Harness.Learning:record",
        ]
    );
    assert.ok(registered.every((item) => item.meta.category.startsWith("Harness.")));
});

