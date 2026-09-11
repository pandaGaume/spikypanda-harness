# V3 : comparer l'intégration continue et les spikes

Statut : expérience implémentée, pas une nouvelle architecture par défaut.
Aucune dépendance ajoutée. Le compteur de démonstration reste inchangé.

## Question produit

La consolidation filtre déjà l'admission des expériences en mémoire durable.
Cette expérience examine une autre question : faut-il intégrer des indices
dans le temps avant de déclarer un régime applicable ?

Quatre variantes peuvent être exécutées sur le même banc de production :

- `harness-v2` : référence par les effets observés.
- `harness-v3-consolidated` : métrique adaptative instantanée et consolidation.
- `harness-v3-continuous` : même métrique et consolidation, intégration continue.
- `harness-v3-spikes` : même métrique et consolidation, intégration LIF avec reset.

Les deux variantes temporelles partagent tous leurs paramètres. Le seuil du
neurone est un paramètre expérimental de propagation, pas un poids définitif
de réussite. Les fiabilités des actions restent plastiques.

## Où vit la mémoire

Les paramètres vivent dans les nœuds. Tout l'état temporel mutable vit dans
des `Session` du Core et leurs `INodeState` :

- Une session propriétaire conserve le registre borné des contextes, les
  horodatages, le dernier candidat, les compteurs et le cache de validation.
- Chaque contexte actif possède une session de calcul avec les potentiels,
  les entrées en attente et les dernières activations de ses nœuds.
- Les graphes sont construits avec `RuntimeGraphBuilder`, puis exécutés par
  l'ordonnanceur dynamique du Core. Il n'existe pas de boucle qui appelle
  directement les neurones en remplacement du graphe.
- La session propriétaire persiste entre les décisions du harnais.
  `observer.network.session.reset()` efface tous ces états temporaires.
  Cela ne modifie ni les expériences consolidées, ni leur confiance.

Le nœud de stockage de la session propriétaire n'est pas compté comme une
exécution de calcul : seuls les nœuds effectivement appelés sont comptabilisés.
Partager une définition de graphe entre sessions ne partage pas les potentiels.
Chaque flux d'observations possède son observateur temporel et sa session :
un même observateur temporel ne doit pas être partagé entre deux flux concurrents.
Le modèle métrique de base peut, lui, être partagé.

## Algorithme exact

### 1. Métrique inchangée

L'observateur adaptatif existant calcule les distances des indices mesurés
aux régimes appris. Son apprentissage, ses exemples et son encodage restent
inchangés. Une prédiction ne devient jamais un exemple d'apprentissage.

La variante temporelle ne découvre pas une nouvelle représentation. La métrique
choisit toujours le candidat le plus proche. Le réseau temporel décide si les
indices qui soutiennent ce candidat persistent suffisamment.

### 2. Transformer les distances en un débit d'indice

Pour les deux meilleurs candidats, de distances `d1 <= d2` :

```text
proximité = max(0, 1 - d1 / distanceMax)
séparation = min(1, max(0, d2 - d1) / margeMin)
r = proximité * séparation
```

Le débit `r` est compris entre 0 et 1. Seul le meilleur candidat reçoit ce
débit ; les autres reçoivent zéro. Il s'agit d'un encodage explicite, identique
dans les deux variantes, et non d'une probabilité calibrée.

Il porte sur le niveau des indices, pas seulement leur variation. Un état
bloqué et stable peut donc continuer à alimenter son hypothèse.

Les statuts `missing` et `novel` interdisent une activation temporelle.
Le statut `learning` conserve le comportement antérieur : recours à
l'historique des effets tant que la métrique ne peut pas discriminer les régimes.

### 3. Intégrer la durée réelle

La première observation n'apporte aucune durée. Pour les suivantes, tant que
le candidat et le contexte restent compatibles :

```text
dt = temps courant - temps précédent, en secondes
rIntervalle = min(rPrécédent, rCourant)
I = rIntervalle * tau * (1 - exp(-dt / tau))
V = VPrécédent * exp(-dt / tau) + I
```

Le minimum exige deux observations corroborantes. Une relecture ne crée pas
de temps écoulé. La fuite est celle du `LifNeuronNode` du Core.

Paramètres déclarés avant la première campagne :

- `tau = 3 s`.
- Seuil `theta = 1,5`, en unités d'indice intégrées.
- Validité d'une activation : `3 s`.
- Intervalle maximal entre observations : `2 s`.
- Au plus `64` contextes temporels et `8` candidats par contexte.

Avec un indice constant maximal, le franchissement théorique arrive après
environ `2,08 s`, constaté à l'observation suivante. Un indice constant
inférieur ou égal à `0,5` n'atteint pas ce seuil en temps fini. C'est une limite
explicite de ce réglage, pas une preuve qu'un indice faible serait inutile.

### 4. Deux sorties, un même contrat

Version continue : le neurone conserve son potentiel et publie son niveau à
chaque observation. Le lecteur renouvelle l'activation lorsque le niveau dépasse
le seuil. Le seuil interne de firing est rendu inatteignable pour désactiver
le reset, tout en réutilisant l'intégrateur du Core.

Version spikes : au franchissement du seuil, le LIF publie un spike et remet
son potentiel à zéro. Le lecteur n'est exécuté que lorsqu'il reçoit ce spike.

