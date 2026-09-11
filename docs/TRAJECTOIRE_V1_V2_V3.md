# Trajectoire transversale : V1, V2, V3 et suites possibles

Date : 9 septembre 2026.
Statut : V1/V2 acquis ; premier palier V3 implémenté avec l'observateur 0.1.
Les développements temporels, relationnels et les étapes suivantes restent proposés.
V1 à V5 désignent ici des jalons expérimentaux, pas des versions npm ni des
dates de livraison. Les paquets restent actuellement en version `0.1.0`.

La [note de principe](NOTE_PLASTICITE_ET_CONTEXTE.md) explicite le point central :
les capacités sont déclarées par l'hôte, mais les conditions d'utilité des
actions ne doivent pas toutes être pré-étiquetées par le développeur.

## Orientation produit et état du premier observateur

Le but est un avantage produit et un harnais maîtrisé, pas une publication ni
une revendication de nouveauté scientifique. Les tests servent à décider si
le mécanisme rend le produit utile, fiable et maintenable.

Aucune dépendance commerciale obligatoire. Les dépendances tierces, y compris
MIT, doivent rester minimales et périphériques ; Ajv est acceptable. Le runtime,
la mémoire, la plasticité, la sélection et l'observateur restent du code du projet.

L'[observateur 0.1](OBSERVATEUR_V0_1.md) implémente désormais un premier parcours
complet : mesures numériques autorisées, poids discriminants appris sur
expériences récentes, comparaison de prototypes, provenance et abstention du
rejeu direct en cas d'incertitude. Il est remplaçable, mais il n'est pas neuronal.
Ce palier conserve l'identité de modes V2 : la séparation générale entre identité
latente et représentation, décrite plus bas, n'est donc pas encore livrée.

Les sections prospectives ci-dessous gardent leur valeur de trajectoire, pas
de description exhaustive du code actuel. Les références scientifiques sont des
repères facultatifs d'architecture ; elles ne dictent ni le produit ni ses licences.

## 1. La progression recherchée

| Jalon | Question traitée | Acquis ou cible | Statut et limite |
| --- | --- | --- | --- |
| V1 | Puis-je réutiliser une décision, puis la remettre en question ? | Flux contrôlé, expériences, scores plastiques et rejeu. | Implémenté ; un contexte trop grossier mélange plusieurs fonctionnements. |
| Refactorisation après V1 | Puis-je modifier le harnais sans réécrire son runtime ? | Nœuds hérités, surcharges, builders de core et graphes fournis par l'hôte. | Implémenté ; le sample reste hors bibliothèque. |
| V2 | Dans quel fonctionnement attribuer cette expérience ? | Modes appris par signatures d'effets, fiabilité conditionnelle, applicabilité distincte et provenance. | Implémenté expérimentalement ; la signature est conçue par l'hôte, la reconnaissance vient après l'effet. |
| V3 | Quels indices permettent de reconnaître les conditions d'une compétence ? | Observateur, représentations, recherche de précédents et hypothèses révisables avant action. | Premier palier implémenté : métrique adaptative 0.1, observation seule et reconnaissance active. La représentation temporelle/relationnelle reste proposée. |
| V4 | Que faire quand les indices ne suffisent pas ? | Observation active, essais discriminants bornés et comparaison entre agir, diagnostiquer et s'abstenir. | Proposition ; un modèle prédictif et une notion de coût restent à qualifier. |
| V5 | Ces mécanismes restent-ils utiles dans un système continu ? | Expériences de résilience, dérives longues, adaptation des représentations et maintenance de mémoire. | Direction de recherche ; aucune qualification industrielle acquise. |

Il ne s'agit pas de remplacer chaque version par un modèle plus gros.
Chaque étape conserve les invariants précédents et doit justifier son coût.
Les tests V1 et V2 restent des références, même si un observateur neuronal
est ajouté. Les adaptateurs LLM, l'installation des paquets et la maturité
du stockage sont des chantiers transversaux, pas des conséquences automatiques
du passage à V3.

## 2. Le point de départ vérifié

### V1 : apprendre et désapprendre dans un contexte déclaré

Le harnais observe, cherche une décision, sollicite un raisonneur si nécessaire,
contrôle l'action et enregistre son résultat. La confiance repose sur des
statistiques adaptatives bornées, pas sur un cumul définitif de réussites.

