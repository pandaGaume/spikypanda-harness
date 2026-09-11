import assert from "node:assert/strict";
import test from "node:test";
import { Session, RuntimeGraph } from "@spiky-panda/core";
import { TopologyMemory, TopologyActivationSession, DEFAULT_TOPOLOGY_CONFIG, initialTransitionStats } from "../packages/harness/dist/index.js";
import { createTopologyFixture, topologyFrame } from "../examples/topology/fixture.mjs";

function setup(edit = () => {}, config = {}) {
    const definition = createTopologyFixture(); edit(definition);
    const memory = new TopologyMemory(definition, { ...DEFAULT_TOPOLOGY_CONFIG, ...config });
    const activation = new TopologyActivationSession(memory);
    const run = (features = { x: 1, y: 1, z: 0 }, tick = 1, overrides) => activation.activate(topologyFrame(memory, features, tick, overrides));
    return { definition, memory, activation, run };
}
const branch = (d, id) => d.nodes.find(n => n.id === id);
const signal = (p, id) => p.trace.find(n => n.nodeId === id).signal;

test("T1 executes actual Core nodes and relations, with exact shared evidence provenance", () => {
    const f = setup(), before = JSON.stringify(f.memory.definition), p = f.run();
    assert.ok(f.memory.graph instanceof RuntimeGraph); assert.ok(f.activation.session instanceof Session);
    assert.equal(f.memory.memoryGraph.nodes.length, 7); assert.equal(f.memory.memoryGraph.links.length, 6);
    assert.deepEqual(p.work, { sourceFirings: 1, nodeFirings: 8, relationDeliveries: 9,
        positiveOutputs: 4, completionOnlyOutputs: 3, spikeEvents: 0 });
    assert.deepEqual(p.proposals.map(p => p.branchId), ["a"]);
    assert.equal(f.activation.arbitrate(p).selected.branchId, "a");
    assert.deepEqual(p.proposals[0].signal.edgeIds, ["x-xy", "xy-a", "y-xy"]);
    assert.deepEqual(p.proposals[0].signal.evidence.map(e => e.path), [["x"], ["y"]]);
    assert.ok(p.trace.every(n => n.implementation.startsWith("Topology")));
    assert.equal(f.activation.inspect().nodes.find(n => n.id === "xy").visits, 1);
    assert.equal(JSON.stringify(f.memory.definition), before);
});

test("TOP-01/02 a cut required relation suppresses a proposal; reconnecting a new revision restores it", () => {
    const f = setup(d => { d.revision = "cut"; d.edges = d.edges.filter(e => e.id !== "y-xy"); });
    const p = f.run();
    assert.deepEqual(p.proposals, []); assert.equal(p.work.relationDeliveries, 8);
    assert.equal(signal(p, "xy").known, false);
    assert.ok(signal(p, "xy").missing.includes("unwired:xy:y"));
    const restored = setup(d => { d.revision = "restored"; });
    assert.equal(restored.run().proposals[0].branchId, "a");
    assert.throws(() => restored.activation.assertPass(p), /Foreign/);
});


test("TOP-02 adding a path to a different invocation introduces a real competitor", () => {
    const original = setup(), before = original.run();
    assert.equal(original.activation.arbitrate(before).reason, "selected");
    const expanded = setup(d => {
        d.revision = "expanded";
        const c = structuredClone(branch(d, "a")); c.id = "c"; c.decision.invocation.input.route = "hold";
        d.nodes.push(c); d.edges.push({ id: "y-c", from: "y", to: "c", input: "support" });
    }), after = expanded.run();
    assert.deepEqual(after.proposals.map(p => p.branchId), ["a", "c"]);
    assert.deepEqual(after.proposals.find(p => p.branchId === "c").signal.edgeIds, ["y-c"]);
    assert.equal(expanded.activation.arbitrate(after).reason, "ambiguous");
});

