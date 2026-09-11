import assert from "node:assert/strict";
import test from "node:test";
import { suite, generateCase } from "../../production-v1/scenario.mjs";
import { runCase } from "../../production-v1/runner.mjs";
import { createReferenceController } from "../../production-v1/controllers/reference.mjs";
import { createLangGraphController } from "./controller.mjs";

for (const scenario of suite.scenarios) test("LangGraph preserves reference behavior: " + scenario.id, async () => {
    const sample = generateCase(scenario.id, 101), options = { clock: () => 0 };
    const direct = await runCase(sample, createReferenceController, options);
    const graph = await runCase(sample, createLangGraphController, options);
    assert.equal(graph.status, "completed");
    assert.deepEqual(graph.rows, direct.rows);
    assert.deepEqual(graph.metrics, direct.metrics);
});