Dans les deux cas, la dernière activation expire après trois secondes.
Il faut toujours un indice courant positif en faveur du même candidat.
Un changement de candidat, de liste des régimes, un trou temporel ou une
observation invalide efface l'activation temporaire du contexte concerné.
Un contexte évincé repart sans activation lors de son retour.

Une branche durable reste mémorisée pendant ces resets. Sa réactivation
temporelle peut toutefois demander de nouvelles observations.

### 5. Aucun accès direct à l'action

Le résultat est une admissibilité de régime pour le nœud existant de recherche
en mémoire. Les seuils de confiance, le raisonneur, l'autorisation des capacités
et le garde-fou physique restent sur leur chemin normal.

Le graphe de décision conserve ses 13 nœuds V3. L'observateur exécute ses graphes
temporels, dont la topologie et les compteurs figurent dans les diagnostics.
Les deux variantes utilisent les mêmes sous-graphes à trois nœuds par candidat :
source d'indice, intégrateur, lecteur d'activation.

Le contrôle de fraîcheur d'une évaluation relit la métrique mais n'avance pas
les sessions. Il rejette une substitution, une révision du modèle, un contexte
différent ou un changement d'horloge entre observation et sélection.

## Évaluation

### Banc de propagation contrôlée

`temporal-evidence-signals@0.1.0` fournit des scores d'indices synthétiques
communs aux variantes. Il ne mesure ni l'apprentissage d'une représentation,
ni la performance du contrôleur industriel.

Il couvre une impulsion brève, une bascule persistante, une dérive lente, un
retour A-B-A, des observations manquantes, des indices faibles bruités et un
indice durablement trompeur. Ce dernier cas doit rester visible dans les
résultats : la persistance ne transforme pas une corrélation fausse en vérité.

Trois graines, quatre cadences de 0,25 à 2 secondes, sept scénarios, trois
variantes, soit 252 parcours. Les dix premières secondes constituent un
échauffement commun, conservé dans les traces mais exclu des durées agrégées.
Les graines font varier le bruit du cas `weak-evidence` ; les six autres
signaux sont déterministes et leurs répétitions ne constituent pas de nouveaux
phénomènes indépendants. Les cadences lentes peuvent manquer ou suréchantillonner la durée d'un événement
bref : c'est une limite du protocole discret, pas une invariance générale.

Mesures : durée d'activation correcte, erronée ou absente ; délai de détection
par épisode, avec non-détections explicites ; changements de sélection ;
nœuds exécutés ; événements d'entrée, de sortie et spikes.

Le témoin instantané de ce banc est un seuil sur le score synthétique.
Ce n'est pas la V3 industrielle. La graine 211 est un contrôle de bruit à réglage
constant, pas une famille de phénomènes tenue à l'écart.

### Production en boucle fermée

Le banc `production-cell@0.2.0` reste inchangé. Chaque variante utilise la même
consolidation de dix secondes, les mêmes capteurs, actions, garde-fous et
raisonneur déterministe. Chaque cas commence avec une mémoire froide.

Mesures principales : pièces conformes, attente, énergie, violations de
contraintes, appels au raisonneur, réutilisations de mémoire, coût p95 de
contrôle et volume sérialisé. Le nombre de nœuds et d'événements temporels
est mesuré séparément. Une taille JSON n'est pas une mesure de RAM résidente.

Les métriques de propagation contrôlée ne remplacent pas ces résultats
produit. Une réduction d'événements n'implique pas une réduction du temps CPU.

## Limites de cette étape

- Pas de STDP, d'apprentissage des seuils, de CNN ou de nouveau détecteur MotionWatch.
- Pas d'optimisation de la reconstruction du modèle adaptatif.
- Le témoin continu publie à chaque observation. Une variante continue qui
  ne publierait que sur changement pourrait également réduire les événements ;
  elle n’est pas incluse dans cette première comparaison.
- Les sources et intégrateurs sont encore sollicités à chaque observation,
  y compris pour injecter zéro et mettre à jour la fuite. Seuls les lecteurs
  de sortie peuvent être moins sollicités grâce aux spikes.
- Un indice faible peut activer le continu puis provoquer des intermittences
  en version spikes, car le reset impose une nouvelle accumulation.
- Les paramètres sont fixes pour l'essai, sans sélection sur les résultats.
- L'export des nouvelles variantes est une enveloppe de diagnostic explicitement
  distincte. L'import complet d'un observateur temporel n'est pas encore pris
  en charge. Les formats V2 et V3 existants restent inchangés.
- Pas de changement de la démo navigateur et pas de conclusion de généralisation.

## Exécution

```sh
npm run experiment:temporal -- --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-continuous --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-spikes --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-consolidated --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v2 --seed 101 --out dist/benchmarks
npm run benchmark:compare -- rapport-continu.json rapport-spikes.json
```

Les résultats mesurés sont consignés dans `RESULTATS_PROPAGATION_V3.md`.

## Extension ultérieure : reset modulé

Le protocole initial et ses résultats restent les témoins de référence.
Une quatrième variante de propagation, `spikes-modulated`, a ensuite été
ajoutée au banc de signaux. Celui-ci exécute désormais 336 parcours, sans
modifier les 252 parcours précédents. Voir [le reset modulé](V3_RESET_MODULE.md).
