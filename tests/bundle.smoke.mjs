import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as core from "@spiky-panda/core";
import * as harness from "../packages/harness/dist/index.js";

test("browser plugin publishes its API and reuses the host core", async () => {
    const code = await readFile(new URL("../packages/plugin-harness/bundle/SpkPluginHarness.js", import.meta.url), "utf8");
    const sandbox = { SpikypandaCore: core, SpikypandaHarness: harness };
    runInNewContext(code, sandbox);
    const plugin = sandbox.SpkPluginHarness;
    assert.equal(plugin.HARNESS_NODES.length, 16);
    for (const entry of plugin.HARNESS_NODES) assert.ok(new entry.ctor() instanceof core.RuntimeNode);
    for (const entry of plugin.HARNESS_NODES) assert.ok(new entry.ctor() instanceof harness.HarnessNode);
    assert.equal(plugin.PolicyLookupNode, harness.PolicyLookupNode);
    assert.equal(plugin.createGraphDriver, harness.createGraphDriver);
    const registry = new core.NodeRegistry();
    for (const [id, sub] of Object.entries(plugin.default.subPlugins)) sub.activate({ id, nodes: registry });
    for (const entry of plugin.HARNESS_NODES) assert.ok(registry.create(entry.type) instanceof core.RuntimeNode);
});
