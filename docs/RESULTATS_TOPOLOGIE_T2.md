# Résultats T2 : filtrer les branches dans le temps

Date : 9 septembre 2026.
Protocole : `topology-t2-branch-local-v1`.
Statut : comparaison expérimentale terminée ; aucune variante promue par défaut.

## Conclusion produit à ce stade

La dynamique temporelle élimine la mauvaise sélection provoquée par notre
perturbation brève. Elle introduit cependant un délai initial, davantage de
replis et une limite d'arbitrage lorsqu'une concurrence nouvelle apparaît.
Le reset modulé réduit les silences entre spikes, sans résoudre cette limite.

Cela ne justifie pas de remplacer T1, ni de conclure à un gain par rapport à V3
ou LangGraph. Ce résultat porte sur une mémoire manuelle et des signaux
contrôlés, pas sur une cellule de production.

La prochaine correction à examiner est la séparation entre une branche
autorisée à proposer et une branche encore silencieuse qui doit néanmoins
participer à la détection d'un conflit. Elle devra devenir une nouvelle variante
comparée à celle-ci, pas un changement opportuniste des résultats conservés.

## Reproduire

```sh
npm run experiment:topology:temporal
npm run experiment:topology:temporal -- --json
```

La première commande affiche les résultats à une seconde et un essai du
harnais complet. La sortie JSON contient les 128 runs d'activation, leurs
traces, les autres cadences, les empreintes d'entrée et les temps de calcul.

Les paramètres et les resets sont décrits dans le
[protocole T2](ACTIVATION_TOPOLOGIQUE_T2.md). Ils ont été déclarés avant cette
campagne, sans réglage après lecture de ses résultats.

## Qu'avons-nous comparé ?

8 cas, 4 cadences, 4 variantes : 128 runs. Chaque run utilise une nouvelle
session ; aucun reset entre les observations ordinaires de son histoire.
La coupure est un cas de contrôle distinct, appliqué de la même façon
aux quatre variantes.

Cadences : 0,25 s, 0,5 s, 1 s, puis répétition irrégulière
0,2 / 0,8 / 0,5 / 1,3 / 0,7 s jusqu'à la fin déclarée.
Les premiers instants et les frontières sont déterministes.
Les interruptions de mesures restent visibles, elles ne sont pas remplies.

T1 lit les chemins directement. Les trois variantes T2 ajoutent une dynamique
locale aux branches terminales. Les conditions X/Y/Z et ET/OU ne sont pas des
neurones et restent communes. Aucun apprentissage de connexion ou de confiance.

L'empreinte de chaque bande de mesures et de son résultat attendu est identique
entre variantes. La réponse attendue est utilisée seulement par le rapport,
jamais comme entrée de la mémoire. Ce n'est pas un test de généralisation.

## Lire les métriques

- Correct : une invocation sélectionnée correspond à la réponse attendue du cas.
- Incorrect : une sélection ne correspond pas, y compris une sélection pendant
  une phase où le cas demande le repli.
- Repli : aucune invocation sélectionnée par la mémoire. Ce n'est pas un succès.
- Couverture : fraction des observations ayant une sélection correcte.
  Elle n'est pas pondérée par la durée et ne doit pas être agrégée entre
  cadences comme un score produit.
- Latence : délai physique entre un début de phase déclaré et la première
  sélection attendue observée dans sa fenêtre. `null` signifie non-reconnaissance.
- Spikes : événements de seuil locaux, pas expériences ni actions.
- Nœuds : exécutions du graphe principal et des unités Core internes.

Les performances de reconnaissance sont des sélections, pas des actions
physiques réussies. Le test de raccordement au harnais est présenté séparément.

## Cas stable : vingt secondes de soutien A

À une mesure par seconde, de t=0 à t=20 inclus :

| Variante | Sélections correctes | Replis | Spikes | Nœuds exécutés | Premier choix |
| --- | --- | --- | --- | --- | --- |
| T1 | 21/21 | 0 | 0 | 168 | 0 s |
| Continu | 18/21 | 3 | 0 | 252 | 3 s |
| Spikes, reset zéro | 6/21 | 15 | 6 | 252 | 3 s |
| Spikes, reset modulé | 18/21 | 3 | 18 | 252 | 3 s |

Le passage a lieu 21 fois dans chaque variante. T1 exécute 8 nœuds par passage,
T2 en exécute 12, soit les 8 principaux plus deux unités de deux nœuds Core.
T2 livre 11 paquets par passage contre 9 pour T1. Il n'y a pas de réduction
du nombre de traversées lorsque les branches n'émettent pas.

