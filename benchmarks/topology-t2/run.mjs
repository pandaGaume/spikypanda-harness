import { runCampaign } from "./measure.mjs";
import { variants } from "./cases.mjs";
import { TopologyMemory, TemporalTopologyMemory, DEFAULT_TOPOLOGY_TEMPORAL_CONFIG,
    createTopologyHarness, createTemporalTopologyHarness } from "../../packages/harness/dist/index.js";
import { createTopologyFixture } from "../../examples/topology/fixture.mjs";
import { createRoutingSample } from "../../examples/topology/world.mjs";

const report = runCampaign();
if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report));
} else {
    console.log("T2 : même mémoire manuelle, intégration locale des branches. Aucun apprentissage, aucune action dans ce banc d'activation.");
    console.log("Cadence 1 seconde. Bons/mauvais choix : sélections du contrôleur, pas résultats d'actions physiques.");
    console.table(report.runs.filter(r => r.cadence === "1").map(r => ({
        cas: r.scenario, variante: r.variant, observations: r.observations, corrects: r.correct, incorrects: r.wrong,
        replis: r.fallbacks, spikes: r.spikes, noeuds: r.nodeFirings, délaiInitial: r.latencies[0].latencySeconds ?? "non reconnu",
    })));
    console.log("Les autres cadences (0,25 s, 0,5 s, irrégulière) figurent dans la sortie --json.");
    console.log("Vérification séparée du harnais complet : 11 décisions, entrée A stable, mêmes garde-fous.");
    const actual = [];
    for (const mode of variants) {
        const memory = mode === "t1" ? new TopologyMemory(createTopologyFixture()) :
            new TemporalTopologyMemory(createTopologyFixture(), { ...DEFAULT_TOPOLOGY_TEMPORAL_CONFIG,
                mode, resetAlpha: mode === "spikes-modulated" ? 0.8 : 0 });
        const sample = createRoutingSample({ memory, createHarness: mode === "t1" ? createTopologyHarness : createTemporalTopologyHarness });
        let replay = 0, spikes = 0;
        for (let i = 0; i <= 10; i++) {
            const trace = await sample.step();
            replay += Number(trace.source === "policy");
            spikes += sample.activation.inspect().lastPass.work.spikeEvents;
            sample.set({ x: 1, y: 1, z: 0 });
        }
        actual.push({ variante: mode, décisions: 11, actions: sample.counts.executions, rejeux: replay,
            replis: sample.counts.fallbacks, spikes, expériences: sample.activation.journal().length });
    }
    console.table(actual);
    console.log("Un spike ne relance pas le harnais. Les replis demandent hold dans ce sample, sans LLM.");
    console.log("Aucun classement produit ni comparaison LangGraph : cette campagne isole seulement la dynamique des branches.");
}
