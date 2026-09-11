# Observateur 0.1 : premier palier V3

État au 9 septembre 2026. Implémenté dans ce dépôt, sans nouvelle dépendance.
« 0.1 » désigne ici ce premier observateur ; les paquets restent en version npm
`0.1.0`. Ce n'est ni l'observateur final, ni un CNN, ni un GNN.

## Pourquoi construire cette étape ?

L'objectif est produit : maîtriser le harnais, réduire les décisions inutiles et
conserver la capacité de le faire évoluer sans dépendance commerciale centrale.
Nous ne cherchons pas à revendiquer une découverte scientifique.

Cette étape doit nous apprendre à relier une perception avant action à des
expériences vérifiables, à reconnaître ses erreurs et à la remplacer sans refaire
le moteur. Elle produit des contrats, des traces et une référence de comparaison.
Elle ne constitue pas à elle seule une montée en compétence sur l'entraînement
des réseaux neuronaux : ce travail restera à faire si les cas produit le justifient.

## Le problème auquel elle répond

En V2, une branche peut être très fiable pour M1 et inadaptée à M2. Le retour
à M1 n'efface pas sa fiabilité, mais le harnais reconnaît M1 après avoir observé
l'effet d'une action. Il peut donc choisir une première commande inadaptée.

L'observateur 0.1 cherche un indice disponible avant cette commande :
« ces mesures ressemblent à celles des expériences attribuées à M1 ».
Il propose une applicabilité, pas une nouvelle fiabilité.

Le chemin exécuté devient :

```text
Mesure du monde → contexte + objectif → observateur d'indices → lecture de mémoire
                                                              ↓
                                             branche fiable ou raisonneur
                                                              ↓
                                      contrôles → action → effet réellement observé
                                                              ↓
                                         attribution V2 → expérience et fiabilité
```

L'apprentissage suivant relit cette expérience. La prédiction de l'observateur
n'est jamais utilisée comme étiquette d'entraînement.

## L'algorithme exact

### 1. Les mesures autorisées sont déclarées par l'hôte

`CueSchema` définit une liste de champs numériques, leurs chemins dans
`state.features`, une échelle positive par champ et une version.
La valeur normalisée est `x[j] = mesure[j] / échelle[j]`.

Les champs et leurs échelles ne sont pas découverts automatiquement.
En revanche, l'hôte ne déclare pas « tel signal signifie M1 » et ne préfixe
pas les actions. Le poids discriminant de chaque champ est appris.
Un champ absent ou nul reste manquant ; une valeur non numérique ou non finie
provoque un rejet, pas une conversion silencieuse.

La portée de la recherche reste celle de la V2 : identifiant d'état, objectif
et paramètres. Ce premier palier n'apprend pas un transfert entre objectifs.

### 2. Les effets observés fournissent les références

La V2 établit des modes à partir des signatures d'effets conçues par l'hôte.
Pour chaque mode de la portée courante, l'observateur sélectionne les expériences
confirmées ou révisées dont la signature observée correspond effectivement à
celle du mode. Il lit leurs mesures prises avant l'action.

Il conserve pour son calcul les 24 dernières expériences utilisables par mode.
Une expérience entièrement dépourvue de mesures n'entre pas dans cette fenêtre.
Il faut au moins trois mesures disponibles d'un champ dans chacun des modes
comparés et au moins deux modes suffisamment documentés.

Une expérience en attente, une anomalie ou une attribution révisée qui ne
correspond plus à sa signature observée ne devient pas une étiquette fiable
pour l'observateur. Les expériences restent néanmoins conservées pour audit.

### 3. Le poids des indices est réappris

Dans chaque mode, les exemples récents pèsent davantage. Pour un exemple situé
à `k` places du plus récent, le poids temporel vaut `0.92^k`.

Pour chaque champ, on calcule la moyenne et la variance pondérées de chaque mode.
Puis :

```text
séparation = (plus grande moyenne - plus petite moyenne)²
bruit      = moyenne des variances internes aux modes
poids      = séparation / (séparation + 4 × bruit + 0.01)
```

Un poids inférieur à 0,1 est remplacé par zéro. Si un mode comparé n'a pas
assez de mesures du champ, ce champ n'est pas utilisé.

Autrement dit : un signal qui varie surtout entre les modes devient utile ;
un signal qui varie beaucoup à l'intérieur des modes devient peu discriminant.
Ce calcul n'est pas une estimation de causalité ni une probabilité.

Ces constantes sont des réglages explicites, validés et versionnés, pas des
poids définitifs issus des réussites. Les poids appris sont recalculés ; ni
10 000 succès ni un ancien poids élevé ne peuvent figer le calcul.

### 4. Comparaison avec les prototypes de modes

Le prototype est le vecteur des moyennes du mode. La distance est :

```text
distance = racine( somme(poids[j] × (x[j] - moyenneMode[j])²)
                    / somme(poids[j]) )
```

Les sommes portent sur les champs pertinents présents dans les deux vecteurs.
La couverture mesure la part des poids pertinents dont la mesure actuelle est
disponible. Elle doit atteindre 80 %.