Dans la variante à reset zéro, les premières émissions sont à 3, 6, 9 secondes.
À 4 et 5 secondes, la même observation favorable ne donne pas de proposition :
il faut recharger le potentiel. Dans la variante modulée, le résidu de 1,2
permet ici une émission à chaque seconde après la première.

### Le rôle de la cadence

Sélections correctes / observations, sur le même cas stable :

| Cadence | T1 | Continu | Reset zéro | Reset modulé |
| --- | --- | --- | --- | --- |
| 0.25 | 81/81 | 72/81 | 8/81 | 24/81 |
| 0.5 | 41/41 | 36/41 | 8/41 | 18/41 |
| 1 | 21/21 | 18/21 | 6/21 | 18/21 |
| irregular | 30/30 | 26/30 | 8/30 | 16/30 |

À 0,25 s, le reset modulé donne 24 sélections sur 81, contre 72 pour le continu.
Son égalité avec le continu à 1 s ne se généralise donc pas aux cadences testées.

Le potentiel continu retrouve la même valeur à temps physique égal pour un
soutien constant. Le premier seuil est quantifié par l'échantillonnage :
2,25 s à cadence 0,25 s, 2,5 s à cadence 0,5 s, 3 s à cadence 1 s.
Le seuil analytique est environ 2,079 s.

Les spikes ne sont détectés qu'aux instants observés, avec au plus une émission
par branche et passage. Il n'y a ni interpolation cachée d'émissions entre
mesures ni compensation du nombre de cycles sans proposition.

## Perturbations, trous et conflits

Relevé complet à cadence 1 s :

| Cas | Variante | Corrects | Incorrects | Replis | Observations |
| --- | --- | --- | --- | --- | --- |
| a-b-a | T1 | 25 | 0 | 0 | 25 |
| a-b-a | Continu | 17 | 0 | 8 | 25 |
| a-b-a | Spikes, reset zéro | 6 | 0 | 19 | 25 |
| a-b-a | Spikes, reset modulé | 16 | 0 | 9 | 25 |
| transient | T1 | 14 | 1 | 0 | 15 |
| transient | Continu | 10 | 0 | 5 | 15 |
| transient | Spikes, reset zéro | 3 | 0 | 12 | 15 |
| transient | Spikes, reset modulé | 9 | 0 | 6 | 15 |
| missing | T1 | 13 | 0 | 2 | 15 |
| missing | Continu | 8 | 0 | 7 | 15 |
| missing | Spikes, reset zéro | 3 | 0 | 12 | 15 |
| missing | Spikes, reset modulé | 8 | 0 | 7 | 15 |
| gap | T1 | 14 | 0 | 0 | 14 |
| gap | Continu | 8 | 0 | 6 | 14 |
| gap | Spikes, reset zéro | 4 | 0 | 10 | 14 |
| gap | Spikes, reset modulé | 8 | 0 | 6 | 14 |
| conflict | T1 | 11 | 0 | 4 | 15 |
| conflict | Continu | 8 | 3 | 4 | 15 |
| conflict | Spikes, reset zéro | 2 | 1 | 12 | 15 |
| conflict | Spikes, reset modulé | 8 | 3 | 4 | 15 |
| cut | T1 | 0 | 0 | 15 | 15 |
| cut | Continu | 0 | 0 | 15 | 15 |
| cut | Spikes, reset zéro | 0 | 0 | 15 | 15 |
| cut | Spikes, reset modulé | 0 | 0 | 15 | 15 |
| misleading | T1 | 0 | 15 | 0 | 15 |
| misleading | Continu | 0 | 12 | 3 | 15 |
| misleading | Spikes, reset zéro | 0 | 4 | 11 | 15 |
| misleading | Spikes, reset modulé | 0 | 12 | 3 | 15 |

### Ce que le filtre apporte

Sur `transient`, les indices passent brièvement vers B pendant 0,5 s alors
que la route attendue reste A. T1 sélectionne B sur une observation.
Les variantes T2 n'ont pas le temps d'accumuler suffisamment de soutien pour B :
aucune sélection incorrecte, mais davantage de replis.

Sur `a-b-a`, le continu reconnaît le premier A après 3 s, B après 3 s,
puis le retour A après 2 s. Le potentiel résiduel est réellement resté en
session ; la fiabilité de la branche n'a pas été modifiée.
Ce petit gain de retour n'efface pas les retards introduits par rapport à T1.

