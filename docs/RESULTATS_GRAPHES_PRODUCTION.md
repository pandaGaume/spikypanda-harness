# Premiers résultats avec les graphes réels

9 septembre 2026. Banc `production-cell@0.2.0`, développement, graine 101.
Dix familles par contrôleur, 600 secondes simulées par cas.
Ce relevé remplace l'essai de simple admission pour le raccordement SpikyPanda,
pas une qualification produit ni une preuve de généralisation.

## Exécution vérifiée

Sept contrôleurs, 70 parcours terminés sans erreur d'adaptateur, soit 42 000
intervalles simulés. Parmi eux, les cinq variantes SpikyPanda totalisent
30 000 exécutions du véritable graphe core.

- 136 tests du dépôt passent, dont 22 tests du banc et 25 de raccordement.
- Les dix tests optionnels LangGraph passent, ainsi que le test de bundle.
- Les règles directes, LangGraph à un nœud et notre graphe à raisonnement
  systématique produisent les mêmes trajectoires physiques sur les dix familles.
- V2 et V3 en observation seule produisent les mêmes métriques physiques
  et les mêmes compteurs de décision, cas par cas.
- Chaque parcours SpikyPanda comporte 600 passages par exécution, observation
  après action, évaluation et enregistrement. Un passage par enregistrement
  peut ignorer une expérience non attribuable, sans supprimer sa trace physique.

Ces contrôles établissent que le graphe pilote réellement le monde et reçoit
ses résultats. Les chiffres d'apprentissage ne viennent pas d'un compteur simulé.

## Relevé agrégé sur les dix cas

Sommes, pas score pondéré. Chaque contrôleur est évalué sur les mêmes 6 000
secondes simulées. Les appels indiqués sont ceux du raisonneur déterministe,
pas des appels LLM ; `n/a` désigne les témoins sans mécanisme de repli.

| Contrôleur | Appels au raisonneur | Replays de mémoire | Pièces conformes | Attente (pièces·s) | Énergie (kWh) |
| --- | --- | --- | --- | --- | --- |
| reference | n/a | n/a | 4684.36 | 59026 | 0.8858 |
| langgraph | n/a | n/a | 4684.36 | 59026 | 0.8858 |
| harness-fallback | 6000 | 0 | 4684.36 | 59026 | 0.8858 |
| harness-v1 | 1203 | 4797 | 4685.99 | 56859 | 0.9409 |
| harness-v2 | 1310 | 4690 | 4685.99 | 57104 | 0.9274 |
| harness-v3-shadow | 1310 | 4690 | 4685.99 | 57104 | 0.9274 |
| harness-v3-active | 5202 | 798 | 4685.99 | 57636 | 0.9128 |

Tous respectent l'enveloppe candidate dans les mêmes six cas de service.
Tous accumulent aussi 198 secondes de dépassement thermique et 668 secondes
de dépassement de file sur les cas de stress. Leur union est de 719 secondes,
car certains dépassements sont simultanés. Ces résultats ne prouvent pas
qu'une architecture résout les situations difficiles.

Par rapport au graphe à raisonnement systématique :

- V1 réduit les appels de 79,95 %.
- V2 et V3 en observation seule les réduisent de 78,17 %.
- V3 active les réduit de 13,30 % seulement.

Ces réductions ne sont pas des économies monétaires mesurées. Le repli est
une fonction très peu coûteuse. Il faut mesurer un fournisseur réel avant
de parler d'économie de tokens ou de gain de latence global.

V1 réduit l'attente cumulée d'environ 3,67 %, mais consomme environ 6,22 %
d'énergie de plus que la référence. V2 donne environ -3,26 % d'attente et
+4,70 % d'énergie. Le gain total de production est d'environ 1,63 pièce
équivalente sur plus de 4 684. Il n'y a donc pas de victoire produit évidente.

Le signal local d'apprentissage ne pénalise pas directement la consommation :
il évalue température mesurée, qualité, flux et refroidissement protecteur.
Une action productive peut rester consolidée tout en consommant davantage.
Les métriques physiques séparées rendent cet arbitrage visible.

## Pourquoi le nominal est instructif

Sur le cas nominal de 600 pas :

| Variante | Appels au raisonneur | Replays | Hypothèses de fonctionnement en mémoire |
| --- | --- | --- | --- |
| V1 | 7 | 593 | Sans modèle de fonctionnement. |
| V2 | 8 | 592 | 3 |
| V3 observation seule | 8 | 592 | 3 |
| V3 active | 596 | 4 | 3 |

Il n'y a pourtant aucune panne dans ce scénario. Un contrôle ciblé des 35
premiers pas explique les trois hypothèses produites par notre encodeur de sample :

| Hypothèse | Confirmation | Indice arrondi vitesse / consigne | Indice courant / consigne | Indice débit / ventilation |
| --- | --- | --- | --- | --- |
| M1 | 3 s | 2 | 2 | 4 |
| M2 | 5 s | 3 | 2 | 4 |
| M3 | 11 s | 4 | 2 | 4 |