Un mode est reconnu si sa distance est au plus 0,35 et si la différence avec
la distance du deuxième mode est au moins 0,2. On conserve aussi, pour chaque
mode candidat, les identifiants de trois expériences proches au maximum.

La représentation numérique affichée est `z[j] = x[j] × racine(poids[j])`.
C'est un encodage numérique pondéré, pas un embedding latent appris par réseau
neuronal. Les exemples sont recalculés avec les mêmes poids que la requête ;
aucun mélange silencieux de versions d'espace vectoriel.

### 5. Cinq résultats possibles

| Résultat | Signification |
| --- | --- |
| `learning` | Moins de deux modes suffisamment documentés. |
| `missing` | Toutes les mesures sont absentes, ou la couverture pertinente est insuffisante. |
| `ambiguous` | Aucun indice discriminant exploitable, ou candidats trop proches. |
| `novel` | L'observation est trop éloignée des prototypes comparés. |
| `recognized` | Un candidat satisfait distance, couverture et marge. |

L'absence complète de mesures est vérifiée avant l'apprentissage initial.
`novel` ne crée aucun mode : la création de modes reste fondée sur les effets.
Un statut reconnu est une hypothèse révisable, pas une certitude sur le monde.

## Influence sur le harnais

Le service et les nœuds proposent deux modes :

- `shadow`, valeur par défaut de l'API : calculer et journaliser, mais laisser
  la V2 choisir. Cela permet de comparer la perception sans lui déléguer le choix.
- `active` : utiliser le mode reconnu avant la lecture des branches. Au démarrage
  (`learning`), conserver la V2 pour acquérir les premières expériences.
  Pour des indices manquants, ambigus ou éloignés, interdire le rejeu direct et
  demander une proposition au raisonneur.

La page de démonstration sélectionne explicitement `active` au démarrage ;
le sélecteur permet la comparaison `shadow`. Changer ce mode réinitialise le
monde et les compteurs, mais conserve la mémoire.

Une reconnaissance ne contourne jamais l'éligibilité de la branche, la validation
des arguments, le garde de l'hôte, l'approbation éventuelle ou la vérification
de fraîcheur juste avant exécution. Une erreur du capteur peut tout de même
faire choisir une mauvaise action autorisée. Son effet réel est alors attribué
par la V2 ; la prédiction erronée ne devient pas la vérité de l'apprentissage.

Le repli augmente potentiellement le coût du raisonneur. Il ne sait pas encore
choisir une mesure supplémentaire, estimer une valeur d'information ou organiser
un diagnostic actif. Ce sont des chantiers distincts.

## Implémentation et possibilité de remplacement

- [Contrats](../packages/harness/src/cue-types.ts) : schéma, configuration,
  assessment, décision et interface `CueObserver`.
- [Algorithme](../packages/harness/src/cue-observer.ts) :
  `AdaptiveCueObserver`, reconstruction, validation et provenance.
- [Nœuds](../packages/harness/src/cue-nodes.ts) :
  `CueObserverNode` et `CuePolicyLookupNode`, surcharges des mécanismes existants.
- [Sample Counter](../examples/counter/perceptive.mjs) : capteur, schéma,
  migration de graphe et assemblage des services.
- [Comparaison automatisée](../examples/counter/run-v3.mjs).

Le runtime reçoit le service ; il n'ajoute aucun dispatch `runStage`.
Le graphe exécutable utilise `RuntimeGraphBuilder`. La projection de provenance
`graphView(context)` utilise `GraphBuilder` et ajoute les mesures courantes,
leurs sources et leurs liens de ressemblance avec de vraies expériences.
Consulter cette projection ne crée aucune expérience d'apprentissage.

Le panneau de la démo affiche les mesures, les poids, les distances et les
numéros des expériences proches. Le graphe de mémoire reste une projection de
la policy ; le panneau d'indices est séparé de la fiabilité des branches.
Il distingue l'observation actuelle de la dernière décision enregistrée.

Un hôte peut fournir une autre implémentation de `CueObserver` ou surcharger
le nœud sans modifier le runtime. L'interface actuelle est synchrone ; un
encodeur asynchrone ou un entraînement en arrière-plan exigera une évolution
explicite des contrats. Le format de persistance livré ne charge que l'encodeur
actuel, pas des modèles arbitraires.

## Persistance, versions et coûts

Le document de mémoire V3 enveloppe une policy V2, l'identité de l'encodeur,
le schéma et la configuration. Les expériences conservent les diagnostics
d'indices avant action, les sources et les révisions utilisées.

La restauration valide cette structure, la cohérence des valeurs encodées et
les références à des expériences antérieures de la même portée. Elle ne fournit
pas de signature cryptographique ni de preuve d'authenticité de l'historique.
Les diagnostics importés ne servent pas de cibles à l'entraînement.

Les mesures brutes et les attributions restent la référence ; les prototypes
et poids sont reconstruits, pas persistés comme vérité immuable. La lecture
avant sélection vérifie que l'assessment correspond encore à l'observation
et au modèle actuels.

