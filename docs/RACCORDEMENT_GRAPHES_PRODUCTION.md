# Raccordement des vrais graphes au banc de production

État du 9 septembre 2026. Banc `production-cell@0.2.0`, contrat et métriques
version 2. Les paquets du harnais restent en version 0.1.0.

## Ce qui s'exécute maintenant

| Sélecteur | Chemin réel | Apprentissage utilisé pour choisir |
| --- | --- | --- |
| reference | Fonction JavaScript de référence. | Aucun. |
| langgraph | Runtime LangGraph, un nœud exécutant la fonction de référence. | Aucun ; témoin d'intégration. |
| harness-fallback | Graphe core complet à 12 nœuds, lecture de mémoire remplacée par un override qui renvoie zéro candidat. | Non, mais les expériences sont enregistrées. |
| harness-v1 | Graphe core à 12 nœuds avec PolicyGraph. | Fiabilité des actions dans un contexte mesuré. |
| harness-v2 | Graphe core à 12 nœuds avec ContextualPolicyGraph et OperatingContextTracker. | Fiabilité conditionnelle et hypothèses issues des réponses observées. |
| harness-v3-shadow | Graphe core à 13 nœuds, observateur 0.1 en observation seule. | Choix de la V2 ; observations d'indices enregistrées. |
| harness-v3-active | Même graphe à 13 nœuds, observateur actif. | Les indices peuvent reconnaître un contexte ou renvoyer au raisonneur. |

Le sample construit ses graphes avec `RuntimeGraphBuilder` de core et
`createRuntimeGraphDriver`. `AdaptivePolicyRuntime.step` exécute
`graph.runAsync` avec une vraie `HarnessSession`. Les nœuds existants effectuent
la lecture de policy, le choix de branche, l'autorisation, l'exécution,
l'observation du résultat, l'évaluation et l'enregistrement.

Aucun `runStage` n'est ajouté au runtime. Aucune décision de production n'est
placée dans la bibliothèque générique. Deux overrides locaux suffisent :
le témoin qui consulte toujours le raisonneur et le traitement des résultats
qui ne peuvent pas être attribués à l'action demandée.

Fichiers :
[graphe](../benchmarks/production-v1/controllers/harness-graph.mjs),
[adaptateur](../benchmarks/production-v1/controllers/harness.mjs),
[sémantique du sample](../benchmarks/production-v1/controllers/production-contract.mjs).

## Un vrai passage par l'action et son résultat

Le contrat 1 demandait `decide`, puis le banc exécutait, puis appelait `learn`.
Le contrat 2 conserve cette forme et ajoute une forme exclusive pour les graphes :

```js
createController(publicContract) => {
  id,
  step(observation, dispatch, abortSignal),
  inspect?()
}
```

Dans le graphe, le nœud d'exécution appelle une capacité enregistrée,
`production.command`. Elle invoque `dispatch({ actionId, rationale })`.
Seul ce point fourni par le banc possède le simulateur et peut le faire avancer.

Le banc applique exactement le même garde que pour les règles directes. Le retour
contient les mesures avant/après, la demande, la commande envoyée et le refus
éventuel. La capacité met à jour la vue mesurée du contrôleur ; les nœuds suivants
observent ce résultat, l'évaluent et l'enregistrent dans la mémoire.

Le garde du graphe autorise la soumission d'une commande valide, pas un
contournement des contraintes physiques. L'autorisation finale reste celle du
banc, dans `dispatch`. Le verrou thermique du simulateur reste indépendant.

Le callback ne permet qu'un seul envoi et expire à la fin du pas. Un deuxième
appel, même intercepté par l'adaptateur, invalide ce pas. Un rappel conservé ne
peut pas agir au pas suivant. Une expiration annule le signal du vrai runtime.
Une action déjà appliquée n'est jamais effacée si l'apprentissage échoue ensuite.

L'adaptateur n'accède à aucun événement futur, graine, type de panne, coefficient
caché ou état physique non mesuré. Comme précédemment, cette interface coopérative
n'est pas une sandbox contre du code volontairement malveillant.

## Choix métier explicites, pas vérité universelle

### Contexte observable

Le contexte de base regroupe la température mesurée par bandes de 10 °C,
la file par bandes de 10 pièces et le statut du verrou. Une mesure absente
est distinguée. Les mesures complètes restent disponibles dans les features.

Ce regroupement est une approximation écrite pour ce sample, pas un encodeur
général appris. Il peut confondre des situations et fragmenter inutilement la
mémoire. Il n'utilise ni action recommandée ni identifiant de panne.
Les trois versions partagent ce même regroupement pour cette première comparaison.

### Hypothèses V2

Les signatures utilisent uniquement les réponses mesurées après une commande
effectivement appliquée :

- Vitesse / consigne moteur, arrondie par pas de 0,25.
- Courant / consigne moteur, arrondi par pas de 2.
- Débit de refroidissement / consigne de ventilation, arrondi par pas de 0,25.

Ces rapports ne reconstituent pas les paramètres cachés du simulateur.
Une commande sans entraînement ne fournit pas cette signature.
L'inertie, le bruit et le choix des arrondis peuvent produire plusieurs
hypothèses pour un même fonctionnement physique. C'est une limite à mesurer,
pas une reconnaissance de panne acquise.

### Indices V3

L'observateur reçoit température, vitesse, courant, vibration, débit de
refroidissement, file et ambiance, avec des échelles numériques déclarées.
Les poids discriminants et les prototypes restent ceux de l'observateur 0.1,
calculés à partir des expériences attribuées par la V2.

