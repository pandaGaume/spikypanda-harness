# Banc de comparaison des architectures : cellule de production

État du 9 septembre 2026. Banc candidat `production-cell@0.2.0`.
Contrat et métriques version 2 ; physique et corpus inchangés depuis 0.1.0.
Ce document définit le jeu de test, les métriques et les conditions de comparaison.
Le sample appartient au banc, pas à la bibliothèque du harnais.

## 1. La décision que ce banc doit permettre

Nous comparons des solutions pour choisir un produit, pas pour justifier
l'existence de SpikyPanda Harness. Les conclusions admissibles sont :

- Conserver le harnais si son avantage utile justifie son coût total.
- Conserver uniquement une mémoire ou un observateur différenciant, sur un
  moteur existant, si reconstruire l'orchestration n'apporte rien.
- Adopter un framework existant si une configuration adaptée répond mieux
  au besoin, ou aussi bien avec moins de développement et de maintenance.
- Utiliser un contrôleur simple si le problème ne nécessite pas de harnais.
- Déclarer les données insuffisantes, sans transformer une égalité en victoire.

L'architecture actuelle ne reçoit aucun bonus pour le travail déjà investi.
Une dépendance acceptable dans un comparateur n'est pas automatiquement acceptée
dans le produit. Une éventuelle adoption doit inclure la décision de dépendance
et de licence, en plus des performances.

La [fiche de décision](../benchmarks/production-v1/architecture-scorecard.json)
conserve les candidats, leur état réel et les critères métier encore à renseigner.
Les budgets de développement, de maintenance et le gain minimal utile restent
à décider avant un classement produit. Les valeurs inconnues restent nulles.

## 2. Trois comparaisons à ne pas mélanger

### A. Validation du banc et de ses adaptateurs, livrée

La même politique à règles observe les mêmes données et choisit les mêmes actions,
directement, à travers LangGraph, puis à travers notre graphe avec raisonnement systématique. Les trajectoires et les métriques physiques
doivent être identiques. Sinon, nous avons une différence de protocole ou
d'adaptation à corriger avant tout classement.

Ce premier adaptateur LangGraph contient un seul nœud de décision. Il sert
à vérifier l'intégration, pas à représenter la meilleure architecture LangGraph.

### B. Coût d'orchestration, protocole défini, campagne non livrée

Exécuter exactement les mêmes opérations dans chaque moteur : observations,
décisions, contrôles, journalisation et éventuelle persistance équivalentes.
La logique métier, les données et la quantité de travail sont constantes.
Mesurer démarrage, latence, coût de calcul et mémoire dans des processus isolés.

On ne comparera pas un nœud LangGraph sans journal à treize nœuds SpikyPanda
avec apprentissage pour conclure que le premier moteur est plus rapide.
Les durées du premier essai sont diagnostiques, pas ce benchmark contrôlé.

### C. Valeur produit des architectures, premiers adaptateurs raccordés

Chaque architecture utilise ses mécanismes : règles seules, raisonneur systématique,
mémoire adaptative V1/V2/V3, workflow LangGraph avec mémoire et raisonnement adaptés.
Même environnement, mêmes capacités, mêmes observations et mêmes contraintes.
Les [graphes V1/V2/V3 sont raccordés](RACCORDEMENT_GRAPHES_PRODUCTION.md) avec un
raisonneur déterministe commun. Une configuration LangGraph native avec mémoire
et une comparaison à LLM restent à construire.

Pour les variantes à LLM, le fournisseur, le modèle, le prompt métier, les limites
de contexte et le budget doivent être identifiés. Le service commun comptabilise
appels, tentatives, tokens et délais. Les mécanismes de compression ou de sélection
de mémoire peuvent différer, mais doivent être déclarés et leur coût compté.
Un autre modèle définit une autre expérience ; ce n'est pas un effet du moteur.

Une configuration LangGraph destinée au produit devra être relue et réglée sur
le jeu de développement, avec un budget d'intégration comparable. Le banc ne
permet pas de déclarer « notre mémoire bat LangGraph » en opposant notre mémoire
apprise à un concurrent auquel nous n'aurions donné ni mémoire ni stratégie.

## 3. Le système simulé

Une cellule motorisée traite un flux de pièces. Sa cadence, ses pertes thermiques,
son refroidissement, sa file d'attente et la qualité de sortie interagissent.