test("TOP-03 one shared condition supports two proposals without duplicate evidence", () => {
    const f = setup(), p = f.run({ x: 1, y: 1, z: 1 });
    assert.deepEqual(p.proposals.map(p => p.branchId), ["a", "b"]);
    assert.equal(p.trace.filter(n => n.nodeId === "y").length, 1);
    assert.equal(f.activation.arbitrate(p).reason, "ambiguous");
    for (const proposal of p.proposals) assert.equal(proposal.signal.evidence.filter(e => e.path[0] === "y").length, 1);
});

test("TOP-04 AND uses min, OR uses max; missing is not a contradictory observation", () => {
    const and = setup(), p = and.run({ x: 0.8, y: 0.9, z: 0 });
    assert.equal(signal(p, "xy").support, 0.8);
    const missing = and.run({ x: 1, z: 0 }, 2);
    assert.equal(signal(missing, "xy").known, false); assert.deepEqual(missing.proposals, []);
    const or = setup(d => { branch(d, "xy").kind = "or"; }), q = or.run({ x: 0.8, z: 0 });
    assert.equal(signal(q, "xy").known, true); assert.equal(signal(q, "xy").support, 0.8);
    assert.equal(or.activation.arbitrate(q).reason, "selected");
    assert.ok(signal(q, "xy").missing.length > 0);
});

test("TOP-04 an explicit blocking mismatch vetoes the downstream OR, but a missing input does not", () => {
    const f = setup(d => { branch(d, "xy").kind = "or"; branch(d, "y").vetoOnMismatch = true; });
    const p = f.run({ x: 1, y: 0, z: 0 });
    assert.equal(signal(p, "xy").support, 0); assert.deepEqual(signal(p, "xy").blockers, ["y"]);
    assert.deepEqual(p.proposals, []);
    assert.equal(f.run({ x: 1, z: 0 }, 2).proposals[0].branchId, "a");
});

test("TOP-05 novel stronger branches compete before the reliability filter", () => {
    const f = setup(d => { branch(d, "a").stats = initialTransitionStats(); branch(d, "a").experienceIds = []; });
    const p = f.run({ x: 1, y: 1, z: 0.7 });
    assert.equal(p.proposals.length, 2); assert.equal(f.activation.arbitrate(p).reason, "unreliable");
    assert.equal(f.activation.arbitrate(f.run({ x: 0.7, y: 1, z: 1 }, 2)).selected.branchId, "b");
});

test("TOP-06 grouping uses exact invocation including parameters, and max support instead of sum", () => {
    const f = setup(d => { branch(d, "b").decision = structuredClone(branch(d, "a").decision); });
    const p = f.run({ x: 0.8, y: 1, z: 0.9 }), a = f.activation.arbitrate(p);
    assert.equal(a.groups.length, 1); assert.equal(a.groups[0].support, 0.9);
    assert.deepEqual(a.groups[0].branchIds, ["a", "b"]); assert.equal(a.selected.branchId, "b");
    const g = setup(), q = g.run({ x: 1, y: 1, z: 1 });
    assert.equal(g.activation.arbitrate(q).groups.length, 2);
});

test("a mature weak branch cannot borrow a novel branch's support for the same invocation", () => {
    const f = setup(d => {
        const novel = structuredClone(branch(d, "a")); novel.id = "novel";
        novel.stats = initialTransitionStats(); novel.experienceIds = [];
        d.nodes.push(novel); d.edges.push({ id: "y-novel", from: "y", to: "novel", input: "support" });
    });
    const p = f.run({ x: 0.65, y: 1, z: 0.7 });
    assert.equal(f.activation.arbitrate(p).reason, "unreliable");
});

test("converging copies of one measurement cannot manufacture extra evidence", () => {
    const f = setup(d => {
        const xy = branch(d, "xy"); xy.inputs = ["x", "y", "y-copy"];
        d.edges.push({ id: "y-xy-copy", from: "y", to: "xy", input: "y-copy" });
    });
    const p = f.run({ x: 1, y: 0.8, z: 0 });
    assert.equal(p.proposals[0].support, 0.8); assert.equal(p.proposals[0].signal.evidence.length, 2);
});