Sa limite sur Counter était l'attribution au même contexte « sous la cible »
des résultats de dynamiques opposées. Le retour à un fonctionnement connu
entraînait une nouvelle dégradation puis consolidation des liens.

Le [bilan V1](ETAT_DES_LIEUX_V1.md) conserve les résultats de ce jalon.
La [refactorisation](REFACTORISATION_NOEUDS.md) a ensuite déplacé les comportements
dans les surcharges des nœuds, sans changer l'apprentissage V1.

### V2 : séparer compétence et hypothèse courante

`ContextualPolicyGraph` conserve les modes, expériences et attributions.
`OperatingContextTracker` porte une hypothèse propre à chaque runtime.
Les nœuds spécialisés surchargent la recherche et l'enregistrement.
Les gardes d'exécution restent indépendantes de la connaissance apprise.

La V2 reconnaît des signatures d'effets exactes. Dans Counter, seul le sample
définit le rapport déplacement/commande. Les modes ne sont pas préchargés,
mais la manière de les distinguer est programmée. Les contextes restent
séparés par état, intention et paramètres ; le transfert entre objectifs
ou entre sous-systèmes n'est pas acquis.

Deux effets nouveaux cohérents confirment par défaut un mode ; un effet
reconnu peut réactiver un mode déjà appris. Une anomalie ressemblant à ce mode
peut donc tromper temporairement le tracker. Une hypothèse active n'est pas
persistée comme vérité au redémarrage.

Le dernier contrôle d'implémentation du 8 septembre a donné 63 tests réussis,
un test de bundle réussi et 25 épisodes Counter réussis : 81 actions,
75 décisions de mémoire et 6 appels au raisonneur simulé. Ce document rapporte
ce contrôle antérieur ; il ne constitue pas une nouvelle exécution de tests.

Les épisodes de changement comportent une action sans progrès. Le résultat
ne prouve ni anticipation d'une inversion cachée, ni robustesse générale au bruit.
Voir le [bilan V2](V2_MEMOIRE_CONTEXTUELLE.md) et la
[validation actuelle](VALIDATION.md).

## 3. L'observateur proposé : observer quoi ?

« Observer le réseau » peut désigner le système piloté, le graphe du harnais
ou le graphe de mémoire. Nous proposons de distinguer leurs apports :

| Source | Information utilisable | Ce qu'elle ne prouve pas |
| --- | --- | --- |
| Observations du monde | Mesures datées, événements accessibles, qualité et disponibilité des capteurs. | Une mesure isolée ne révèle pas toujours le fonctionnement caché. |
| Traces du harnais | Commandes passées, délais, erreurs, résultats effectivement observés. | Une commande prévue n'est pas une commande exécutée. |
| Graphe de mémoire | Expériences, relations entre composants, hypothèses, contradictions et attributions. | Une hypothèse ou un score interne n'est pas une nouvelle observation du monde. |
| Graphe de flux | Étapes, capacités accessibles et provenance d'exécution. | Une topologie inchangée ne révèle pas à elle seule une inversion extérieure. |

L'entrée doit être une vue sémantique des données, pas une capture de l'éditeur.
Déplacer un nœud ou changer sa couleur ne doit pas modifier une décision.

Une simple surveillance de la confiance du réseau risquerait de répliquer
ses propres croyances. Les indices doivent rester reliés à des faits et à leur
instant de disponibilité. Les prédictions peuvent être consultées comme telles,
mais jamais réinjectées comme succès observés.

Un observateur ne surmonte pas un défaut d'observabilité. Sur deux histoires
accessibles identiques, il ne peut garantir deux diagnostics différents corrects.
Il peut conserver plusieurs hypothèses ou demander une information, pas deviner
une variable cachée.

## 4. Ce que signifie « pointer des embeddings d'indices »

Un embedding est une représentation numérique utilisée pour rapprocher des
observations, fenêtres temporelles ou fragments de réseau. Ce n'est pas
une explication directement lisible, ni une probabilité de réussite.

Nous proposons deux niveaux complémentaires :

1. Des représentations locales d'indices, chacune reliée aux mesures, événements,
   nœuds ou liens qui l'ont produite.
2. Une représentation de situation qui aide à retrouver des expériences
   pertinentes et des hypothèses candidates, sans écraser les indices locaux.

L'observateur propose ainsi : « ces observations ressemblent à celles de ces
expériences ». Un mécanisme distinct vérifie la compatibilité avec le contexte,
les contradictions, la fraîcheur, l'objectif et les compétences mémorisées.

