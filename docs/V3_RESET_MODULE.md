# V3 : variante de spikes à reset modulé

## Statut et comparaison préservée

La variante `harness-v3-spikes-modulated` s'ajoute aux témoins. Elle ne remplace
ni `harness-v3-spikes`, ni le continu, ni la V3 consolidée. Aucun seuil de
consolidation ou de reconnaissance, aucune durée d'activation, aucune règle
de récompense n'est modifié.

Les résultats antérieurs restent dans [la campagne initiale](RESULTATS_PROPAGATION_V3.md).
Les nouveaux rapports ont des noms distincts et ne les écrasent pas.

Le test de référence `temporal-signals-baseline.json` contient une empreinte
calculée depuis le rapport antérieur à cette modification, pas depuis le nouveau
code. Les 252 anciens parcours reproduisent exactement leurs traces, mesures et
compteurs, hors temps mural. Le test est rejouable sans les rapports locaux.
Avec `alpha = 0`, les 84 parcours de la nouvelle variante reproduisent également
le reset à zéro, y compris les compteurs de propagation.

## Seule modification : le potentiel après un spike

```text
Avant le premier spike :
    même intégration, même fuite, même seuil que le témoin.

Après chaque spike :
    V_après = seuil * alpha * indice_actuel
    alpha = 0,8 pour ce premier essai
```

L'indice actuel est exactement le débit `r` déjà calculé par l'observateur :

```text
proximité = max(0, 1 - d1 / distanceMax)
séparation = min(1, max(0, d2 - d1) / margeMin)
indice_actuel = proximité * séparation
```

Il est normalisé entre 0 et 1, mais ce n'est pas une probabilité calibrée.
Ce n'est ni la confiance historique d'une action, ni son taux de réussite,
ni une valeur augmentée par les spikes précédents.

Un indice à 0,6, avec le seuil inchangé de 1,5, conserve donc un potentiel
de 0,72 après émission. Le neurone doit encore recevoir des indices pour
émettre à nouveau. La fuite continue d'atténuer ce potentiel.

Le coefficient est un paramètre de l'expérience, pas une confiance durable.
Il est fixé avant la campagne, sans recherche du meilleur réglage sur les
résultats. Il peut être remplacé pour un autre essai explicite, jamais injecté
silencieusement dans les variantes témoins.


## Pourquoi davantage de spikes ?

Un spike est une notification interne du neurone, pas une nouvelle observation,
une nouvelle expérience ou une commande envoyée à la machine. Il indique que
l'accumulation d'indices vient de franchir le seuil.

Avec le reset à zéro, chaque émission efface le potentiel : les observations
suivantes doivent reconstruire toute l'accumulation. Avec le reset modulé, une
partie du potentiel reste dans la session. Sous un indice persistant, le seuil
suivant peut donc être atteint plus tôt. La première émission reste identique.

Exemple exécuté avec le réseau réel, indice constant de 0,6, observations chaque
seconde, seuil 1,5 et constante de fuite de 3 secondes :

| Variante | Potentiel après émission | Instants des spikes sur 25 secondes |
| --- | ---: | --- |
| Reset à zéro | 0 | 6, 12, 18, 24 s |
| Reset modulé | 0,72 | 6, 10, 14, 18, 22 s |

Il ne s'agit pas de créer plus d'information. On répète plus fréquemment une
notification de soutien pour le même régime, à partir des observations reçues.

Dans ce harnais, chaque spike rafraîchit une activation temporaire valable
3 secondes. Quand les spikes sont trop espacés, cette activation expire même
si les indices persistent. Le système peut alors devoir rappeler le raisonneur.
Rapprocher les spikes réduit ces trous. Le rejeu reste soumis aux autres
conditions : indice actuel, branche apprise, confiance d'action et garde-fous.

Le nombre de commandes de la machine ne suit pas celui des spikes : les campagnes
de production gardent 600 cycles de décision par scénario. Sur les dix scénarios,
les deux variantes à spikes comptent chacune 5 849 actions exécutées pour
6 000 cycles. L'activation ne renforce pas, à elle seule, la confiance historique
d'une branche.

Il faut distinguer le cycle de décision complet et les événements de son
sous-graphe d'observation. Une observation du monde lance un cycle du harnais.
Dans ce cycle, le sous-graphe temporel peut émettre ou non. Son spike termine
dans un nœud de lecture qui actualise l'activation du régime ; il ne relance
ni `runtime.step`, ni une recherche de solution, ni une commande supplémentaire.

Les 165 et 342 spikes sont des sommes sur des observations successives, pas
des nombres d'essais nécessaires pour résoudre une même expérience. Les deux
variantes exécutent chacune 6 000 graphes de décision dans la campagne principale.
La différence de 177 exécutions dans le sous-graphe correspond aux lectures
supplémentaires des notifications.