Aucun réglage de l'observateur n'est modifié pour améliorer les premiers
résultats de production. Une abstention fréquente ou un coût élevé est un
résultat utile du banc. La V3 ne bénéficie d'aucune supériorité présumée.

### Signal d'apprentissage

Le signal local utilise les seules observations publiques. Les arrivées sont
reconstituées par la variation du stock et des compteurs de sortie.
Une expérience est positive si :

- la température mesurée respecte la limite et le verrou est inactif ;
- aucun débordement n'est observé ;
- les rejets représentent au plus 10 % de la quantité traitée ;
- au moins 90 % des arrivées sont traitées en pièces conformes, ou une baisse
  de température supérieure à 0,2 °C est observée après un départ à au moins
  90 % de la limite thermique.

La récompense vaut +1 ou -1 pour cette observation. Elle alimente les EMA
révisables du harnais ; elle ne devient jamais un poids permanent de réussite.
Le refroidissement protecteur peut être utile localement tout en dégradant
le service global : les métriques du banc comptent toujours cette dégradation.

Une mesure de température manquante, un refus du garde, une intervention du
verrou ou une commande pas encore appliquée font ignorer cette expérience.
La trace de décision et le résultat physique restent conservés. On ne transforme
pas l'effet d'une autre commande en succès ou échec de celle demandée.

Ce traitement ne résout pas l'attribution causale des effets retardés : deux
commandes identiques et l'inertie peuvent encore mêler leurs effets. Le signal
local ne voit pas un capteur biaisé comme le voit l'évaluateur possédant la vérité
du simulateur. Récompense locale et résultat du banc sont volontairement séparés.

## Raisonneur et dépendances

Le repli utilise exactement `referenceDecision`, la fonction à règles du témoin
direct. Il ne reçoit que les mesures publiques, pas une étiquette de bonne action.
La récompense n'est pas calculée en comparant sa décision à cette fonction.

Il n'y a aucun appel LLM. Les « appels au raisonneur » sont des appels à cette
fonction, pas des tokens économisés ni un coût monétaire évité. Un LLM reste
un prochain adaptateur avec son propre protocole de coût et de latence.

Aucune dépendance n'est ajoutée. Le comparateur LangGraph reste optionnel et
hors des paquets du produit. La politique de dépendances critiques reste inchangée.

## Lire les traces et les mesures

Chaque résultat SpikyPanda expose les nœuds réellement visités, la source de la
décision (`policy` ou `fallback`), l'évaluation, l'attribution et l'état des indices.
Le bilan conserve le nombre de parcours commencés/terminés, les passages par
nœud, les appels au raisonneur et les tailles de mémoire.

Les compteurs de mémoire distinguent contextes, actions, transitions, expériences
et modes. `serializedBytes` mesure la taille du JSON de mémoire, pas la mémoire
résidente du processus. Les diagnostics de l'adaptateur sont des observations
de son exécution dans ce test de confiance, pas une preuve contre un adaptateur
malveillant.

Les métriques physiques restent calculées par le banc. Le temps avant
`dispatch` et celui après son retour sont séparés ; ce dernier inclut observation,
évaluation, enregistrement et diagnostics, pas uniquement une primitive
d'apprentissage. `controlMsP95` porte sur leur somme. Le calcul du simulateur
dans `dispatch` n'entre pas dans cette somme ; le délai mural global, lui,
borne le pas entier. Le bilan final de mémoire est chronométré séparément.

Le témoin `harness-fallback` doit reproduire les trajectoires physiques des règles
directes. Il n'est pas un benchmark de coût d'orchestration équivalent à LangGraph :
il conserve des contrôles et une mémoire que ce premier témoin LangGraph n'a pas.

## Commandes

```sh
npm run test:benchmark:harness
npm run benchmark:production -- --controller harness-v1 --scenario nominal --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v2 --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-shadow --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-active --seed 101 --out dist/benchmarks
```

Sans `--scenario`, les dix familles sont exécutées. Sans `--seed`, toutes les
graines du split choisi sont exécutées. Une sélection est inscrite dans le rapport ;
une graine étrangère au split ou un scénario inconnu sont refusés.
`--traces` conserve les 600 lignes complètes par cas.

La commande npm compile le harnais avant le lancement. Un lancement direct
par `node` suppose une compilation à jour. Les sources JavaScript effectivement
chargées du harnais et de core sont empreintées dans les rapports.

Le banc est désormais versionné 0.2.0 à cause du contrat et de la métrologie
étendus. La physique, les événements, les graines et les objectifs sont inchangés.
Les rapports 0.1.0 restent des archives et ne sont pas mélangés aux nouveaux.

Le [relevé des premières campagnes](RESULTATS_GRAPHES_PRODUCTION.md) conserve
les résultats comparés et le diagnostic de l'ambiguïté au démarrage.

## Limites et décision suivante

Les graphes sont raccordés, mais ces premiers adaptateurs ne démontrent pas la
généralisation. Aucun moteur n'est déclaré gagnant. Le simulateur reste synthétique,
le regroupement de contexte et les signatures sont des choix de sample.

La suite doit examiner les échecs observés, élargir les variations réservées
et améliorer le comparateur produit avant une décision d'architecture.
Voir [le protocole](BENCHMARK_PRODUCTION_V1.md) et
[la note de généralisation](GENERALISATION_ET_BANCS.md).