### La limite mise en évidence

Dans `conflict`, A est établi, puis X, Y et Z deviennent simultanément forts
pendant quatre secondes. Le cas demande alors un repli. T1 voit immédiatement
les deux propositions et s'abstient.

En T2, la branche B doit d'abord accumuler du potentiel. Tant qu'elle n'émet
pas, l'arbitrage ne la voit pas, alors que la branche A peut déjà proposer.
Le continu et le reset modulé produisent chacun trois sélections incorrectes ;
le reset zéro en produit une, avec beaucoup plus de replis.

Les garde-fous d'exécution continuent de fonctionner, mais ils ne corrigent
pas magiquement cette erreur de reconnaissance. T2 ne satisfait donc pas
encore l'objectif général « une concurrence pertinente ne doit pas être
masquée ». La mécanique de propagation fonctionne selon son protocole ;
son placement avant l'arbitrage reste à revoir.

### Ce que la persistance ne peut pas résoudre

Sur `misleading`, les mesures sont durablement identiques à celles de A,
mais le cas attend B. Toutes les variantes finissent par se tromper lorsqu'elles
sélectionnent une action. Le reset zéro se trompe moins souvent uniquement
parce qu'il s'abstient davantage, pas parce qu'il aurait reconnu B.

Une observation persistante n'est pas nécessairement une observation vraie.
Il faudra les effets réels, l'attribution et éventuellement un diagnostic pour
réviser ces connaissances. Ce sera un autre lot, pas une propriété démontrée
par ces intégrateurs.

## Temps de calcul : instrumentation, pas classement

Un relevé local, cas stable à cadence 1 s, en millisecondes par décision :

| Variante | Médiane | P95 |
| --- | --- | --- |
| T1 | 0.351 | 0.808 |
| Continu | 0.461 | 0.837 |
| Spikes, reset zéro | 0.416 | 0.667 |
| Spikes, reset modulé | 0.419 | 0.807 |

Le chronomètre couvre activation et arbitrage, y compris contrôles de projection
et copies de provenance. Il exclut construction du graphe, génération du cas,
journal du harnais, fournisseur de raisonnement et action externe.

Cette campagne utilise un ordre fixe, sans protocole d'échauffement ou répétitions
CPU indépendantes. Ces temps ne permettent pas de classer les architectures.
Le nombre de spikes n'est pas une approximation du temps CPU.

## Raccordement au harnais complet

Sur onze observations stables, le sample exécute une route proposée ou `hold`
en repli, toujours via les contrôles du harnais :

| Variante | Décisions | Actions exécutées | Rejeux mémoire | Replis | Spikes | Expériences |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 11 | 11 | 11 | 0 | 0 | 11 |
| Continu | 11 | 11 | 8 | 3 | 0 | 11 |
| Reset zéro | 11 | 11 | 3 | 8 | 3 | 11 |
| Reset modulé | 11 | 11 | 8 | 3 | 8 | 11 |

La présence de plus de spikes dans la dernière ligne ne crée aucune action
supplémentaire. Le fournisseur de repli est déterministe, sans LLM.

Les tests couvrent aussi le refus d'un garde, le refus d'approbation,
l'expiration pendant l'approbation et la modification d'un neurone avant
l'action. Aucun de ces refus ne produit une nouvelle expérience exécutée.
Le reset d'activation conserve les expériences et efface les potentiels.

## État livré

- 256 tests passent, dont 31 ajoutés pour T2 et son banc.
- Compilation et test du bundle réussis.
- 28 passages T1 vérifiés identiques par empreinte.
- 252 résultats historiques de signaux V3 toujours identiques.
- 128 résultats T2 conservés par une empreinte excluant les temps CPU.
- Aucune dépendance ajoutée, aucun changement de défaut V3 ou de démo navigateur.

Empreinte de la campagne T2 : `29ef8875967908657ee700d4c0afe0f6c11c8ccc3e5bdad7a5f277c4f0187308`.
Elle préserve ce premier témoin, pas une promesse de résultats universels.

T2 est livré comme comparateur explicite. Avant T3, il faut traiter la
concurrence des branches silencieuses, puis refaire les mêmes mesures en
conservant ce témoin. L'apprentissage ne doit pas consolider des attributions
biaisées par cette erreur d'arbitrage.