Observations : température mesurée, vitesse réelle, courant moteur, vibration,
débit de refroidissement, ambiance, file d'attente, production conforme, rejets,
débordements et état du verrou thermique. Le contrôleur reçoit aussi le temps
écoulé et la commande effectivement appliquée.

Quatre commandes déclarées : arrêt avec refroidissement, économique, équilibrée,
rapide. Elles déterminent une consigne moteur et une ventilation. La vitesse
possède de l'inertie ; une commande n'efface pas instantanément le mouvement.
Une perturbation peut retarder l'application des commandes.

L'état du monde reste continu pendant les 600 pas d'une seconde. La température,
la file d'attente, les pertes et l'énergie ne sont pas remis à zéro à chaque panne.
Seul un nouveau cas recommence avec un état initial documenté.

### Modèle mathématique de référence

Les coefficients suivants sont des paramètres synthétiques, pas des données
d'une machine réelle :

```text
vitesseCible = commande / (1 + 0.7 × frottement + 0.1 × charge)
vitesse     += 0.3 × (vitesseCible - vitesse)
courant      = 0.5 + 4 × commande × (charge + 2 × frottement)
puissance    = 0.05 + 0.012 × courant² + 0.4 × ventilation³
température += dt × [0.09 × courant²
               - efficacitéRefroidissement × (0.05 + 0.35 × ventilation)
                 × (température - ambiance)]
capacitéTraitée = 1.6 × vitesse × dt
```

Le taux de rejet dépend de la température et du frottement sous commande.
Le stock respecte une conservation : stock initial + arrivées = stock final
+ pièces conformes + pièces rejetées + débordements. Les pièces sont des
équivalents continus, pas une simulation discrète de chaque objet.

Le garde commun refuse une commande productive si la température mesurée manque
ou atteint 80 °C. Un verrou indépendant coupe l'entraînement si la température
réelle atteint 92 °C avant l'intervalle suivant. Le verrou utilise l'état du
simulateur, mais ne communique pas la panne au contrôleur. Les deux mécanismes
et leurs interventions sont identiques pour tous les adaptateurs.

L'arrêt peut lui-même être retardé par le scénario d'actionneur. Le verrou
thermique indépendant reste prioritaire. Les demandes refusées sont distinguées
des commandes effectivement appliquées.

Le code de référence est [plant.mjs](../benchmarks/production-v1/plant.mjs).
Il n'est pas un jumeau numérique validé ni une certification industrielle.

## 4. Jeu de test versionné

La [note transversale sur la généralisation](GENERALISATION_ET_BANCS.md)
distingue corpus de régression, variations réservées et transfert à un autre
système. Les graines actuelles changent le bruit et les dates, pas les familles
de phénomènes. Ce banc ne mesure pas encore la généralisation. Le rapport JSON
l'indique explicitement dans `coverage.generalizationMeasured: false`.


Le [manifeste](../benchmarks/production-v1/suite.json) définit dix familles :

| Famille | Phénomène | Ce qui peut départager les solutions |
| --- | --- | --- |
| nominal | Charge stable avec bruit de mesure | Sobriété, production, coût inutile d'un raisonneur. |
| load-return | Hausse de charge puis retour | Retard accumulé, adaptation, consommation. |
| friction-recall | A-B-A-B mécanique dans un même parcours | Réutilisation utile, absence de reconsolidation inutile. |
| cooling-drift | Perte progressive de refroidissement | Anticipation thermique, effets retardés. |
| compound | Pannes mécanique et thermique superposées | Arbitrages et limites de récupération. |
| missing-temperature | Capteur perdu pendant une dégradation | Prudence, indisponibilité et coût du manque d'information. |
| sensor-bias | Température sous-estimée | Faux sentiment de sécurité et dépassement réel. |
| delayed-actuator | Commandes retardées sous charge | Gestion de l'inertie et des commandes périmées. |
| misleading-vibration | Corrélation d'indice modifiée | Faux rappels et adaptation de l'observateur. |
| unobservable-before-change | Changement abrupt sans indice préalable | Reconnaissance de la limite d'observabilité. |

Les familles sont marquées `service` ou `stress`. Les cas de stress explorent
aussi des limites où la récupération sans violation peut être impossible.
Ils restent dans les résultats ; ils ne deviennent pas automatiquement des
critères éliminatoires identiques aux cas de service.

Le générateur donne 30 cas de développement, 100 de régression et 200 d'évaluation,
soit 330 couples scénario/graine. Les dates d'événements varient selon la graine.
Bruit et arrivées dépendent de la graine, du canal et du temps, jamais du nombre
d'actions ou de lectures du contrôleur.

