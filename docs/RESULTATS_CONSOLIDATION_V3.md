# Résultats de la consolidation temporelle V3

9 septembre 2026. `production-cell@0.2.0`, contrat 2, métriques 2.
Dix familles de développement, graine 101, 600 pas par cas.

## Bilan

La variante `harness-v3-consolidated` a terminé les dix parcours, soit 6000
décisions exécutées par les graphes réels du core. L'observateur, son encodage
et ses seuils sont inchangés. La nouvelle politique de consolidation limite
la création de régimes issus de passages transitoires.

Les témoins V2 et V3 active ci-dessous viennent de la campagne précédente du
même jour. La comparaison automatique des dix paires vérifie les identités
de cas, de suite et de trajectoires exogènes. Ce n'est pas une nouvelle mesure
comparative contrôlée de latence.

| Mesure sur les dix cas | V2 témoin | V3 active témoin | V3 consolidée |
| --- | ---: | ---: | ---: |
| Appels au raisonneur | 1310 | 5202 | 2582 |
| Réutilisations de mémoire | 4690 | 798 | 3418 |
| Régimes créés, somme des mémoires indépendantes | 140 | 143 | 60 |
| Pièces conformes équivalentes | 4685,99 | 4685,99 | 4684,36 |
| Attente cumulée, pièces·s | 57104,07 | 57636,08 | 57921,51 |
| Énergie, kWh | 0,92744 | 0,91278 | 0,90585 |
| Durée de violation de contraintes, s | 719 | 719 | 719 |

Le nouveau mécanisme réduit d'environ moitié les appels de la V3 active.
Il ne rattrape pas la V2 et ne corrige pas les dépassements des scénarios
de stress. La production est légèrement inférieure, l'attente légèrement
supérieure et l'énergie inférieure. Les six mêmes cas de service satisfont
l'enveloppe candidate ; les quatre cas de stress ne la satisfont pas.

Il n'y a pas de gain global revendiqué. Le raisonneur est encore une fonction
déterministe, pas un LLM : ces compteurs ne sont pas des économies de tokens
ou des économies financières mesurées.

## Cas nominal

| Mesure sur 600 pas | V2 | V3 active | V3 consolidée |
| --- | ---: | ---: | ---: |
| Régimes | 3 | 3 | 1 |
| Appels au raisonneur | 8 | 596 | 20 |
| Réutilisations de mémoire | 592 | 4 | 580 |

Neuf expériences de démarrage restent `transient`, 591 expériences sont
attribuées au régime consolidé. La mémoire n'assimile plus chaque phase
du démarrage à un régime durable distinct.

Attention à l'interprétation : avec un seul régime, l'observateur demeure
`learning` et la V3 utilise son chemin existant `effect-history`.
Le résultat confirme l'intérêt de filtrer l'admission en mémoire. Il ne
démontre pas une amélioration de la reconnaissance pré-action par les capteurs.

## Sensibilité à la durée

Un contrôle ciblé sur les 60 premiers pas nominaux, avec tous les autres
paramètres identiques, donne :

| Durée minimale | Régimes | Appels au raisonneur | Réutilisations |
| --- | ---: | ---: | ---: |
| 5 secondes | 2 | 59 | 1 |
| 10 secondes | 1 | 20 | 40 |

Les paliers du démarrage suffisent encore à produire deux régimes avec
l'horizon de cinq secondes. Dix secondes les filtrent ici, mais ne garantissent
pas de filtrer un démarrage plus long. La valeur du sample n'a pas été retouchée
après la campagne. Ce contrôle n'est pas une sélection de seuil sur un jeu
d'évaluation réservé.

Une représentation de trajectoire, telle que le mouvement sur fenêtre évoqué
dans le brief utilisateur, reste une étape distincte à évaluer.

## Vérifications

- Compilation TypeScript réussie.
- 154 tests du dépôt réussis, dont 15 tests dédiés à la consolidation.
- Test du bundle navigateur réussi.
- Les tests de non-régression V2 et V3 observation seule restent inchangés.
- Restitution V3 avec preuves de consolidation et rejet de preuves corrompues.
- Interruption de consolidation sur une observation physique non attribuable.
- Reconnaissance A-B-A, préservation d'une branche dormante et diminution de
  fiabilité pour des échecs réellement attribués au régime connu.
- Tests distincts de durée, densité d'observation, trou temporel, horloge inversée,
  isolation de contexte/runtime et capacité bornée.

La durée p95 de contrôle du nominal consolidé est d'environ 62,56 ms. Des tests
ont tourné pendant une partie de la campagne ; il s'agit d'un diagnostic,
pas d'un classement de performances. Le coût de reconstruction de l'observateur
n'a pas été optimisé dans cette étape.

## Rapports locaux et reproduction

Rapport nouveau, conservé sans écrasement :

[Campagne V3 consolidée](../dist/benchmarks/harness-v3-consolidated-development-1788957183479-0a5fe9c7-af43-41d9-9a97-5bd03853b800.json)

Témoins :

- [V2](../dist/benchmarks/harness-v2-development-1788953164029-a5c2a417-42e0-47db-8760-f9edc4ab9c4a.json)
- [V3 active](../dist/benchmarks/harness-v3-active-development-1788953641024-589fe1f8-1e95-4663-9aa0-0e6049a5b643.json)

Les fichiers JSON sont locaux et ignorés par Git. Le nouveau rapport contient
228 empreintes de sources exécutables, contre deux dans les témoins : le
collecteur avait un filtre d'extension erroné, corrigé dans cette étape.
Le protocole physique n'a pas changé.

```sh
npm run benchmark:production -- --controller harness-v3-consolidated --seed 101 --out dist/benchmarks
npm run benchmark:compare -- chemin/rapport-v3-active.json chemin/rapport-v3-consolidee.json
```

Voir [le mécanisme, le lien avec MotionWatch et les limites](V3_CONSOLIDATION_TEMPORELLE.md).