Ce montage n'est donc pas encore un harnais dont toute l'inférence se propage
par spikes entre les branches. C'est un harnais à graphe de décision classique,
avec un sous-graphe temporel à spikes pour rendre les régimes éligibles au rejeu.
La répétition des spikes renouvelle ici une activation à durée limitée :
ce choix de lecture explique le gain, ce n'est pas une nécessité de toute
architecture à spikes.

C'est donc un compromis entre continuité d'activation et trafic interne. Cela
ne prouve pas une meilleure reconnaissance du régime, ni une accélération du
harnais. Le raisonneur de ce banc est une fonction de référence déterministe,
pas un LLM facturé à l'appel.

## Implémentation et état dans les sessions

`ModulatedResetLif` hérite du LIF instrumenté, lui-même dérivé du
`LifNeuronNode` du Core. Il laisse le Core intégrer et émettre, puis remplace
uniquement le potentiel de la session après une émission effective.

Il ne change jamais la propriété partagée `resetPotential` du nœud.
Le coefficient appartient au modèle ; l'indice et le potentiel résiduel
appartiennent à `INodeState`.

L'indice voyage dans le même jeton que l'entrée d'intégration. Il est vérifié
avant consommation : valeur finie, comprise entre 0 et 1, observation datée
du pas courant. Le réseau ne reçoit pas de fiabilité d'action ni d'état caché
du simulateur pour calculer le reset.

Deux sessions utilisant la même définition de neurone peuvent conserver deux
potentiels différents sans se contaminer. Un reset de session réinitialise
aussi les champs de modulation.

Les graphes utilisent toujours `RuntimeGraphBuilder` et l'ordonnanceur du
Core. Aucun `runStage` n'est ajouté. Les samples restent hors de la bibliothèque
générique. Aucune dépendance n'est ajoutée.

## Invariants conservés

- Même première émission : le reset ne peut pas avancer le premier franchissement.
- Aucun spike autonome sans entrée positive ; le potentiel résiduel continue de fuir.
- Aucun rejeu sans indice courant positif et activation encore valide.
- Changement de candidat, trou temporel, manque d'observation et nouveauté
  invalident l'activation comme auparavant.
- Une branche durable n'est pas supprimée ou pénalisée par ces resets.
- Les contrôles de fraîcheur ne réintègrent pas l'indice.
- Les capacités et les garde-fous restent obligatoires après activation.
- Le snapshot des variantes temporelles reste diagnostique, sans contrat
  d'import de session ou d'observateur.

## Protocole de mesure

Les mêmes sept profils de signaux, quatre cadences et trois graines sont utilisés.
Le banc contient désormais 336 parcours : les 252 précédents et 84 pour la
modulation. Les répétitions déterministes ne sont pas des phénomènes nouveaux.

La cellule de production est mesurée sur les dix familles avec la graine 101,
puis sur `cooling-drift` et `delayed-actuator` avec la graine 211.
Ces deux familles avaient été identifiées lors de l'expérience précédente.
Elles ne constituent donc pas une évaluation de généralisation indépendante.

Le cas `delayed-actuator`, graine 101, est aussi rejoué pour les témoins
continu et reset à zéro afin de vérifier leur comportement après la modification.
Les comparaisons complètes avec les campagnes précédentes sont appariées sur
le contrat, les cas, les entrées exogènes et le raisonneur. Les nouvelles
empreintes de code sont conservées ; elles ne sont pas présentées comme
identiques à celles du code antérieur.

On mesure conjointement : production, violations, énergie, attente, appels au
raisonneur, continuité d'activation, erreurs, délai, spikes et nœuds exécutés.
La baisse des interruptions ne suffit pas si elle crée davantage d'erreurs
ou un coût supérieur sans intérêt produit.

## Exécution

```sh
npm run experiment:temporal -- --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-spikes-modulated --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-spikes-modulated --split regression --seed 211 --scenario delayed-actuator --out dist/benchmarks
```

En code, la configuration spécifique est `{ alpha: 0.8 }`, passée comme
`resetModulation` au contrôleur de production. Les autres variantes refusent
une modulation dans le réseau temporel plutôt que de l'appliquer implicitement.

## Résultats mesurés

Campagne du 9 septembre 2026, alpha fixé à 0,8 avant l'exécution.

### Cellule de production, dix scénarios, graine 101

Sommes sur 6 000 décisions. Les événements et exécutions de nœuds ci-dessous
concernent le sous-graphe temporel, pas le graphe complet du harnais.

| Variante | Appels au raisonneur | Rejeux mémoire | Événements de sortie temporels | Exécutions de nœuds temporels |
| --- | ---: | ---: | ---: | ---: |
| V3 consolidée | 2 582 | 3 418 | Sans sous-graphe temporel | Sans sous-graphe temporel |
| V3 continue | 1 983 | 4 017 | 1 796 valeurs | 5 388 |
| V3 spikes, reset à zéro | 2 112 | 3 888 | 165 spikes | 3 757 |
| V3 spikes, reset modulé | 1 984 | 4 016 | 342 spikes | 3 934 |