Les graines d'évaluation sont distinctes mais publiques. Il ne s'agit pas d'un
test aveugle ; leur consultation répétée peut conduire au sur-ajustement.
Une campagne finale devra geler la configuration candidate et utiliser de
nouvelles séquences représentatives si nécessaire.

### Le jeu n'est pas une liste de bonnes réponses

On conserve les perturbations exogènes, les états initiaux et le générateur.
Les trajectoires complètes sont produites en boucle fermée : deux contrôleurs
peuvent provoquer des états différents à partir des mêmes perturbations.
Le benchmark ne leur impose pas d'exécuter une liste d'actions « correctes ».

Les noms de scénarios, les graines, les événements à venir et les paramètres
cachés restent du côté évaluateur. Une panne ne modifie pas une observation
antérieure à son effet. Les vérités cachées servent à l'évaluation, jamais
à alimenter la décision ou la cible d'apprentissage du contrôleur.

## 5. Contrat commun des adaptateurs

Le contrat version 2 accepte deux formes exclusives, sans LLM dans les essais actuels :

```js
createController({ contractVersion, objective, actions, stepSeconds, deadlineMs })
  => {
    id,
    decide(observation) => { actionId, rationale? },
    learn?(publicFeedback)
  }
```

Un graphe peut remplacer `decide/learn` par
`step(observation, dispatch, abortSignal)`. Il appelle `dispatch` depuis sa
capacité exécutée, puis observe et apprend sur le retour public. Le callback
appartient au banc, ne peut servir qu'une fois et expire à la fin du pas.
Les formes ne peuvent pas être mélangées sur un même adaptateur.

L'adaptateur propose ; seul le banc autorise et applique l'action.
Le retour public contient les observations avant/après, la demande, la commande
envoyée et le refus éventuel. Il n'inclut ni les paramètres cachés ni la température
réelle non mesurée.

Chaque cas crée un nouveau contrôleur. L'apprentissage en ligne peut continuer
à l'intérieur du cas, y compris lors des retours A-B-A-B. Il ne fuit pas vers
le cas ou l'architecture suivante.

Des campagnes avec mémoire préentraînée, gelée ou restaurée devront porter
des identifiants distincts, avec le corpus de préparation et ses coûts.
Le premier runner ne les implémente pas et ne les simule pas silencieusement.

Ce contrat coopératif est exécuté dans un processus de confiance. Il ne constitue
pas une sandbox contre un adaptateur qui importerait volontairement le simulateur.
Une boucle JavaScript synchrone infinie peut bloquer le processus malgré le
délai asynchrone. L'isolation par processus est nécessaire avant une campagne
adversariale ou une mesure comparative des ressources.

## 6. Métriques, unités et règles de calcul

Le calculateur est [metrics.mjs](../benchmarks/production-v1/metrics.mjs).
Il relit la trace de l'évaluateur, pas les affirmations du contrôleur.

| Mesure | Définition |
| --- | --- |
| Production conforme | Somme des pièces équivalentes conformes. |
| Débit conforme | Pièces conformes / durée évaluée, exprimé par minute. |
| Satisfaction du flux | Pièces conformes / (stock initial + arrivées). |
| Taux de rejet | Rejets / (conformes + rejets), `null` (non calculable) si rien n'est traité. |
| Attente cumulée | Intégrale discrète de la file, en pièces-secondes. |
| Débordements | Pièces perdues parce que le tampon maximal de 80 est dépassé. |
| Dépassement thermique | Temps au-dessus de 80 °C, et intégrale des degrés excédentaires en °C·s. |
| Dépassement de file | Temps au-dessus de 40 pièces, et intégrale de l'excès en pièces-secondes. |
| Temps hors contraintes | Union des deux dépassements : pas de double comptage des secondes. |
| Énergie | Intégrale de puissance, en kWh. |
| Énergie spécifique | kWh / 100 pièces conformes ; null si aucune n'est produite. |
| Interventions | Secondes de verrou thermique, refus du garde, actions invalides, indisponibilité. |
| Délai de décision | p50, p95 et maximum des décisions effectivement tentées ; compilation par cas séparée. |
| Traitement après action | Temps total après le retour de dispatch : observation, évaluation, apprentissage et diagnostics. |
| Boucle de contrôle | p50, p95 et maximum de la somme avant/après dispatch, hors calcul du simulateur. |
| Mémoire et parcours | Nœuds visités, appels au raisonneur, replays, expériences et taille JSON ; diagnostics des adaptateurs SpikyPanda. |
| Récupération | Retour durable au service, voir ci-dessous, avec non-récupérations conservées. |