Exemple de contrat documentaire, non implémenté :

```json
{
  "observationId": "observation-104",
  "decisionId": "decision-27",
  "availableAt": 104,
  "worldRevision": "r104",
  "encoderVersion": "observer-3a-1",
  "featureSchemaVersion": "signals-1",
  "indexVersion": "index-7",
  "status": "usable",
  "cues": [
    {
      "embedding": [0.12, -0.34, 0.56],
      "sourceRefs": ["sensor-vibration:100..104", "experience-22"],
      "window": { "from": 100, "to": 104 }
    }
  ],
  "missingSources": [],
  "retrievedExperienceIds": ["experience-18", "experience-22"]
}
```

Les dimensions, la métrique et la normalisation seraient définies par le contrat
versionné, pas par cet exemple. Les vecteurs non finis, références étrangères,
fenêtres futures et versions incompatibles devraient être refusés.

Il faut conserver séparément qualité des données, score de similarité,
applicabilité estimée et fiabilité d'une action. Un score de similarité de 0,9
ne doit pas devenir « 90 % de chances de succès » dans l'interface.
Les contributions ou cartes d'attention seraient des aides d'inspection,
pas des preuves causales.

## 5. CNN, GNN ou modèle plus simple ?

Le choix dépend de la forme réelle des indices. Les pistes suivantes ne
constituent pas une sélection définitive d'architecture.

- Pour commencer, un extracteur explicite de caractéristiques et une recherche
  de voisins fournissent une référence compréhensible et peu coûteuse. Cette
  référence ne satisfait pas à elle seule l'objectif d'apprendre les indices.
