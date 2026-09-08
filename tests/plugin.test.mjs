import assert from "node:assert/strict";
import test from "node:test";
import plugin, { HARNESS_NODES } from "../packages/plugin-harness/dist/index.js";

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
        registered.map((item) => item.type).sort(),
        HARNESS_NODES.map(item => item.type).sort()
    );
    assert.ok(registered.every((item) => item.meta.category.startsWith("Harness.")));
});