Les mesures de danger thermique, de retard de production et de consommation
restent séparées. Une production élevée ne compense pas implicitement un
dépassement thermique.

Les quantiles utilisent le rang supérieur `ceil(p × nombre de valeurs)`, sur
les valeurs triées. Une série absente donne null, pas zéro. Le maximum et le
nombre de cas restent visibles avec les quantiles. Après un échec, les pas de
repli sans appel au contrôleur ne diluent pas ses mesures de latence ; leur
indisponibilité reste comptée séparément.

### Récupération et échecs

Après chaque événement marqué, on cherche dix secondes consécutives respectant
les contraintes et produisant au moins 90 % des arrivées de chaque intervalle.
Le délai est celui de la confirmation du retour durable, pas celui d'un simple
pic de production.

La fenêtre est limitée à 90 secondes, à la fin du run ou à l'événement suivant.
Une récupération non observée reste `seconds: null, censored: true`, avec la
durée observée et l'éventuelle interruption. La médiane des récupérations
réussies doit toujours être accompagnée du nombre total d'événements et du
nombre récupéré. Un échec n'entre jamais dans cette médiane comme zéro.

Un adaptateur qui échoue n'est pas retiré du résultat. Le banc poursuit le monde
jusqu'à l'horizon prévu avec la commande de repli, marque les pas indisponibles
et conserve l'effet d'une action déjà accomplie avant un échec d'apprentissage.
Un échec de préparation reste une ligne `setup-error` sans métriques inventées.

### Temps simulé et temps informatique

Le monde avance d'une seconde par décision. Le temps de calcul est mesuré
séparément ; il ne fait pas avancer la physique dans cette première version.
Le budget de décision/apprentissage est d'une seconde réelle ; son dépassement
est compté et le contrôleur est retiré du reste du cas.

Ce protocole ne mesure donc pas encore les conséquences physiques exactes d'un
LLM lent. Une campagne de contrôle temps réel exigera une horloge découplée.
Les imports de framework, le démarrage du processus et la mémoire RSS isolée
ne sont pas encore instrumentés. Les durées présentes ne suffisent pas
à publier un classement de moteurs.

Appels LLM, tokens, coûts monétaires et mémoire propre à l'adaptateur font partie
du protocole produit. Le premier essai ne comporte aucun LLM : zéro appel,
tokens/coûts non applicables ou non mesurés laissés à null. Aucun coût commercial
ou nombre de tokens n'est estimé à partir d'un mock.

## 7. Lecture qualitative vérifiable

Chaque rapport comprend une chronologie : observation disponible, action proposée,
commande envoyée, justification éventuelle, effet mesuré et événements réservés
à l'évaluateur. Une trace complète peut être exportée avec `--traces`.

Pour chaque incident significatif, le compte rendu doit répondre :

1. Que savait effectivement le contrôleur à ce moment ?
2. Qu'a-t-il demandé et qu'est-ce qui a réellement été appliqué ?
3. Quelles contraintes et quelle production ont été affectées ?
4. La mémoire a-t-elle aidé, induit en erreur ou été inutilisable ?
5. Qu'est-ce qui a déclenché la reprise, l'abstention ou l'échec ?

Une justification textuelle du contrôleur n'est pas une preuve de la cause
de sa décision. Elle est confrontée aux traces. Les erreurs remarquables
et les non-récupérations doivent figurer dans la synthèse.

Les futurs scores de reconnaissance d'un observateur demanderont leur protocole
propre : des identifiants internes M1/M2 ne correspondent pas naturellement
à des étiquettes de panne universelles. L'alignement ne devra pas être optimisé
a posteriori sur le jeu d'évaluation.

## 8. LangGraph comme référence externe

