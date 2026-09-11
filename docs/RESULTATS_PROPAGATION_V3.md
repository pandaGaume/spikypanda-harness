# Résultats : intégration continue et spikes sur V3

9 septembre 2026. Paramètres conservés sans ajustement après lecture des résultats.
Voir [l'algorithme et le protocole](V3_PROPAGATION_TEMPORELLE.md).

## Verdict de la première campagne

L'intégration temporelle réduit les appels au raisonneur dans deux scénarios
de production. Les spikes réduisent les événements propagés en sortie, mais
dégradent la continuité de l'activation lorsque les indices sont faibles.

Pour poursuivre le travail produit, le continu est donc le meilleur candidat
des deux sur ces mesures. Les spikes restent un comparateur expérimental :
ils ne justifient pas de remplacer le harnais ou de changer son défaut.
La V2 reste meilleure en nombre d'appels au raisonneur sur cette campagne.

## Production, dix familles et une graine commune

`production-cell@0.2.0`, contrat 2, métriques 2. Dix familles, graine 101,
600 pas par cas : 6000 décisions par variante, 24 000 au total.

Les quatre campagnes ont été rejouées pour cette expérience. Tous les cas
ont terminé. Les empreintes de sources exécutables et d'adaptateur des trois
V3 sont identiques : seule la variante sélectionnée change. La comparaison
automatique valide dix paires de cas et de trajectoires exogènes communes.

| Mesure cumulée | V2 | V3 consolidée | V3 continue | V3 spikes |
| --- | ---: | ---: | ---: | ---: |
| Appels au raisonneur | 1310 | 2582 | 1983 | 2112 |
| Réutilisations de mémoire | 4690 | 3418 | 4017 | 3888 |
| Régimes créés, somme des mémoires indépendantes | 140 | 60 | 60 | 60 |
| Pièces conformes équivalentes | 4685,99 | 4684,36 | 4684,36 | 4684,36 |
| Attente cumulée, pièces·s | 57104,07 | 57921,51 | 57921,51 | 57921,51 |
| Énergie, kWh | 0,92744 | 0,90585 | 0,90585 | 0,90585 |
| Violation de contraintes, s | 719 | 719 | 719 | 719 |

Les trois V3 ont exactement les mêmes valeurs pour toutes les métriques
physiques appariées, pas seulement après arrondi. Six cas de service passent
l'enveloppe candidate ; quatre cas de stress ne la passent pas.

Le continu économise 599 recours au raisonneur par rapport à la V3 consolidée.
Les spikes en économisent 470, mais en demandent 129 de plus que le continu.
Il s'agit d'appels à un raisonneur local déterministe, pas d'économies de tokens
ou de temps LLM mesurées.

### Localisation du gain

| Scénario | V3 consolidée | Continu | Spikes |
| --- | ---: | ---: | ---: |
| `cooling-drift` : appels au raisonneur | 248 | 117 | 120 |
| `delayed-actuator` : appels au raisonneur | 514 | 46 | 172 |

Les huit autres familles ne montrent pas de gain avec ces réglages.
Aucun graphe temporel n'y est exécuté : la métrique ne présente pas les
candidats exploitables requis, ou reste sur son chemin d'historique des effets.
Ce n'est donc pas une amélioration générale de la reconnaissance des pannes.

### Événements et coût

| Travail mesuré dans les sous-graphes temporels | Continu | Spikes |
| --- | ---: | ---: |
| Événements d'entrée | 1796 | 1796 |
| Événements de sortie | 1796 | 165 |
| Exécutions de nœuds | 5388 | 3757 |

Les spikes diminuent les sorties d'environ 90,8 % et les exécutions de nœuds
temporels d'environ 30,3 %. Les sources et intégrateurs travaillent toujours :
ce n'est pas une réduction équivalente de tout le calcul du contrôleur.
Les lecteurs sont moins sollicités parce qu'ils ne reçoivent que les spikes.

La médiane des p95 par cas est de 70,29 ms pour la V3 consolidée, 71,13 ms
pour le continu et 68,10 ms pour les spikes. Ces valeurs ne constituent pas
un classement fiable : une seule répétition, ordre de passage fixe, machine
non isolée et quelques tests courts pendant la campagne. La reconstruction
de la métrique et la copie des historiques restent présentes dans les trois
variantes. Aucun gain global de vitesse n'est revendiqué.

Les volumes JSON de mémoire, additionnés sur dix mémoires indépendantes,
sont respectivement 45 996 923, 48 190 890 et 48 091 811 octets pour les trois V3.
Ce sont des exports avec traces, pas une mesure de mémoire RAM résidente.
Leur légère augmentation provient notamment des diagnostics temporels.

## Banc de signaux contrôlés

`temporal-evidence-signals@0.1.0`. Sept profils, quatre cadences et trois
graines, 252 parcours dont les répétitions déterministes sont explicitement
signalées dans le protocole. Ce banc isole la propagation ; il ne remplace pas
le banc de production et n'entraîne pas la métrique adaptative.

- Impulsion brève : aucune activation erronée dans les deux variantes
  temporelles sur ces parcours, contre 15 secondes cumulées pour le seuil
  instantané. Ce filtrage coûte des périodes d'abstention.
- Bascule persistante : même délai pour continu et spikes, de 2,25 à 4 secondes
  suivant la cadence, contre zéro délai pour le seuil instantané sur ce profil
  fortement informatif.
- Dérive lente du score : activation après 9 à 10 secondes pour les variantes
  temporelles, contre 12 secondes pour le seuil instantané choisi.
- Retour A-B-A : les deux transitions sont détectées, avec un délai temporel
  renouvelé. Une activation n'est pas conservée indéfiniment après le départ
  d'un régime.
- Indice faible bruité : 600 secondes cumulées d'activation correcte pour le
  continu, 366,75 pour les spikes. Les 233,25 secondes restantes sont des
  abstentions dues à l'expiration entre deux spikes, pas des erreurs de mode.
- Indice durablement trompeur : les deux variantes produisent encore des
  activations erronées. Attendre ne répare pas un indice mal associé.

Les sorties passent de 18 582 événements continus à 1467 spikes sur ce banc.
Ces compteurs ne doivent pas être mélangés avec ceux de la cellule de production.

## Ce que nous conservons

- La consolidation et la plasticité des expériences ne changent pas.
- Les nœuds LIF et les graphes sont ceux du Core, sans nouvelle dépendance.
- Toute la mémoire temporelle mutable est dans les sessions.
- Un reset de session invalide les activations et le cache, pas les connaissances.
- Le chemin d'autorisation et les garde-fous restent obligatoires.
- Le continu sert de candidat pour la suite ; les spikes restent disponibles.
- Pas de promotion sur la seule baisse du nombre d'événements.
- Pas de revendication de généralisation, ni de supériorité sur LangGraph.
- L'import des nouveaux observateurs est hors de cette expérience ; leur export
  est explicitement diagnostique. La démo navigateur n'a pas été modifiée.

## Contre-vérification ciblée, graine 211

Après lecture de la campagne de développement, les deux familles présentant
un gain ont été rejouées avec une autre graine, sans changer de paramètre.
L'ordre des variantes a été inversé. Huit parcours supplémentaires ont terminé,
soit 4800 décisions.

| Appels au raisonneur | V2 | V3 consolidée | Continu | Spikes |
| --- | ---: | ---: | ---: | ---: |
| `cooling-drift`, graine 211 | 20 | 352 | 102 | 110 |
| `delayed-actuator`, graine 211 | 12 | 517 | 48 | 186 |

Les métriques physiques appariées sont identiques entre les quatre variantes
sur ces deux cas. Le classement en recours au raisonneur se reproduit.
Cela renforce le constat local, sans être une évaluation indépendante de
généralisation : les familles ont été choisies après observation du gain.

Rapports :

- [Refroidissement, V2](../dist/benchmarks/harness-v2-regression-1788960329105-01f9576f-7ea8-4531-b0cb-8947b9ba5996.json)
- [Refroidissement, V3 consolidée](../dist/benchmarks/harness-v3-consolidated-regression-1788960328069-1a9b08fa-2cb1-45bd-8f13-2a190f40c9fb.json)
- [Refroidissement, continu](../dist/benchmarks/harness-v3-continuous-regression-1788960307063-0bd5b413-2f0e-4cfe-92a0-a1567598c479.json)
- [Refroidissement, spikes](../dist/benchmarks/harness-v3-spikes-regression-1788960284436-1472dab5-270a-4446-9b49-169ad74cefd8.json)
- [Actionneur, V2](../dist/benchmarks/harness-v2-regression-1788960396882-fab47320-ed2f-42e5-81a3-a39d9a79a368.json)
- [Actionneur, V3 consolidée](../dist/benchmarks/harness-v3-consolidated-regression-1788960395818-dde96db9-b1e4-4c31-880e-cb954e398c5a.json)
- [Actionneur, continu](../dist/benchmarks/harness-v3-continuous-regression-1788960374386-6a5802f5-6b88-4e92-8a92-c84e3eec3e98.json)
- [Actionneur, spikes](../dist/benchmarks/harness-v3-spikes-regression-1788960351819-2cb52659-0441-4562-9f76-442b85fbc28d.json)

## Vérifications

- Compilation TypeScript réussie.
- 178 tests réussis lors du passage final de la suite complète.
- Test du bundle navigateur réussi.
- Non-régressions V2 et V3 conservées.
- Tests de durée réelle, cadences, impulsion, expiration, observations manquantes,
  horloge inversée, capacité bornée, séparation des contextes et sessions.
- Vérification que les lectures et validations répétées ne réintègrent pas l'indice.
- Partage de définition de graphe sans partage de potentiel.
- Reset de session sans changement de mémoire durable.
- Réutilisation d'une action apprise dans le graphe réel et refus de sécurité
  toujours effectif après activation temporelle.
- Contrôle des empreintes et appariement des rapports, sans écart physique entre
  les trois V3 sur la campagne principale.

## Rapports locaux

Les fichiers JSON sont ignorés par Git et peuvent être reproduits avec les
commandes du protocole.

- [V2, graine 101](../dist/benchmarks/harness-v2-development-1788959550799-b0aaaa51-acc6-49a1-b75d-894354517beb.json)
- [V3 consolidée, graine 101](../dist/benchmarks/harness-v3-consolidated-development-1788959767840-7c309d36-840d-4d7e-8bbf-a660c5f10156.json)
- [V3 continue, graine 101](../dist/benchmarks/harness-v3-continuous-development-1788959991920-d7c8026b-9748-4796-bf0b-5ce78196a46d.json)
- [V3 spikes, graine 101](../dist/benchmarks/harness-v3-spikes-development-1788960209296-fda51a21-fb44-4794-8e12-65408be74702.json)
- [Signaux contrôlés](../dist/benchmarks/temporal-signals-1788959518630-923da56f-6372-46d0-b075-550788498884.json)