Les trois variantes temporelles reçoivent chacune 1 796 événements d'entrée.
Le reset modulé évite 128 appels par rapport au reset à zéro, au prix de
177 notifications et exécutions de lecture supplémentaires. Il reste un appel
au-dessus du continu, tout en produisant moins d'événements de sortie.

Les écarts de métriques physiques sont exactement nuls, cas par cas, entre
la variante modulée et chacune des trois autres V3 de ce tableau. Les six cas
de service restent dans l'enveloppe candidate ; les quatre cas de stress restent
en dehors. Le reset ne corrige donc pas les limites physiques du contrôleur.

La V2 historique reste à 1 310 appels sur cette campagne. Ce nouvel essai ne
permet pas d'annoncer que la V3 la dépasse.

### Régression ciblée, graine 211

| Scénario | Continu | Reset à zéro | Reset modulé |
| --- | ---: | ---: | ---: |
| Refroidissement dégradé | 102 appels | 110 appels | 104 appels |
| Actionneur retardé | 48 appels | 186 appels | 49 appels |

Les métriques physiques restent identiques aux deux témoins pour chaque cas.
Le gain du reset modulé sur les interruptions est surtout visible sur
l'actionneur retardé ; le continu conserve un léger avantage en appels.

### Signaux contrôlés

Sommes sur 84 parcours par variante, soit 4 200 secondes évaluées. Les durées
ne sont pas celles d'une unique session. Chaque famille est répétée sur quatre
cadences et trois graines ; seule la famille d'indices faibles utilise un bruit
dépendant de la graine.

| Variante temporelle | Activation correcte | Activation erronée | Abstention | Événements de sortie |
| --- | ---: | ---: | ---: | ---: |
| Continue | 3 326,25 s | 444,75 s | 429 s | 18 582 valeurs |
| Reset à zéro | 3 093 s | 444,75 s | 662,25 s | 1 467 spikes |
| Reset modulé | 3 216,75 s | 444,75 s | 538,5 s | 3 728 spikes |

Sur les seuls indices faibles bruités, l'abstention passe de 233,25 à
109,5 secondes cumulées. Le continu reste à zéro sur ce profil.
Les premiers déclenchements et les activations erronées restent inchangés.
Un indice trompeur persistant trompe toujours les trois variantes : émettre
plus souvent ne remplace pas une meilleure observation.

### Portée du résultat

Cette variante améliore la continuité après émission. Elle n'améliore pas
la qualité des capteurs ou la reconnaissance initiale, et ne mérite pas encore
de devenir le réglage par défaut. Les temps muraux restent disponibles dans
les rapports, mais ces campagnes séparées ne suffisent pas à conclure à un
gain CPU. Il faudrait aussi varier les phénomènes et les paramètres hors de
ce banc avant toute conclusion sur la généralisation.

## Vérifications et rapports

- `npm test` : 195 tests réussis.
- `npm run test:bundle` : test du bundle réussi.
- 252 parcours historiques identiques hors temps mural, vérifiés par empreinte.
- Alpha nul : égalité des traces, métriques et compteurs sur 84 parcours.
- Rejeux frais de l'actionneur retardé, graine 101 : 172 appels pour le témoin
  à zéro, 46 pour le continu. Tous les diagnostics du contrôleur et les métriques
  physiques sont identiques à leurs campagnes antérieures.
- Tous les nouveaux parcours de production sont terminés, sans erreur de
  contrôleur. Cela ne signifie pas que tous respectent l'enveloppe de service.

Les rapports JSON sont locaux, dans `dist/benchmarks`, un répertoire ignoré
par Git. Cette note conserve les résultats synthétiques ; la référence des
252 parcours est suivie dans les fixtures des tests.

- [Signaux contrôlés, 336 parcours](../dist/benchmarks/temporal-signals-1788961080709-1c0742ff-7f09-48e7-9f2d-38a53f9c051b.json).
- [Reset modulé, dix scénarios](../dist/benchmarks/harness-v3-spikes-modulated-development-1788961316478-3067711c-0a7c-44f9-994a-fe6ddde795e4.json).
- [Reset modulé, refroidissement, graine 211](../dist/benchmarks/harness-v3-spikes-modulated-regression-1788961338869-93226b36-0717-40af-9000-7e4f4c0c49a8.json).
- [Reset modulé, actionneur, graine 211](../dist/benchmarks/harness-v3-spikes-modulated-regression-1788961362243-9f8aebfc-852f-4323-8f6c-db7d4a8d5dd0.json).
- [Rejeu témoin à zéro, actionneur, graine 101](../dist/benchmarks/harness-v3-spikes-development-1788961385041-d395b8f0-5323-4acc-b252-a5a41cd1f820.json).
- [Rejeu témoin continu, actionneur, graine 101](../dist/benchmarks/harness-v3-continuous-development-1788961407826-727ca920-cd4d-4288-bc2c-57b98f9d1745.json).

Les références complètes antérieures restent dans
[les résultats de la première comparaison](RESULTATS_PROPAGATION_V3.md).