LangGraph est un moteur de workflows avec état, nœuds et transitions ; les
fonctions des nœuds portent la logique de décision. C'est donc un candidat
pertinent pour une alternative d'orchestration, pas un algorithme adaptatif
complet automatiquement comparable au nôtre.
[Documentation officielle](https://docs.langchain.com/oss/javascript/langgraph/graph-api).

La bibliothèque est distribuée sous licence MIT. L'essai utilise sa version
locale, sans service commercial de déploiement ni compte LangSmith.
[Licence](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph/LICENSE),
[guide officiel](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api).

Le comparateur est sous `benchmarks/comparators/langgraph`, hors des workspaces
du produit. Ses versions directes sont fixées : LangGraph 1.4.14, core LangChain
1.2.9 et Zod 4.5.4. Son lockfile conserve les résolutions transitives.
Aucune de ces dépendances n'est ajoutée à `packages/harness`, au plugin ou
à la démo. Les variables de traçage distant sont désactivées pour ce comparateur.

L'essai initial a vérifié l'équivalence sur les dix scénarios, 600 pas chacun.
Cela établit que LangGraph peut participer au banc. Cela ne compare pas encore
sa meilleure configuration produit à SpikyPanda.

Si un candidat ne peut pas respecter le contrat ou impose une contrainte produit
inacceptable, documenter le motif et arrêter son intégration. S'il convient,
lui donner une configuration crédible et un budget de réglage raisonnable.
L'effort passé dans notre propre harnais ne doit pas décider du résultat.

## 9. Règles de comparaison entre évolutions

Un résultat conserve versions de contrat et métriques, hashes du manifeste,
des perturbations, du générateur, du simulateur, du calculateur, du runner,
du code d'adaptation et du lockfile éventuel. Node, OS, architecture machine,
révision Git et état modifié du dépôt sont enregistrés.

Les écarts sont calculés sur les mêmes couples scénario/graine.
`pairedDelta` refuse des cas, versions ou empreintes de protocole incompatibles.
Il retourne des écarts par métrique, sans désigner un gagnant.

Pour une campagne produit, déclarer aussi les modèles, prompts, budgets,
corpus d'apprentissage, instantanés de mémoire et politiques de reprise.
Exécuter chaque variante isolément, varier l'ordre et répéter les mesures
informatiques. Publier le nombre de cas, les échecs et les écarts appariés.
Les premiers exports ne remplacent pas cette campagne.

Une correction du simulateur ou des métriques crée une nouvelle référence.
Conserver les anciens résultats et relancer toutes les architectures.
Stabiliser un instrument de mesure n'immobilise pas les poids du harnais :
ses apprentissages et ses hypothèses restent plastiques.

La variable `meetsCandidateEnvelope` résume uniquement les seuils synthétiques
actuels : trace complète, absence de dépassement, d'action invalide,
d'indisponibilité ou de délai manqué, et satisfaction du flux d'au moins 90 %.
Ce n'est ni un score global pondéré ni le critère final de sélection du produit.
La faisabilité de chaque cas de stress doit être évaluée avant d'en faire
une exigence éliminatoire.

## 10. Commandes et livrables actuels

```sh
npm run test:benchmark
npm run benchmark:production -- --split development --controller reference --out dist/benchmarks
npm run benchmark:production -- --split regression --controller reference --out dist/benchmarks
npm run benchmark:production -- --split evaluation --controller reference --out dist/benchmarks
```

Comparateur optionnel, installé séparément :

```sh
npm --prefix benchmarks/comparators/langgraph ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm run test:benchmark:langgraph
npm run benchmark:production -- --split development --controller langgraph --out dist/benchmarks
```

Les exports ont un nom unique et n'écrasent pas une campagne précédente.
Le runner affiche les résumés par scénario et garde les cas échoués.
`--traces` ajoute toutes les lignes ; sans cette option, la chronologie
qualitative et les métriques sont conservées.

Livré : manifeste, générateur, monde continu, autorisation commune, calcul des
métriques, référence à règles, contrôleur d'arrêt de vérification, adaptateur
LangGraph d'admission, vrais graphes V1/V2/V3 et témoin à raisonnement systématique,
tests et exports JSON.

Non livré : workflow LangGraph produit avec mémoire/LLM, métrologie des services LLM,
campagne de ressources isolées, reprise durable, entraînement hors ligne,
classement d'architectures ou qualification industrielle.

Le [premier relevé mesuré](RESULTATS_BANC_INITIAL.md) conserve les tests passés,
les résultats de la référence et les limites de l'essai LangGraph.

Le [raccordement des graphes](RACCORDEMENT_GRAPHES_PRODUCTION.md) détaille les choix
métier et les commandes V1/V2/V3. Les résultats serviront à décider si nous gardons,
réduisons ou abandonnons le harnais, sans présumer la généralisation.
