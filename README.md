# SpikyPanda Harness

## État actuel : V3, observateur 0.1

La [mémoire contextuelle V2](docs/V2_MEMOIRE_CONTEXTUELLE.md) distingue la
fiabilité d'une branche de son applicabilité au fonctionnement reconnu.
Counter apprend M1 et M2 à partir des effets observés et réutilise une branche
mature au retour d'un fonctionnement connu. Les poids restent révisables.

L'[observateur 0.1](docs/OBSERVATEUR_V0_1.md) ajoute une reconnaissance avant
action à partir d'indices numériques dont le pouvoir discriminant est appris.
Il reste une métrique statistique simple, pas un CNN/GNN ni l'observateur final.
Le mode observation seule conserve la V2 ; le mode actif utilise les indices
reconnus et renvoie les cas incertains au raisonneur.

Le [bilan V1](docs/ETAT_DES_LIEUX_V1.md) et la
[refactorisation par héritage](docs/REFACTORISATION_NOEUDS.md) restent les
références historiques. Les paquets restent en version `0.1.0`.
Counter appartient aux exemples ; la bibliothèque reçoit un graphe explicite
construit avec les builders de core, sans scénario implicite.

## Prototype T1 : activer la mémoire

Le [contrat d'activation topologique](docs/ACTIVATION_TOPOLOGIQUE_CONTRAT.md)
définit la direction : reconnaissance par propagation dans la mémoire, sans
classification de régime préalable. Le [prototype T1](docs/ACTIVATION_TOPOLOGIQUE_T1.md)
exécute maintenant une mémoire-fixture avec les nœuds et builders de Core :
conditions locales, ET/OU, arbitrage, garde-fous et journal en session.
Couper une liaison pertinente supprime réellement sa proposition.

Lancer `npm run experiment:topology` pour voir les traces et les décisions.
Ce lot ne comporte ni spikes ni apprentissage automatique des connexions ;
la dynamique temporelle est prévue en T2. Les variantes, résultats et démo
navigateur V3 restent les témoins de comparaison.

## Comparateur T2 : dynamique temporelle des branches

`npm run experiment:topology:temporal` compare T1, lecture continue, spikes avec
reset zéro et spikes avec reset modulé. Les potentiels vivent dans les sessions
Core des branches, sans apprentissage de topologie ni de confiance.

Les [128 comparaisons](docs/RESULTATS_TOPOLOGIE_T2.md) montrent un filtrage du
transitoire, mais plus de replis et un conflit parfois masqué pendant la montée
d'une branche concurrente. Aucune variante n'est promue par défaut.
Le [protocole et l'algorithme](docs/ACTIVATION_TOPOLOGIQUE_T2.md) distinguent
clairement les événements internes des actions réellement exécutées.

## Trajectoire et questions ouvertes

La [note de conception](docs/NOTE_PLASTICITE_ET_CONTEXTE.md) précise pourquoi
les conditions d'utilité des actions doivent être apprises, pas pré-étiquetées.
La [trajectoire V1, V2, V3 et suites](docs/TRAJECTOIRE_V1_V2_V3.md) distingue
les acquis des propositions : observateur d'indices et embeddings en V3,
diagnostic actif en V4, puis validation continue de la résilience.
Les pistes CNN temporel et réseau de neurones de graphe restent à comparer ;
aucun observateur neuronal n'est implémenté. Le premier palier V3 est livré ;
l'apprentissage temporel, relationnel et le diagnostic actif restent à construire.

L'objectif est l'autonomie produit : aucune dépendance commerciale obligatoire,
et un minimum de dépendances tierces, y compris MIT, limitées aux fonctions
périphériques remplaçables. Ajv reste acceptable. L'observateur n'ajoute aucune
dépendance. Voir la [politique et les limites](docs/OBSERVATEUR_V0_1.md#autonomie-et-dépendances).

## Banc de comparaison produit

Le [banc cellule de production](docs/BENCHMARK_PRODUCTION_V1.md) fournit un
monde continu indépendant du harnais, dix familles de scénarios et 330 cas
reproductibles. Production, qualité, retard, énergie, dépassements, récupération
et temps de calcul sont mesurés séparément, avec les échecs conservés.

Une référence à règles simples et un adaptateur LangGraph local servent à
valider l'instrument. LangGraph est optionnel, isolé des dépendances du produit.
Le [premier relevé](docs/RESULTATS_BANC_INITIAL.md) conserve l'admission initiale.
Les [résultats des graphes réels](docs/RESULTATS_GRAPHES_PRODUCTION.md) comparent
maintenant règles, V1, V2 et V3, sans conclure à une supériorité du produit.
La [note sur la généralisation](docs/GENERALISATION_ET_BANCS.md) distingue les cas
fixes des variations réservées et du transfert ; la généralisation n'est pas
encore mesurée. Les [vrais graphes V1/V2/V3](docs/RACCORDEMENT_GRAPHES_PRODUCTION.md)
pilotent maintenant le banc, avec le même raisonneur déterministe et les mêmes
protections. Le classement produit et le comparateur LangGraph avec mémoire
restent à réaliser. Adopter l'existant, ne garder que notre mémoire ou abandonner le
harnais sont des conclusions possibles, sans bonus pour le travail déjà investi.

```sh
npm run test:benchmark
npm run benchmark:production -- --controller reference --split development --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-active --scenario nominal --seed 101 --out dist/benchmarks
```

## Overview

SpikyPanda Harness is an experimental framework for building inspectable and
plastic decision harnesses on top of the SpikyPanda graph runtime.

The central rule is simple:

> Do not ask a reasoning provider twice for a decision that has already been
> learned, while continuously allowing reality to invalidate that decision.

The project separates three graphs:

1. The plant graph contains the physical model, deterministic control and hard
   safety rules.
2. The harness graph contains observation, policy lookup, fallback reasoning,
   capability execution and outcome evaluation.
3. The policy graph contains learned contexts, actions, bindings, transitions
   and experiences.

The harness runtime is headless, using `@spiky-panda/core` and Ajv validation. The
visual plugin depends on `@spikypanda/nodeeditor` and registers authoring
nodes for the existing SpikyPanda plugin loader.

## Workspace packages

- `@spiky-panda/harness`: headless policy graph, plasticity and runtime.
- `@spiky-panda/plugin-harness`: visual Harness nodes for Node Editor.
- `@spiky-panda/harness-provider-mock`: deterministic reasoning provider.

## Current dependency status

`@spiky-panda/core` and `@spikypanda/nodeeditor` are peer dependencies. During
local development they can be linked from a SpikyPanda checkout. The Node
Editor package is currently private in the upstream repository, so publishing
it or extracting a public plugin SDK is an upstream prerequisite for a clean
npm installation.

The current `@spiky-panda/core` ESM output also contains extensionless relative
imports. Node cannot resolve those imports natively. The test and experiment
commands use `scripts/spikypanda-esm-loader.mjs` as a local compatibility layer
until the upstream build emits Node-compatible `.js` specifiers.

## Commands

```sh
npm install
npm run link:spikypanda -- ../../spikypanda
npm run build
npm test
npm run experiment:counter
npm run experiment:counter:v3
npm run experiment:helios
npm run experiment:topology
npm run experiment:topology:temporal
npm run demo
npm run test:bundle
```

`link:spikypanda` is only a local development bridge while the upstream
packages are not both published. Pass the path to a SpikyPanda checkout, or set
`SPIKYPANDA_REPO`. The command never replaces an existing dependency link.


## What the experiments demonstrate

The V2 Counter experiment and V3 browser demo share the base world and reasoning
mock. The V3 sample adds simulated sensor measurements and an observer node.
Use `experiment:counter:v3` to compare shadow and active observation. They demonstrate cold-start fallback, consolidation,
direct policy decisions and conditional recall through A-B-A-B reversals of the environment
dynamics. The mock receives observations and past failures, not the world's
hidden direction. It is a deterministic reference, not a real LLM.

The existing HELIOS script is only an illustrative scaffold: its mock reads
the hidden scenario phase and its CO2 state is reset between episodes. It does
not establish physical resilience. A continuous, non-oracle case study remains
a later milestone.

Neither experiment treats historical success counters as decision weights.
Lifetime counters exist for audit, while eligibility uses bounded exponentially
weighted evidence with promotion and demotion hysteresis.

## Safety boundary

The reasoning provider receives plain, frozen data and proposes a structured
capability call. The runtime validates the proposal and arguments, applies the
host guard, requests fresh approval when required, then verifies observation
freshness before execution. Graph wiring cannot skip these stages. Hard safety
rules remain outside learning. Providers and capability adapters are trusted
in-process code; this is not an isolation sandbox.

The default guard is permissive for experiments. Production hosts must provide
their own guard and capabilities. Cancellation is cooperative: a timed-out
external action may already have had an effect. The registry refuses overlapping
calls while an earlier adapter is unresolved. Never blindly retry an uncertain
action; use application-specific reconciliation and idempotency.

## Visual milestone

`npm run demo` starts the local editor on the fixed address
`http://127.0.0.1:4175` and opens the default browser once the server is ready.
If the same demo from this checkout is already running there, the launcher
verifies its identity and opens that instance without starting another server.
An occupied port belonging to another service or an older, unidentifiable demo
causes a clear error. No automatic port changes and no process termination occur.
Use `npm run demo -- --no-open` or `HARNESS_OPEN_BROWSER=0` to disable opening.
Set `HARNESS_PORT` only to explicitly choose a different fixed port. Browser
storage is specific to each port. The demo loads the
generated `SpkPluginHarness.js` through the existing Node Editor plugin loader,
using the same core and harness instances as its host. The host exposes
`globalThis.SpikypandaHarness` before loading the plugin. No remote service is called.

1. Click **Repartir sans mémoire** if a saved policy was loaded, then **Un pas**.
   The first experience is pending. Two consistent command/effect observations
   establish a mode; subsequent evidence consolidates its conditional skill.
2. Keep **Ralentir pour voir l'apprentissage** enabled and run **Entraîner (8 épisodes)**.
   Repeated actions add experience nodes while revising the existing links.
3. Click **Inverser la dynamique**, then run more episodes. Observe failures,
   attribution to a newly confirmed mode and learning of its appropriate action.
   Invert again: learned sensor cues can recognize the known mode before acting.
   Reliability, applicability and discriminant feature weights are separate.
   The current observation at the target is a different scope; start a new episode
   to observe recall below the target.
4. Compare **Actif** with **Observation seule**. Switching resets the world and
   counters but keeps learning. Mask or add noise to the sensor and inspect uncertainty.
5. Save, reload, and run again. The memory remains plastic after restoration.
6. Edit the graph or rebuild it from the node palette. Invalid wiring, missing
   stages and disabled required nodes are rejected before any action.

The V3 demo palette contains 13 executable node classes (the shared catalogue
also retains the V1/V2 alternatives, 16 classes in total) and two alternative
decision branches. Trusted host factories can specialize nodes by inheritance
or add typed intermediate nodes without modifying the runtime. The compiler
validates one observation source, one experience sink, complete typed wiring
and acyclicity, without fixing the node count. It is not yet a general workflow
engine with arbitrary loops or parallel actions. Episodes are driven by the host.

The memory graph is distinct from the executable flow. V2 includes learned
operating modes, conditional contexts and auditable experience provenance.
A dormant branch keeps its reliability but cannot replay until its mode is
recognized. Four recent experiences are drawn and twelve are selectable;
all remain stored. Displayed reliability is current, not a historical replay.

**Repartir sans mémoire** creates a new in-memory policy with the same plasticity
settings. **Retrouver la mémoire précédente** restores the previous policy
(multiple resets can be undone). These controls reset the simulated world and
runtime metrics, never browser storage. Recovery is available only until page
reload or closure. No learning algorithm or launcher port is changed by this view.

The harness definition and policy snapshot are saved separately, both as local
browser records and downloadable JSON files. Importing or reloading creates new
host services; the demo world starts at zero with normal dynamics. Graph JSON
does not serialize functions or service credentials. Observation, invocation and
experience data are application data: redact sensitive fields before persistence.

V3 memory snapshots wrap a version 2 policy plus the observer schema/configuration.
V1/V2 imports preserve their history without invented sensor data. V1 remains
unattributed, with no inherited conditional scores. Counter upgrades old sample
graphs in memory by inserting the cue observer; saved documents are unchanged
until an explicit save. Harness documents stay version 1.
Wire payloads remain opaque, typed, session-bound packets.

See [docs/EXECUTION.md](docs/EXECUTION.md) for the execution contract and
[docs/VALIDATION.md](docs/VALIDATION.md) for tests and known limits.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged roadmap.

## Expérience V3 : consolidation temporelle

La variante `harness-v3-consolidated` compare la persistance des effets avant
création d’un régime durable, sans changer l’observateur ni introduire de spikes.
Voir [le mécanisme, les paramètres et les limites](docs/V3_CONSOLIDATION_TEMPORELLE.md).

```sh
npm run benchmark:production -- --controller harness-v3-consolidated --scenario nominal --seed 101 --out dist/benchmarks
```

## Expérience V3 : continu et spikes

Les deux variantes temporelles réutilisent le LIF et les graphes du Core.
Tout leur état temporel reste dans les sessions. La consolidation et la
plasticité des connaissances sont inchangées.

```sh
npm run experiment:temporal -- --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-spikes --seed 101 --out dist/benchmarks
```

Voir [le protocole et l’algorithme](docs/V3_PROPAGATION_TEMPORELLE.md) et
[les résultats comparatifs](docs/RESULTATS_PROPAGATION_V3.md).

La variante supplémentaire `harness-v3-spikes-modulated` conserve un potentiel
proportionnel à l’indice courant après chaque spike. Les témoins précédents
restent disponibles, avec un test de référence sur leurs 252 parcours.
Voir [le reset modulé et son protocole](docs/V3_RESET_MODULE.md).
