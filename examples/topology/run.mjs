import { TopologyMemory, TopologyActivationSession } from "../../packages/harness/dist/index.js";
import { createTopologyFixture, topologyFrame, routingDecision } from "./fixture.mjs";
import { createRoutingSample } from "./world.mjs";

console.log("T1 : activation topologique réelle dans Core. Fixture manuelle, sans spikes ni apprentissage.");
const memory = new TopologyMemory(createTopologyFixture()), activation = new TopologyActivationSession(memory);
const inputs = [
    ["X et Y", { x: 1, y: 1, z: 0 }],
    ["Y et Z", { x: 0, y: 1, z: 1 }],
    ["Conflit", { x: 1, y: 1, z: 1 }],
    ["Y absent", { x: 1, z: 0 }],
    ["Soutien faible", { x: 0.4, y: 1, z: 0 }],
];
const summarize = (scenario, session, pass) => {
    const arbitration = session.arbitrate(pass);
    return { scénario: scenario, propositions: pass.proposals.map(p => p.branchId + ":" + p.support.toFixed(2)).join(", ") || "aucune",
        arbitrage: arbitration.reason, branche: arbitration.selected?.branchId ?? "repli",
        noeuds: pass.work.nodeFirings, livraisons: pass.work.relationDeliveries, spikes: pass.work.spikeEvents };
};
const rows = inputs.map(([name, features], i) => summarize(name, activation, activation.activate(topologyFrame(memory, features, i + 1))));
const cut = createTopologyFixture(); cut.revision = "routing-fixture:cut";
cut.edges = cut.edges.filter(e => e.id !== "y-xy");
const cutMemory = new TopologyMemory(cut), cutSession = new TopologyActivationSession(cutMemory);
rows.push(summarize("Liaison Y vers XY coupée", cutSession, cutSession.activate(topologyFrame(cutMemory, inputs[0][1]))));
const same = createTopologyFixture(); same.revision = "routing-fixture:same-invocation";
same.nodes.find(n => n.id === "b").decision = routingDecision("a");
const sameMemory = new TopologyMemory(same), sameSession = new TopologyActivationSession(sameMemory);
rows.push(summarize("Deux chemins, même invocation", sameSession, sameSession.activate(topologyFrame(sameMemory, inputs[2][1]))));
console.table(rows);
console.log("Parcours d'une proposition :");
const detail = new TopologyActivationSession(memory).activate(topologyFrame(memory, inputs[0][1])).proposals[0];
console.log(JSON.stringify({ branche: detail.branchId, observations: detail.signal.evidence,
    noeuds: detail.signal.nodeIds, relations: detail.signal.edgeIds }, null, 2));

const sample = createRoutingSample(), decisions = [];
for (const [name, features] of inputs.slice(0, 4)) {
    sample.set(features);
    const trace = await sample.step();
    decisions.push({ scénario: name, source: trace.source, action: trace.decision.invocation.input.route,
        actionsCumulées: sample.counts.executions, expériences: sample.activation.journal().length });
}
console.log("Même fixture raccordée au harnais complet, avec garde et évaluation :");
console.table(decisions);
const denied = createRoutingSample({ hooks: { guard: async () => ({ allowed: false, reason: "refus explicite du sample" }) } });
try { await denied.step(); throw new Error("Le garde-fou aurait dû refuser"); }
catch (error) {
    if (!error.message.includes("refus explicite du sample")) throw error;
    console.log("Refus du garde-fou : " + denied.counts.executions + " action, " + denied.activation.journal().length + " expérience.");
}
const experiences = sample.activation.journal().length;
sample.activation.reset();
console.log("Reset d'activation : " + sample.activation.inspect().passes + " passage, " + experiences + " expériences conservées.");
console.log("Ces nombres vérifient l'exécution, pas la performance produit. La démo navigateur reste en V3.");
