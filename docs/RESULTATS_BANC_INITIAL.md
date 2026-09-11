# Premier relevé du banc de production

Archive du banc 0.1.0, avant le raccordement du harnais.
Voir les [résultats actuels des graphes réels](RESULTATS_GRAPHES_PRODUCTION.md)
pour la campagne du contrat 2.

Relevé du 9 septembre 2026, `production-cell@0.1.0`, jeu de développement :
dix familles, trois graines par famille, 600 secondes simulées par cas.
Il s'agit de la validation de l'instrument, pas d'un classement d'architectures.

## Résultat vérifié

- 110 tests du dépôt réussis, dont 21 pour le banc.
- Un test de bundle réussi.
- Dix tests optionnels vérifient l'identité des trajectoires du contrôleur
  direct et du vrai runtime LangGraph 1.4.14, à logique de décision identique.
- Deux campagnes de 30 cas terminées sans erreur d'adaptateur.
- Vérification appariée des 30 couples : toutes les métriques hors temps de calcul
  sont identiques entre la référence directe et son enveloppe LangGraph.

Les deux variantes exécutent les mêmes règles réactives. L'égalité est attendue :
elle permet de vérifier le raccordement. Elle ne signifie pas qu'un harnais
apprenant et une architecture LangGraph native sont équivalents.

Rapports locaux générés, avec empreintes de sources et du protocole :
[référence](../dist/benchmarks/reference-development-1788951728432-deabc2e2-380a-41d2-a756-cbdcd9c750e9.json),
[LangGraph](../dist/benchmarks/langgraph-development-1788951754405-34cb571a-807f-4421-8ec6-ccc959770c05.json).
Ces exports sont des artefacts locaux ignorés par Git ; les commandes du
[protocole](BENCHMARK_PRODUCTION_V1.md) permettent de les régénérer sous de nouveaux noms.

## Ce que fait déjà la référence à règles simples

Médianes sur trois graines, pour chaque mesure séparément.
Unités synthétiques, non calibrées sur une machine réelle.

| Cas | Flux satisfait | Température > 80 °C (s) | File > 40 pièces (s) | Attente (pièces·s) | kWh / 100 pièces conformes |
| --- | --- | --- | --- | --- | --- |
| Nominal | 100.0 % | 0 | 0 | 120 | 0.0100 |
| Charge puis retour | 100.0 % | 0 | 0 | 120 | 0.0118 |
| Frottement et rappel | 100.0 % | 0 | 0 | 1770 | 0.0242 |
| Dérive du refroidissement | 100.0 % | 0 | 0 | 120 | 0.0100 |
| Pannes combinées | 96.2 % | 0 | 155 | 13149 | 0.0243 |
| Température indisponible | 90.9 % | 0 | 203 | 16391 | 0.0217 |
| Capteur biaisé | 81.0 % | 198 | 234 | 18199 | 0.0413 |
| Actionneur retardé | 100.0 % | 0 | 0 | 120 | 0.0121 |
| Indice trompeur | 100.0 % | 0 | 0 | 1725 | 0.0223 |
| Rupture sans indice préalable | 97.8 % | 0 | 76 | 7289 | 0.0157 |

La référence satisfait les seuils synthétiques dans les six familles de service,
sur les trois graines. Elle peut avoir un retard ou une énergie plus élevés
sans franchir ces seuils. Ce socle simple doit rester dans les comparaisons :
la complexité du harnais n'est pas justifiée par sa seule existence.

Dans les pannes combinées, plus de 96 % du flux est traité, mais la file dépasse
sa limite pendant 155 secondes en médiane. Une bonne production totale cache donc
une qualité de service dégradée.

Le capteur biaisé produit une autre défaillance : des dépassements thermiques
réels en plus du retard. Les deux durées ne s'additionnent pas pour obtenir
le temps hors contraintes, car elles peuvent se chevaucher. Le biais met en
défaut une règle qui fait confiance à la mesure, sans démontrer encore qu'un
observateur donné saurait résoudre ce cas.

## Ce que ces chiffres ne disent pas

Aucun adaptateur V1/V2/V3 du harnais ne pilote encore cette cellule. Aucun
avantage du harnais, ni de LangGraph comme architecture produit, n'est établi.
La difficulté et la faisabilité des cas de stress restent à qualifier.

Les temps de calcul des rapports sont diagnostiques. Les processus n'ont pas
été isolés et répétés selon une campagne de performance ; ils ne permettent
pas de classer les moteurs. Aucun LLM n'est appelé.

Ces trois graines ne permettent pas d'estimer une fiabilité industrielle.
Les familles sont connues et fixes : généralisation non mesurée.
La [note sur la généralisation](GENERALISATION_ET_BANCS.md) impose de distinguer
ces résultats de variations réservées, de longues trajectoires et du transfert
vers un autre système.

La décision de garder, réduire ou abandonner le harnais reste ouverte.