Les imports V1/V2 n'inventent aucun capteur manquant. Le sample migre en mémoire
les anciens graphes Counter vers 13 nœuds sans modifier automatiquement les
sauvegardes du navigateur. Les documents de harnais restent en version 1.

La fenêtre de calcul est bornée, pas le journal d'audit. Le code actuel parcourt
l'historique pour reconstruire les groupes et trie les exemples retenus pour
la recherche de précédents. Son coût dépend donc encore de la taille du journal.
Indexation incrémentale, compactage et budgets de stockage restent à construire.

## Ce que Counter permet réellement de voir

Le capteur simulé comporte un signal volontairement corrélé à la dynamique et
un signal parasite. Sa formule et le commutateur caché restent dans le sample.
Le harnais n'accède qu'aux mesures autorisées, pas à `world.direction`.

Ce dispositif vérifie la capacité à apprendre une corrélation accessible,
pas la découverte automatique d'un capteur industriel. Masquer les mesures
supprime cette information ; ajouter du bruit peut donner une abstention,
une bonne reconnaissance ou un faux rappel.

Parcours : entraîner huit épisodes en dynamique normale, inverser, entraîner
huit autres épisodes, puis revenir à une dynamique connue. La première
rencontre d'une nouvelle dynamique peut échouer. Les retours connus peuvent
être reconnus avant action si les indices sont encore utiles.

À la cible, la portée courante change. Le panneau peut donc afficher
« apprentissage initial » même si le mode « sous la cible » est appris.
Le prochain épisode repart de zéro et relit ses propres mesures.

## Résultats et limites d'acceptation

Le 9 septembre 2026 : 89 tests passent, plus un test du bundle navigateur.
La comparaison sur 25 épisodes déterministes donne :

| Mode | Actions | Actions sans progrès | Appels au raisonneur |
| --- | ---: | ---: | ---: |
| Observation seule, comportement V2 | 81 | 3 | 6 |
| Actif | 77 | 1 | 6 |

Lors des retours connus aux épisodes 17 et 22 : trois actions réussies en mode
actif, contre cinq actions dont une sans progrès en observation seule.
La première inversion reste une expérience nouvelle. Ce test ne démontre
pas une baisse des appels au raisonneur par rapport à V2.

Les tests couvrent aussi bruit non discriminant, indices absents, nouveauté,
confusion, dérive après 10 000 succès, révisions d'attribution, absence de
boucle d'auto-étiquetage, versions, restauration, contrôles, migration et
indépendance des hypothèses de runtimes partageant la mémoire.

Limites structurantes : métrique diagonale, relations essentiellement séparables,
aucune interaction non linéaire entre champs, aucune fenêtre temporelle ni
lecture de voisinage de graphe. Deux situations produisant les mêmes mesures
ne sont pas distinguables. Un mode nouveau ou encore trop peu documenté peut
ressembler à un mode connu et être mal reconnu. La V2 conserve ses signatures
exactes ; l'identité générale des hypothèses latentes n'est pas résolue.

## La suite, guidée par le produit

1. Choisir un cas produit avec des signaux réels et un coût de mauvaise décision.
   Constituer des séquences de référence, dont des cas sans indice préalable.
2. Mesurer les limites de 0.1 : faux rappels, abstentions, coût et adaptation
   des indices. Les traces actuelles servent de matière première ; il n'y a
   pas encore de chaîne d'export, d'annotation ou d'entraînement neuronal.
3. Ajouter des indices temporels si la chronologie manque ; traiter les relations
   entre composants si le voisinage apporte une information utile.
4. Comparer un éventuel encodeur appris à 0.1 en observation seule, puis
   autoriser une influence limitée après contrôle des régressions.
5. Traiter séparément le diagnostic actif, l'exploitation continue et la gestion
   durable de la mémoire.

Un CNN/TCN, un GNN ou une autre méthode ne sont pas engagés à ce stade.
Le choix structurant sera expliqué et décidé à partir des données du cas produit,
pas introduit implicitement pendant une implémentation.

## Autonomie et dépendances

Aucune nouvelle dépendance n'a été ajoutée pour l'observateur. Algorithme,
mémoire, sélection, contrôles et intégration sont implémentés dans le projet.
Aucun service distant, modèle préentraîné ou abonnement n'est requis.

La règle produit est : aucune dépendance commerciale obligatoire ; minimiser
les dépendances tierces, y compris MIT, et les réserver aux composants
périphériques remplaçables. Ajv reste une brique de validation JSON acceptable.
Cette règle n'est pas une interdiction de lire une publication ni une affirmation
d'absence de toute licence dans la chaîne logicielle existante. Les dépendances
transitives de core/editor devront aussi être auditées avant distribution.

Le choix ultérieur d'une bibliothèque, d'un moteur d'inférence ou de poids
préentraînés demandera un examen explicite de leur rôle et de leurs conditions.
La licence propre du dépôt n'est pas modifiée par cette étape.