test("TOP-07 exact duplicate frames are cached, never extra traversals or evidence", () => {
    const f = setup(), p = f.run();
    assert.equal(f.run(), p); assert.equal(f.activation.inspect().passes, 1);
    assert.throws(() => f.run({ x: 0, y: 1, z: 0 }), /Repeated/);
    assert.throws(() => f.run({}, 2, { observationId: "observation:1" }), /Repeated/);
    assert.throws(() => f.run({}, 2, { decisionId: "decision:1" }), /Repeated/);
    assert.equal(f.activation.inspect().attempts, 1);
});

test("TOP-08 session state survives successive inferences and is isolated for a shared memory", () => {
    const f = setup(), other = new TopologyActivationSession(f.memory);
    f.run(); f.run({ x: 0, y: 1, z: 1 }, 2);
    assert.equal(f.activation.inspect().passes, 2); assert.equal(other.inspect().passes, 0);
    assert.equal(f.activation.inspect().nodes.find(n => n.id === "y").visits, 2);
    other.activate(topologyFrame(f.memory, { x: 1, y: 1, z: 0 }));
    f.activation.reset();
    assert.equal(f.activation.inspect().passes, 0); assert.equal(other.inspect().passes, 1);
    assert.equal(f.run().proposals[0].branchId, "a");
});

test("TOP-12 node, edge and declared-slot permutations preserve support and arbitration", () => {
    const reference = setup(), p = reference.run({ x: 0.9, y: 0.85, z: 0.6 });
    for (let offset = 0; offset < 7; offset++) {
        const f = setup(d => {
            d.nodes = [...d.nodes.slice(offset), ...d.nodes.slice(0, offset)].reverse(); d.edges.reverse();
            for (const n of d.nodes) if (n.kind === "and") n.inputs.reverse();
        }), q = f.run({ x: 0.9, y: 0.85, z: 0.6 });
        assert.deepEqual(q.proposals, p.proposals); assert.deepEqual(f.activation.arbitrate(q), reference.activation.arbitrate(p));
    }
});

test("TOP-14 reject stale, future, foreign revision or schema observations before execution", () => {
    const f = setup();
    for (const patch of [
        { observedAtSeconds: 1, availableAtSeconds: 1, timeSeconds: 10 },
        { observedAtSeconds: 2, availableAtSeconds: 1 }, { availableAtSeconds: 2 },
        { memoryRevision: "foreign" }, { schemaVersion: "foreign" }, { timeSeconds: NaN },
    ]) assert.throws(() => f.run({}, 1, patch));
    assert.equal(f.activation.inspect().attempts, 0);
    f.run();
    assert.throws(() => f.run({}, 2, { timeSeconds: 1, observedAtSeconds: 1, availableAtSeconds: 1 }), /clock/);
});

test("TOP-11 reject regime labels and cue-service results, with no hidden lookup", () => {
    const f = setup(), frame = topologyFrame(f.memory, { x: 1, y: 1 });
    for (const extra of [{ operatingContextId: "known-a" }, { cues: { basis: "cues" } }])
        assert.throws(() => f.activation.activate({ ...frame, context: { ...frame.context, ...extra } }), /regime/);
    assert.equal(f.activation.inspect().passes, 0);
    assert.equal(f.run().proposals[0].branchId, "a");
});

