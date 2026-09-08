import assert from "node:assert/strict";
import test from "node:test";
import { PolicyGraph } from "../packages/harness/dist/index.js";
import { CounterWorld, createCounterRuntime } from "../examples/counter/world.mjs";
import { projectMemory } from "../examples/editor/memory-model.mjs";

const intention = { id: "reach-target", parameters: { target: 3 } };
function fixture() {
    const policy = new PolicyGraph(), world = new CounterWorld();
    return { policy, world, ...createCounterRuntime(policy, world) };
}
async function advance(f, count, goal = intention) {
    const traces = [];
    for (let i = 0; i < count; i++) {
        if (f.world.value === f.world.target) f.world.reset();
        traces.push(await f.runtime.step(goal));
    }
    return traces;
}

test("memory view starts empty and grows only from evaluated experiences", async () => {
    const f = fixture();
    assert.deepEqual(projectMemory(f.policy).nodes, []);
    assert.equal(projectMemory(f.policy).experienceCount, 0);
    await advance(f, 1);
    const before = f.policy.snapshot(), model = projectMemory(f.policy);
    assert.equal(model.nodes.length, 3);
    assert.deepEqual(model.nodes.map(n => n.kind), ["context", "action", "capability"]);
    assert.equal(model.transitions.length, 1);
    assert.equal(model.bindings.length, 1);
    assert.equal(model.experiences.length, 1);
    assert.equal(model.experiences[0].transitionId, model.transitions[0].id);
    assert.equal(model.experiences[0].before, 0);
    assert.equal(model.experiences[0].after, 1);
    assert.equal(model.transitions[0].eligible, false);
    assert.deepEqual(f.policy.snapshot(), before, "rendering never changes the policy");
});

test("repeated values share one context while experiences and revisable confidence grow", async () => {
    const f = fixture();
    await advance(f, 1);
    const first = projectMemory(f.policy);
    await advance(f, 2);
    const consolidated = projectMemory(f.policy);
    assert.deepEqual(consolidated.nodes, first.nodes);
    assert.equal(consolidated.contextCount, 1);
    assert.equal(consolidated.experienceCount, 3);
    assert.ok(consolidated.transitions[0].stats.confidence > first.transitions[0].stats.confidence);
    assert.equal(consolidated.transitions[0].eligible, true);
    assert.equal((await advance(f, 1))[0].source, "policy");
    assert.equal(projectMemory(f.policy).experienceCount, 4);
});

test("inversion weakens the old link without deleting it and creates the opposite action", async () => {
    const f = fixture();
    await advance(f, 24);
    const trained = projectMemory(f.policy);
    f.world.reset(); f.world.invert();
    assert.deepEqual(projectMemory(f.policy), trained, "inversion itself must not rewrite memory");
    await advance(f, 2);
    const weakened = projectMemory(f.policy);
    assert.equal(weakened.transitions[0].stats.directEligible, true, "hysteresis flag is not actual replay eligibility");
    assert.equal(weakened.transitions[0].eligible, false);
    assert.ok(weakened.transitions[0].stats.confidence < trained.transitions[0].stats.confidence);
    assert.equal(weakened.experiences.at(-1).success, false);
    const [trace] = await advance(f, 1);
    assert.equal(trace.source, "fallback");
    const adapted = projectMemory(f.policy);
    assert.equal(adapted.nodes.length, 4);
    assert.equal(adapted.contextCount, 1);
    assert.equal(adapted.actionCount, 2);
    assert.equal(adapted.transitions.length, 2);
    assert.deepEqual(adapted.transitions[0], weakened.transitions[0]);
    assert.equal(adapted.experiences.at(-1).transitionId, adapted.transitions[1].id);
    assert.equal(adapted.experiences.at(-1).action, "Commande -1");
});

test("the visible history is bounded without deleting stored experience nodes; restore is faithful", async () => {
    const f = fixture();
    await advance(f, 24);
    const saved = f.policy.snapshot();
    const model = projectMemory(f.policy);
    assert.equal(model.experienceCount, 24);
    assert.equal(model.experiences.length, 12);
    assert.equal(model.experiences[0].number, 13);
    assert.equal(model.experiences.at(-1).number, 24);
    assert.deepEqual(projectMemory(PolicyGraph.fromSnapshot(saved)), model);
    assert.deepEqual(f.policy.snapshot(), saved);
    assert.equal(projectMemory(f.policy, 1).experiences[0].number, 24);
    assert.throws(() => projectMemory(f.policy, 0), /limit/);
});

test("different intentions keep distinct links without duplicating shared actions or capabilities", async () => {
    const f = fixture();
    await advance(f, 1);
    f.world.target = 4;
    await advance(f, 1, { id: "reach-target", parameters: { target: 4 } });
    const model = projectMemory(f.policy);
    assert.equal(model.contextCount, 2);
    assert.equal(model.actionCount, 1);
    assert.equal(model.bindings.length, 1);
    assert.equal(model.transitions.length, 2);
    assert.notEqual(model.transitions[0].from, model.transitions[1].from);
    assert.equal(model.transitions[0].to, model.transitions[1].to);
    assert.equal(model.experiences[0].context.detail, "Atteindre 3");
    assert.equal(model.experiences[1].context.detail, "Atteindre 4");
});

test("rejected execution produces no fictional memory growth", async () => {
    const f = fixture();
    f.world.value = 20;
    await assert.rejects(f.runtime.step(intention), /safety|boundary/i);
    assert.equal(projectMemory(f.policy).nodes.length, 0);
    assert.equal(projectMemory(f.policy).experienceCount, 0);
});