- Pour des séries multicanales, nous proposons de comparer un CNN temporel
  causal, ou TCN. Les convolutions temporelles ont été étudiées comme alternative
  aux architectures récurrentes pour la modélisation de séquences.
  [Bai, Kolter et Koltun, 2018](https://arxiv.org/abs/1803.01271).
- Pour des nœuds, attributs et voisinages irréguliers, nous proposons d'évaluer
  un réseau de neurones de graphe, ou GNN. GraphSAGE apprend notamment à produire
  des embeddings de nœuds à partir des caractéristiques de leur voisinage,
  y compris pour de nouveaux nœuds. Cela motive cette piste, sans démontrer
  son adéquation à notre harnais.
  [Hamilton, Ying et Leskovec, 2017](https://arxiv.org/abs/1706.02216).
- Un assemblage temporel et relationnel pourrait ensuite traiter l'évolution
  de plusieurs composants liés. Il devrait battre les modèles simples sur
  les tests du projet avant de devenir une dépendance nécessaire.

Une image de capteur peut justifier un encodeur visuel. En revanche, appliquer
un CNN ordinaire à une capture du graphe introduirait des dépendances à sa mise
en page. Même une matrice d'adjacence exige de traiter correctement l'ordre
arbitraire des nœuds. Ce ne sont pas nos représentations de référence proposées.

Pour apprendre sans étiquettes de mode préétablies, une piste consiste à
prédire les observations futures dans un espace latent. Contrastive Predictive
Coding constitue un repère pour cet apprentissage de représentations.
Notre variante envisagée, conditionnée par les commandes et évaluée sur leurs
effets, reste une proposition spécifique à construire et à tester.
[van den Oord, Li et Vinyals, 2018](https://arxiv.org/abs/1807.03748).

Ces publications motivent des familles de modèles, pas une preuve de
plasticité, d'identifiabilité ou de sûreté pour SpikyPanda.

## 6. V3 : apprendre des indices utiles sans les ériger en vérités

### 6.1. Deux temps de traitement distincts

Avant l'action, l'observateur ne reçoit que l'information déjà disponible.
Il propose des indices et des précédents. L'interpréteur maintient des hypothèses
de conditions applicables, avec la possibilité de ne pas savoir.

Après l'action, le résultat réel permet d'évaluer la prédiction, de réviser
l'attribution de l'expérience et de préparer l'apprentissage de l'observateur.
Le résultat futur peut servir de cible d'entraînement ; il ne doit jamais
figurer dans l'entrée qui aurait servi à décider avant ce résultat.

Le coût de l'action, son effet physique et son utilité pour l'objectif doivent
rester distinguables. Un même effet peut être utile pour une cible et nuisible
pour une autre. Apprendre une représentation commune des effets ne donne pas
le droit de transférer automatiquement les scores de compétence.

### 6.2. Une intégration dans les mécanismes existants

L'encodeur serait un service remplaçable injecté par l'hôte. Il pourrait être
local ou distant, mais un service distant exigerait une autorisation explicite
sur les observations transmises. Le choix d'un modèle ne doit pas imposer
un appel externe à chaque décision.

Les nouveaux comportements seraient des nœuds spécialisés, construits avec
`RuntimeGraphBuilder` et leurs surcharges. L'observation d'indices se placerait
avant la recherche des branches. L'évaluation après exécution produirait
des données pour une mise à jour contrôlée, pas une mutation du graphe en plein
appel. Pas de nouveau `runStage` central.

Les liens entre indices, sources et expériences seraient matérialisés avec
`GraphBuilder`. Les nouveaux liens seraient versionnés et marqués comme
observations, hypothèses ou révisions. Le plugin les inspecterait sans prendre
en charge l'apprentissage lui-même.

La mémoire de référence resterait le journal et ses relations vérifiables.
Un index vectoriel serait une vue reconstruisible, jamais l'autorité
d'exécution. La recherche de voisins propose des candidats ; elle ne contourne
ni l'éligibilité, ni les gardes, ni l'approbation.

Les décisions conserveraient l'identité de l'observation, les versions utilisées
et la provenance des hypothèses. Toute réponse asynchrone périmée serait rejetée.
L'état courant resterait propre au runtime ; l'encodeur et la mémoire pourraient
être partagés avec des snapshots cohérents et des mises à jour coordonnées.

### 6.3. Ne pas déguiser un embedding en nouvelle signature V2

Il ne suffit pas de remplacer le rapport commande/effet par un vecteur dans
`EffectSignatureProvider`. La V2 utilise l'égalité exacte et dérive l'identité
d'un mode de sa signature. De petites variations d'un vecteur créeraient alors
des modes inutiles ; un arrondi arbitraire ne résout pas le problème.

La V3 devra séparer l'identité stable d'une hypothèse, sa description révisable,
les versions de ses représentations et les conditions de rattachement des
expériences. Plusieurs indices partiels pourront soutenir plusieurs hypothèses.
Des relations de compatibilité ne seront pas assimilées à des équivalences.

Il faudra une migration explicite : conserver l'historique V1 non attribué,
préserver les attributions V2 et ne pas inventer des indices manquants.
Un ancien mode V2 peut servir de référence d'effet observé ; il ne devient
pas automatiquement une classe universelle applicable à tous les objectifs.

### 6.4. Découper la V3 en expériences vérifiables

- V3-a : contrat d'observation, provenance et encodeur simple en lecture seule,
  sans influence sur les décisions. Constituer les données et baselines.
- V3-b : apprendre une représentation prédictive, puis comparer les variantes
  simple, temporelle ou relationnelle selon les données. Mesurer les indices
  utiles, les faux rapprochements et les informations manquantes.
- V3-c : autoriser la reconnaissance avant action sur les cas observables,
  après validation séparée. Maintenir une sortie « incertain » et une voie de
  repli ; préserver les tests d'exécution et de plasticité.

Le protocole doit modifier les corrélations : retirer un capteur, permuter
un indice trompeur, changer les paramètres et introduire des effets inédits.
Sinon, le modèle pourrait apprendre un numéro d'épisode, une phase de simulation
ou sa propre précédente décision au lieu d'une relation pertinente.

## 7. V4 : choisir quand observer plutôt qu'agir

Quand plusieurs hypothèses impliquent des commandes différentes, le harnais
pourrait comparer une action productive, une mesure supplémentaire, un essai
discriminant autorisé et une abstention ou demande humaine.

Ce serait une nouvelle capacité de décision, pas un signal à préfixer à chaque
action. Le besoin de diagnostic dépendrait de l'incertitude et du risque.
Une simulation de conséquences pourrait aider, mais ses résultats resteraient
des prédictions, séparées des expériences effectivement vécues.

Le premier lot devrait garder une seule invocation par décision. Une mesure
diagnostique serait une capacité contrôlée, suivie d'une nouvelle observation.
Les plans multi-actions, boucles et workflows imbriqués exigeraient un jalon
distinct ; ils ne sont pas fournis par le compilateur actuel.

Un diagnostic consomme du temps, de l'énergie ou peut perturber le système.
Il faut donc mesurer son information utile et son coût réel. Le harnais doit
pouvoir reconnaître qu'aucun test sûr ne permet de départager les hypothèses.
Les essais sur un système critique ne sont jamais autorisés par un simple
score d'apprentissage.

## 8. Plasticité de la mémoire et de l'encodeur

L'ajout d'une perception apprise ne doit pas déplacer le gel des poids dans
une couche devenue invisible.

Nous proposons de distinguer une adaptation rapide de l'applicabilité et
une évolution contrôlée de l'encodeur. Une version reste stable pendant une
décision pour garantir sa cohérence, mais peut être remplacée après comparaison.
Conserver une version reproductible n'interdit pas sa remise en question.

Une mise à jour de modèle peut déplacer tout l'espace des embeddings.
Il faut alors réencoder les observations conservées ou valider un alignement
explicite. Ne jamais comparer silencieusement des vecteurs issus d'espaces
incompatibles. Si les sources ne permettent pas la reconstruction, le système
doit invalider cette recherche et le signaler.

Les nouvelles représentations doivent être testées sur apprentissage récent,
rappel d'anciens fonctionnements et situations inconnues. Le tampon d'entraînement
peut garder des expériences diverses et contradictoires sans donner aux anciens
succès un poids infini. Budget, échantillonnage et règles de mise à jour sont
des paramètres expérimentaux versionnés.

Fusion, scission ou retrait d'hypothèses exigeraient une provenance et une
reconstruction des statistiques concernées. La compaction ne devrait pas
effacer les preuves indispensables à une correction. Ces mécanismes ne sont
pas tous présents dans la V2 et doivent être qualifiés séparément.

## 9. Comment invalider les étapes proposées

Comparer au minimum V1, V2, un observateur simple, l'observateur appris sans
influence sur les décisions, puis le même observateur activé. Ajouter un
contrôleur informé du mode caché uniquement comme repère privilégié, clairement
identifié et isolé des entrées de tous les contrôleurs évalués.

Les traces d'entraînement, de réglage et de test doivent être séparées par
séquences ou scénarios, pas par mélange de fenêtres temporelles voisines.
Normalisation, prototypes, métriques et seuils sont ajustés hors test.
Les seuils d'acceptation sont décidés avant les runs, puis versionnés :
cela fixe un protocole de mesure, pas des poids de décision définitifs.

| Épreuve | Ce qu'elle doit mesurer | Motif d'invalidation |
| --- | --- | --- |
| A-B-A-B avec indice préalable accessible | Mauvaises premières actions et latence de reconnaissance, à réussite comparable. | Aucun gain sur V2, ou gain dû à une étiquette cachée. |
| Inversion sans aucun indice préalable | Incertitude et comportement après la première information discriminante. | Promesse d'anticipation certaine ou fuite d'information du simulateur. |
| Indices contradictoires, bruités ou absents | Faux rappels, abstentions, récupération et nombre d'hypothèses. | Certitude maintenue malgré l'absence de données ou prolifération non bornée. |
| Suppression ou permutation d'un indice | Dépendance réelle aux signaux utiles, sur séquences séparées. | Performance due à un numéro d'épisode ou à une corrélation artificielle. |
| Permutation des nœuds et changement de mise en page | Invariance des résultats d'un observateur de graphe sémantique. | Décision différente à cause des coordonnées de l'éditeur ou de l'ordre des nœuds. |
| Mêmes indices, effets différents | Détection de limites de représentation et attribution incertaine. | Transfert automatique de fiabilité sur une simple proximité vectorielle. |
| Nouvel objectif ou paramètres nouveaux | Séparation de l'effet et de son utilité. | Réutilisation non justifiée du score d'un autre objectif. |
| 10 000 succès puis contradictions | Délai borné de désactivation, rappel ultérieur et correction d'attribution. | Compétence irréversible ou contexte créé à chaque échec pour éviter la critique. |
| Mise à jour, restauration et panne d'encodeur | Cohérence des versions, repli et fidélité de la provenance. | Vecteurs incompatibles comparés, décision périmée acceptée ou historique réécrit. |
| Diagnostic V4 coûteux ou dangereux | Coût total, information obtenue et respect des contrôles. | Baisse des erreurs obtenue en ignorant le coût ou en contournant les gardes. |
| Changement continu et cas inconnus | Récupération, non-récupérations et oubli des compétences anciennes. | Résultat obtenu seulement sur alternances scénarisées familières. |

Rapporter la distribution sur plusieurs graines, les échecs, le coût
d'encodage et de raisonnement, la taille de mémoire et les violations de
contraintes. Une jolie séparation des vecteurs sur une projection 2D ne
remplace pas un gain mesuré sur les décisions.

## 10. V5 : raconter et éprouver un cas de résilience

Nous proposons un banc de production simulé, par exemple un convoyeur motorisé
avec commande de vitesse, charge, température et signaux de vibration.
Les pannes, glissements, capteurs manquants et retours à la normale seraient
des événements du monde, non des labels fournis au contrôleur.

Ce banc permettrait de raconter trois épisodes distincts : reconnaître un
fonctionnement grâce à des indices, constater qu'ils ne suffisent plus, puis
choisir une mesure autorisée avant de reprendre une action productive.
Il permettrait aussi de conserver des phases sans indice préalable pour
ne pas masquer la limite d'observabilité.

Le modèle physique, les relations capteurs/pannes et les enveloppes admissibles
restent à définir et à valider. Contre-exemples, phénomènes continus, absence
de remise à zéro opportuniste et baselines identiques sont indispensables.
Ce scénario est une proposition de sample, pas du code à intégrer à la lib.

HELIOS peut constituer une autre étude, mais son script actuel reste illustratif
et ne démontre pas la résilience d'un système de survie. Un résultat dans un
simulateur, même favorable, ne constitue pas une qualification opérationnelle.

## 11. Décisions de cadrage V3 et suites

Le contrat numérique, le sample avec mesures et les modes shadow/active sont
maintenant implémentés au palier 0.1. Les étapes concernant un encodeur neuronal
et sa validation restent à décider. Le découpage V3-a/b/c est une cible de travail,
pas l'affirmation que 0.1 fournit déjà une représentation prédictive générale.

1. Valider le contrat d'indices et les données réellement observables.
2. Définir les variantes Counter avec indice, bruit et absence d'indice.
3. Établir les critères de rejet, puis implémenter V3-a sans changer la décision.
4. Choisir un encodeur appris uniquement après comparaison aux références simples.
5. Ne faire entrer ses hypothèses dans le rejeu qu'au jalon V3-c.
6. Traiter séparément le diagnostic V4 et la validation continue V5.

Les noms des versions suivantes, l'architecture neuronale et les seuils
restent discutables. L'engagement architectural est de préserver l'explicabilité
des attributions, la capacité de remise en question et les contrôles d'exécution.

## Repères du dépôt

- [Observateur 0.1](OBSERVATEUR_V0_1.md), algorithme implémenté et limites.
- [Note sur la flexibilité et la plasticité](NOTE_PLASTICITE_ET_CONTEXTE.md).
- [État des lieux V1](ETAT_DES_LIEUX_V1.md), document historique.
- [Refactorisation par héritage et builders](REFACTORISATION_NOEUDS.md), document historique.
- [Mémoire contextuelle V2](V2_MEMOIRE_CONTEXTUELLE.md), périmètre implémenté.
- [Contrat d'exécution](EXECUTION.md) et [validation](VALIDATION.md).
- [Plan d'implémentation](../IMPLEMENTATION_PLAN.md), chantiers logiciels transversaux.
- [Signature Counter](../examples/counter/contextual.mjs), modèle d'effet du sample.
- [Contrats de fonctionnement V2](../packages/harness/src/operating-types.ts)
  et [mémoire conditionnelle](../packages/harness/src/contextual-policy.ts).

## Étape V3 : persistance avant consolidation, 9 septembre 2026

La variante `harness-v3-consolidated` sépare la fenêtre de persistance des effets,
la mémoire durable et la reconnaissance par indices. Elle n’introduit pas de
modèle de spikes. La V3 active précédente reste le témoin comparatif.

Voir [le mécanisme](V3_CONSOLIDATION_TEMPORELLE.md) et [les résultats](RESULTATS_CONSOLIDATION_V3.md).
Le détecteur de mouvement déjà présent dans SpikyPanda reste une brique
possible d’extraction d’indices, à évaluer séparément de cette consolidation.

## Expérience temporelle sur V3, après la consolidation

Les variantes `harness-v3-continuous` et `harness-v3-spikes` comparent deux
propagations du même indice, sur les graphes du Core. Elles ne remplacent
aucune référence et n’ajoutent aucun apprentissage des connexions.
La mémoire temporelle réside exclusivement dans les sessions, distinctement
des expériences durables. Le compteur de démonstration est inchangé.

Voir [le protocole explicite](V3_PROPAGATION_TEMPORELLE.md) et
[les résultats](RESULTATS_PROPAGATION_V3.md). La promotion éventuelle dépend
du compromis produit mesuré, pas de l’adoption des spikes comme objectif.

### Comparateur additionnel : reset modulé

`harness-v3-spikes-modulated` ajoute un reset partiel, piloté par les indices
courants, sans modifier les variantes précédentes. Le résidu reste dans la
session et ne sert pas de preuve pour renforcer sa propre confiance. La
consolidation et les paramètres des témoins sont conservés.

Voir [le protocole du reset modulé](V3_RESET_MODULE.md). Il s’agit d’une
comparaison de variantes de V3, pas d’une promotion automatique vers V4.

## Orientation suivante : la mémoire devient le support de l'activation

Après clarification des graphes, la direction retenue consiste à reconnaître
par activation temporelle de la topologie apprise, et non par sélection préalable
d'un régime suivie d'une consultation de mémoire.

Le [contrat d'activation topologique](ACTIVATION_TOPOLOGIQUE_CONTRAT.md) décrit
les messages, les relations ET/OU, l'état de session, l'arbitrage entre branches
et l'attribution après effet. Les régimes historiques restent des données de
provenance ; ils ne constituent plus une étape obligatoire de la nouvelle voie.

Statut : contrat T0 documenté, prototype T1 implémenté. Les lots sont :
T1, exécution d'une mémoire-fixture ; T2, dynamique temporelle comparée ;
T3, construction et révision depuis les expériences ; T4, comparaison produit.
Ils ne changent ni les identifiants des contrôleurs V3, ni les versions npm,
ni le sens historique des étapes V4/V5 de ce document.

Les propositions antérieures sur CNN/GNN, embeddings et classement de régimes
restent des pistes ou des références historiques, pas des prérequis imposés
à cette direction. Les résultats du reset modulé portent uniquement sur le
détecteur temporel de régime V3, pas sur l'activation de la mémoire elle-même.


### Livraison T1 : propagation réelle, sans dynamique neuronale

Le [prototype T1](ACTIVATION_TOPOLOGIQUE_T1.md) exécute une mémoire-fixture
dans Core et passe ses propositions au harnais existant. Il vérifie les
conditions locales, ET/OU, le partage d'indices, les coupures, l'arbitrage,
l'isolation des sessions et les garde-fous.

Le graphe et les statistiques de départ sont des données manuelles du sample,
pas un apprentissage automatique. Les expériences réelles sont journalées avec
leur parcours, sans attribution de crédit à ce stade. Les connexions et les
confiances de cette fixture ne sont donc pas mises à jour par T1.

T2 est le prochain lot : même topologie, dynamique temporelle comparée.
T3 traitera la construction et la révision des chemins ; T4 leur comparaison
produit. Aucun gain sur V3 ou LangGraph n'est déduit des tests combinatoires.


### Livraison T2 : comparaison temporelle locale, 9 septembre 2026

T2 applique la dynamique aux branches terminales, sans transformer les
conditions et motifs ET/OU en neurones. Les petites unités LIF sont de vrais
sous-graphes Core, dont les sessions appartiennent aux états des branches.
Les connexions et la confiance restent les données manuelles de la fixture.

Le [protocole](ACTIVATION_TOPOLOGIQUE_T2.md) et les
[résultats](RESULTATS_TOPOLOGIE_T2.md) conservent 128 runs sur huit cas et
quatre cadences, avec T1 comme témoin. Les anciens résultats V3 sont inchangés.

Bilan : le transitoire est filtré, mais les replis augmentent. Le reset modulé
réduit les silences ; il ne supprime ni la dépendance à la cadence ni le risque
de masquer temporairement une branche concurrente sous le seuil.

Avant T3, la priorité est donc une variante d'arbitrage distinguant
« peut proposer » de « doit participer au conflit ». Elle doit être comparée
à ce T2 conservé, pas remplacer silencieusement ses règles. La création des
chemins et la révision des confiances ne sont pas démarrées dans ce lot.