test("TOP-16 bounds and incomplete passes fail closed, then a new valid frame recovers", () => {
    const f = setup(), frame = topologyFrame(f.memory, { x: 1, y: 1 });
    assert.throws(() => f.activation.activate(frame, { maximumNodeFirings: 3 }), /budget/i);
    assert.equal(f.activation.inspect().lastPass, null); assert.equal(f.activation.inspect().passes, 0);
    assert.throws(() => f.activation.activate(frame), /Repeated/);
    assert.equal(f.run({ x: 1, y: 1, z: 0 }, 2).proposals.length, 1);
    assert.equal(f.activation.session.queue.length, 0);
    assert.ok(f.activation.session.nodeStates.every(s => [...s.inputBuffers.values()].every(buffer => buffer.length === 0)));
    const limited = setup(() => {}, { maximumPasses: 1 }); limited.run();
    assert.throws(() => limited.run({}, 2), /capacity/);
    limited.activation.reset(); limited.run();
});

test("aborted frames do not execute, and results cannot be forged, claimed twice, or reused after close", () => {
    const f = setup(), frame = topologyFrame(f.memory, { x: 1, y: 1 }), abort = new AbortController();
    abort.abort(new Error("cancelled"));
    assert.throws(() => f.activation.activate(frame, { signal: abort.signal }), /cancelled/);
    assert.equal(f.activation.inspect().attempts, 0);
    f.activation.beginDecision(frame.decisionId);
    assert.throws(() => f.activation.reset(), /active/);
    const p = f.activation.activate(frame);
    assert.throws(() => f.activation.assertPass({ ...p, proposals: [] }), /Foreign/);
    assert.equal(f.activation.claim(structuredClone(p), frame.context, frame.decisionId).reason, "selected");
    assert.throws(() => f.activation.claim(p, frame.context, frame.decisionId), /claimed/);
    f.activation.endDecision(frame.decisionId);
    assert.throws(() => f.activation.arbitrate(p), /closed/);
});

test("direct edits of a compiled projection cannot silently change an in-flight memory revision", () => {
    const f = setup(), p = f.run();
    f.memory.graph.links[0].enabled = false;
    assert.throws(() => f.activation.arbitrate(p), /projection changed/);
    assert.throws(() => f.run({}, 2), /projection changed/);
    const g = setup(); assert.throws(() => { g.memory.definition.nodes[0].center = 0; }, TypeError);
    g.definition.nodes[0].center = 0;
    assert.equal(g.run().proposals[0].branchId, "a");
});

test("TOP-18 identical observable inputs cannot distinguish an unobserved regime", () => {
    const a = setup(), b = setup();
    const p = a.run({ x: 1, y: 1, z: 1 }), q = b.run({ x: 1, y: 1, z: 1 });
    assert.deepEqual(p, q);
    assert.equal(a.activation.arbitrate(p).reason, "ambiguous");
    assert.equal(b.activation.arbitrate(q).reason, "ambiguous");
});

test("invalid models fail at compile time: cycles, duplicate producers, unknown fields and unsafe values", () => {
    for (const edit of [
        d => { d.nodes.push(structuredClone(d.nodes[0])); },
        d => { d.nodes[0].kind = "lif"; },
        d => { d.nodes[0].center = NaN; },
        d => { d.nodes[0].tolerance = 0; },
        d => { d.nodes[0].path = ["__proto__"]; },
        d => { d.nodes[0].modeId = "a"; },
        d => { d.nodes[0].evaluate = () => 1; },
        d => { d.edges.push({ ...d.edges[0], id: "duplicate-slot" }); },
        d => { d.edges[0].from = "missing"; },
        d => { d.edges[0].from = "a"; },
        d => { d.edges[0].to = "y"; },
        d => { d.edges[0].from = "xy"; },
        d => { branch(d, "a").stats.totalSuccessCount = 999; },
        d => { branch(d, "a").experienceIds = []; },
        d => { branch(d, "a").decision.source = "policy"; },
    ]) assert.throws(() => setup(edit));
    assert.throws(() => setup(() => {}, { maximumNodes: 3 }));
    assert.throws(() => setup(() => {}, { maximumEdges: 2 }));
    assert.throws(() => setup(() => {}, { minimumMargin: 0 }));
});