Ce sont des indices de classes arrondies, pas des vitesses physiques.
L'inertie de démarrage fait passer le rapport vitesse/consigne entre ces classes.
L'encodeur de réponses distingue donc des phases transitoires comme autant
d'hypothèses, sans que le fonctionnement du simulateur ait changé.

À 35 pas, l'observateur est `ambiguous`, avec une couverture de 1.
Les deux meilleurs candidats sont proches : distances d'environ 0,035 et 0,123,
soit une marge de 0,088, inférieure au seuil configuré de 0,20. Il refuse donc
de choisir par les indices et renvoie au raisonneur.

La chronologie échantillonnée du parcours complet montre aussi cette ambiguïté.
Ce n'est pas une statistique exhaustive des 600 statuts : le rapport sans
`--traces` ne conserve qu'une chronologie sélectionnée. En revanche, les 596
appels et les 4 replays sont comptés sur tout le parcours.

La limite concerne le couple « signature de réponse du sample + observateur ».
Elle ne suffit pas à condamner tout observateur, ni à déclarer la V3 meilleure.
Il faut distinguer dynamique transitoire, fonctionnement durable et contexte
d'utilité, sans simplement réduire les seuils pour gagner ce scénario.

## Coût observé, pas classement des moteurs

Au nominal, le p95 de la boucle de contrôle est d'environ 1,12 ms en V1,
1,37 ms en V2, 73,94 ms en V3 observation seule et 66,98 ms en V3 active.
Ces durées comprennent le travail avant et après l'action, hors simulation.

Ces mesures sont diagnostiques : une partie de la campagne a coïncidé avec
des tests et des compilations, sans répétitions ni ordre randomisé.
Elles ne constituent pas une comparaison contrôlée de moteurs.
L'observateur actuel reconstruit sa représentation depuis la mémoire et valide
de nouveau l'évaluation avant la sélection. Un profilage doit isoler ses coûts
avant toute optimisation.

La mémoire sérialisée du nominal occupe environ 1,09 Mo en V1, 3,45 Mo en V2
et 5,38 Mo en V3 active, pour 600 expériences. Ce sont des octets de JSON,
pas la mémoire résidente du processus. Les longues trajectoires et la rétention
des expériences restent un sujet produit.

## Rapports et reproduction

Les rapports locaux sont ignorés par Git, jamais écrasés :
- [reference](../dist/benchmarks/reference-development-1788953139208-5ef7563b-02bf-4726-98e6-73da0b2bb21f.json)
- [langgraph](../dist/benchmarks/langgraph-development-1788953150670-844d5a03-3b8e-4cd5-8b46-36d50e43bf9d.json)
- [harness-fallback](../dist/benchmarks/harness-fallback-development-1788953154013-bd667e80-71be-4e00-be1d-86304837de50.json)
- [harness-v1](../dist/benchmarks/harness-v1-development-1788953158168-50021462-5b5e-44a9-9cfa-744c7043d4c0.json)
- [harness-v2](../dist/benchmarks/harness-v2-development-1788953164029-a5c2a417-42e0-47db-8760-f9edc4ab9c4a.json)
- [harness-v3-shadow](../dist/benchmarks/harness-v3-shadow-development-1788953433200-ed6c582d-ed6c-4085-8739-84ad54d48718.json)
- [harness-v3-active](../dist/benchmarks/harness-v3-active-development-1788953641024-589fe1f8-1e95-4663-9aa0-0e6049a5b643.json)

Pour reproduire une variante :

```sh
npm run benchmark:production -- --controller harness-v2 --seed 101 --out dist/benchmarks
```

Pour comparer deux rapports, fournir leurs chemins réels :

```sh
npm run benchmark:compare -- chemin/rapport-reference.json chemin/rapport-harnais.json
```

La comparaison exige les mêmes cas et les mêmes empreintes de protocole.
Elle garde les échecs, signale les métriques absentes et affiche les différences
droite moins gauche, avec médiane et extrêmes. Elle ne choisit pas un gagnant.

## Ce que l'on peut décider maintenant

Le raccordement est opérationnel. La mémoire modifie réellement les décisions
et réduit le recours au raisonneur sur ce corpus, avec des arbitrages de service
et de consommation. L'observateur actif n'apporte pas ici l'avantage attendu.

La prochaine question utile est la représentation des phénomènes dans le temps,
en particulier le démarrage et les changements persistants, puis sa validation
sur des variations réservées. Les paramètres de ce relevé n'ont pas été retouchés
pour embellir les résultats.

Une seule graine par famille ne permet ni d'établir la robustesse, ni de décider
d'abandonner ou de conserver le produit. Le concurrent LangGraph n'a encore
ni mémoire adaptative ni configuration produit comparable. Les critères métier,
le fournisseur LLM et le transfert à un autre système restent à qualifier.

Voir le [raccordement](RACCORDEMENT_GRAPHES_PRODUCTION.md) et la
[note sur la généralisation](GENERALISATION_ET_BANCS.md).
