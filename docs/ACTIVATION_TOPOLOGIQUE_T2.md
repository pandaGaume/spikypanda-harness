# T2 : dynamique temporelle des branches

Date : 9 septembre 2026.
Statut : prototype implémenté et campagne terminée, sans promotion par défaut.
Ce protocole a été déclaré avant les mesures. Voir les
[résultats et la limite d'arbitrage](RESULTATS_TOPOLOGIE_T2.md).

## Périmètre

T1 reste le témoin combinatoire. T2 utilise les mêmes conditions, relations
ET/OU, invocations, statistiques de départ et arbitrage. La dynamique temporelle
est placée sur les branches terminales seulement. Les conditions et motifs
intermédiaires ne sont pas transformés en neurones.

Il ne s'agit ni du détecteur de régime V3 ni d'un réseau entièrement neuronal.
Aucun régime gagnant n'est choisi avant de parcourir la mémoire. Une branche
ne peut accumuler que le soutien arrivé par son propre chemin.

Chaque branche contient une petite unité Core, source de charge puis
`LifNeuronNode`. Le sous-graphe est construit avec `RuntimeGraphBuilder`.
Sa session appartient au `INodeState` de la branche dans la session
d'activation. Il ne conserve aucun état mutable dans la définition partagée.

Le comptage inclut ces sous-graphes : pour la fixture à deux branches,
8 nœuds du graphe principal et 4 nœuds internes sont exécutés par passage.
Il y a 9 livraisons principales et 2 livraisons de charge internes.
Les événements de seuil LIF sont comptés séparément. Leur apparition
n'entraîne ni nouvelle observation ni nouvelle exécution du harnais.

## Loi déclarée avant la campagne

Paramètres communs : tau=3 secondes, seuil=1,5, écart maximal=2 secondes,
potentiel initial=0, repos=0, période réfractaire=0. Version : `branch-temporal-v1`.

Pour une branche, r est le soutien courant de son chemin. Il vaut zéro
si le chemin est inconnu ou bloqué. Le soutien ne dépend jamais des statistiques
de réussite, de l'identifiant de scénario ou du résultat futur.

```text
dt = temps de mesure courant - temps de mesure précédent
c = min(r précédent, r courant)
charge = c * tau * (1 - exp(-dt / tau))
potentiel avant reset = potentiel précédent * exp(-dt / tau) + charge
```

La première mesure apporte une durée nulle. Les temps de mesure doivent
croître strictement ; les apports simultanés sont regroupés par l'hôte.
Le calcul utilise les temps de mesure, pas les temps de passage dans les
nœuds ni la durée des appels de garde-fou.

Cette interpolation prudente ne prouve pas que le phénomène est resté stable
entre deux mesures. Cette limite d'échantillonnage fait partie de l'expérience.

| Variante | Proposition | Après émission |
| --- | --- | --- |
| T1 | Soutien combinatoire courant | Aucun potentiel |
| continuous | Potentiel >= seuil ET soutien courant positif | Pas de reset |
| spikes | Événement LIF pendant ce passage ET soutien courant positif | Potentiel = 0 |
| spikes-modulated | Même règle à spikes | Potentiel = seuil * 0,8 * soutien courant |

En mode continu, Core utilise un seuil de tir inaccessible ; le seuil de
lecture reste 1,5. La loi de fuite et d'intégration est la même.
Le coefficient 0,8 est un paramètre de la variante modulée uniquement.

Un spike au cycle précédent n'est pas une proposition valide au cycle courant.
Aucune fenêtre de validité de trois secondes, contrairement à l'expérience
V3 précédente. Les cycles entre spikes peuvent donc demander le repli.

## Interruptions et invalidations

- Soutien nul ou donnée inconnue : aucune émission utilisable, charge nulle,
  fuite du potentiel restant. La prochaine mesure ne comble pas ce trou.
- Contradiction bloquante : potentiel remis à zéro localement.
- Écart de mesures supérieur à deux secondes : potentiel local remis à zéro ;
  la mesure de reprise ne représente aucune durée observée.
- Passage interrompu après démarrage : tous les potentiels de cette mémoire
  sont invalidés, pour ne pas conserver une mise à jour partielle.
- Révision, paramètres ou projection modifiés : refus, nouvelle compilation
  et nouvelle session nécessaires.
- Reset explicite : potentiels et compteurs remis à zéro ; journal conservé.

Les unités conservent leurs états entre inférences ordinaires. Les resets
d'interruption sont tracés et ne modifient ni la topologie ni la confiance.

## Mesures prévues

Comparaison appariée sur une fixture manuelle : persistance A, A-B-A,
perturbation brève, indices manquants, conflit, coupure de chemin,
observations durablement trompeuses. Cadences régulières et irrégulière.

Mesurer séparément décisions sélectionnées correctes/incorrectes, replis,
latence physique de reconnaissance, couverture des observations, nœuds exécutés, livraisons,
spikes et temps de calcul. Les réponses attendues du sample restent hors des
entrées du contrôleur. Les replis ne sont pas comptés comme des réussites.

Le banc d'activation ne réalise aucune action physique. Un essai séparé avec
le harnais complet vérifie les actions réellement exécutées et leurs gardes.

T1 et les 252 résultats historiques V3 restent des témoins inchangés.
Aucun réglage sur cas réservé, comparaison LangGraph ou gain de généralisation
n'est revendiqué. Ces mesures n'ont pas valeur de classement produit.

La création des chemins et l'attribution de réussite restent au lot T3.
La démo navigateur V3 et ses sauvegardes ne sont pas modifiées.

## Utilisation et inspection

```sh
npm run experiment:topology:temporal
npm run experiment:topology:temporal -- --json
```

API opt-in : `TemporalTopologyMemory`, `TemporalTopologySession`,
`createTemporalTopologyHarness`. La factory reçoit toujours le graphe de flux
de l'hôte. Elle n'introduit ni scénario générique caché ni dispatcher de stages.

Le passage expose `temporal.config`, les potentiels avant/après reset,
le soutien brut, la charge, les émissions et les raisons de reset.
`inspect().integrators` montre aussi les sous-graphes Core et leurs compteurs.
Le journal d'une expérience conserve ce passage avec la décision réellement
exécutée et son évaluation. Il n'ajoute aucun crédit d'apprentissage.

Le budget de travail inclut deux exécutions internes par branche.
Une borne personnalisée est réservée de façon conservatrice avant de lancer
le graphe principal. Les passages incomplets sont invalidés, pas rejoués.

Les paramètres temporels sont immuables pendant une session. Modifier les
paramètres LIF ou les connexions des unités est détecté avant une action ;
une nouvelle configuration nécessite une nouvelle mémoire compilée et une
nouvelle session. La migration d'états entre révisions reste hors de ce lot.

## Limite de conception conservée dans ce témoin

Le filtrage temporel peut masquer une branche concurrente pendant sa montée
au seuil. Le cas `conflict` le montre explicitement. Les tests réussis valident
l'implémentation du protocole et la fidélité des mesures, pas la supériorité de
cette architecture ni le respect complet de tous les objectifs T0.

Cette variante reste expérimentale. Avant un usage produit, il faut examiner
un arbitrage qui distingue émission d'une proposition et participation à un
conflit, avec les mêmes mesures et sans supprimer ce premier témoin.
