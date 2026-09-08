# État des lieux V1 : harnais exécutable et mémoire plastique

Date du constat : 8 septembre 2026.

## 1. Objet de ce jalon

Ce document fixe l'état du travail avant l'évolution vers une mémoire capable
de distinguer des fonctionnements déjà rencontrés. Il sépare les réalisations
vérifiées, leurs limites et la proposition V2, qui n'est pas implémentée.

« Fixer l'acquis » signifie conserver une référence du code et de son
comportement. Cela ne signifie jamais figer les poids ou rendre une branche
apprise irréversible.

Repères au moment de la rédaction :

- Dépôt : `spikypanda-harness`, indépendant du dépôt SpikyPanda principal.
- Branche : `main`.
- Dernier commit présent avant consolidation : `c627a06`.
- Les travaux décrits comprennent les modifications locales et les nouveaux
  fichiers non encore commités à cette référence.
- Version déclarée des paquets : `0.1.0`. « V1 » désigne ici un jalon
  expérimental, pas une publication npm 1.0 ni une qualification de production.

## 2. Conclusion en une lecture

Nous disposons d'un harnais de décision exécutable, utilisable sans interface
ou depuis un graphe visuel. Il observe, cherche une décision mémorisée, sollicite
un raisonneur simulé si nécessaire, contrôle une action, l'exécute et apprend
de son résultat.

Le mécanisme de confiance reste révisable, y compris après un long historique
de succès. Le scénario Counter montre la consolidation, le rejeu et
l'adaptation par révision des scores lorsque la dynamique change.

En revanche, il ne reconnaît pas encore deux fonctionnements différents
derrière une même situation apparente. Au retour d'un fonctionnement connu,
il doit encore reconsolider les liens concernés. La croissance structurelle
de la mémoire reste donc limitée.

Le jalon est une base d'expérimentation testée. Ce n'est ni une mémoire
contextuelle complète, ni une démonstration de résilience industrielle.

## 3. Réalisations disponibles

| Élément | État au jalon V1 |
| --- | --- |
| Séparation des paquets | Runtime sans interface, plugin visuel et fournisseur de raisonnement simulé dans trois paquets distincts. |
| Runtime partagé | Même pipeline de décision utilisé par le pilote sans interface et le pilote de graphe. |
| Harnais visuel | 12 étapes typées ; le câblage visible est compilé et exécuté. Ajout, déplacement, activation et import/export des nœuds disponibles dans la démo. |
| Plugin externe | Chargement du bundle par le chargeur de plugins du Node Editor ; partage de la même instance de core avec l'hôte. |
| Contrôles d'exécution | Validation des décisions, validation JSON Schema des arguments avec Ajv, capacités autorisées, garde-fou, approbation fraîche si requise et contrôle de fraîcheur de l'observation. |
| Gestion des sessions | Identifiant de décision, ordre des étapes, délai maximal, annulation coopérative et refus des décisions concurrentes sur un même runtime. |
| Mémoire plastique | Contextes, actions, capacités, liens appris, statistiques adaptatives et expériences sérialisables. |
| Persistance | Documents distincts pour le harnais et la mémoire ; sauvegarde navigateur, export/import JSON et restauration des paramètres de plasticité. |
| Démo Counter | Pas à pas, épisodes, entraînement, inversion de dynamique, métriques et journal des décisions. |
| Vue mémoire | Projection en lecture seule des nœuds et liens réels, confiance actuelle, possibilité de rejeu et sélection des dernières expériences. |
| Lanceur local | Port fixe 4175 par défaut, ouverture du navigateur et réutilisation d'un serveur identifié comme appartenant à la même démo du même dépôt. |

Les paquets sont :

- `@spiky-panda/harness` ;
- `@spiky-panda/plugin-harness` ;
- `@spiky-panda/harness-provider-mock`.

Le runtime s'appuie sur `@spiky-panda/core`. L'interface utilise
`@spikypanda/nodeeditor`. La séparation en graphe du monde, graphe du harnais
et graphe de mémoire reste une direction architecturale : Counter représente
actuellement le monde par un petit simulateur local, pas par un modèle
industriel complet sous forme de graphe.

## 4. Ce qui est réellement exécuté et appris

### 4.1. Le flux du harnais

Un appel à `runtime.step()` réalise une seule décision. Il choisit soit le
rejeu de mémoire, soit le recours au raisonneur ; il n'exécute pas les deux
branches de décision à chaque tour.

Le graphe est acyclique et limité aux 12 étapes prévues. Le programme hôte
répète son exécution pour constituer les épisodes. Le harnais ne réécrit pas
son propre flux et ne constitue pas encore un moteur de workflows arbitraires.

Les contrôles de sécurité ne sont pas appris. Une forte confiance ne permet
pas de contourner le garde-fou, les permissions ou les schémas d'arguments.

### 4.2. La mémoire actuelle

Le contexte est identifié par l'identifiant de l'état, l'intention et ses
paramètres. Dans Counter, les identifiants d'état sont `below`, `above` et
`at-target`. Pour une cible de 3, les valeurs 0, 1 et 2 partagent donc un seul
contexte « sous la cible ».

La valeur numérique et la révision sont utilisées pour vérifier qu'une
observation n'est pas périmée. Elles ne distinguent pas les fonctionnements
normal et inversé dans la clé de mémoire.

Un lien appris est spécifique au contexte, à l'action, à la capacité et aux
arguments d'appel. Une expérience de commande −1 ne met pas directement à
jour le lien de commande +1.

À chaque expérience complète, le modèle :

1. Crée les entités et le lien appris s'ils n'existent pas encore.
2. Révise les statistiques du lien correspondant à l'action exécutée.
3. Ajoute un nœud d'expérience contenant le contexte de départ, la décision,
   l'état obtenu et l'évaluation.

Ces nœuds d'expérience sont actuellement isolés dans le graphe. Leur contenu
permet de retrouver le lien concerné, mais il n'existe pas encore d'arêtes
de provenance les reliant aux observations, aux décisions et aux résultats.

La vue mémoire montre cette réalité. Les cartes de confiance sont des
annotations de liens, pas des états supplémentaires du monde. Dans le cas
habituel avec une cible donnée, la partie reliée contient un contexte, une
ou deux actions et une capacité. Elle évolue surtout par révision des scores
après l'apparition des premiers liens.

### 4.3. Sens et limites de la confiance

La confiance est une estimation adaptative des succès observés, actualisée
par moyenne exponentielle. Ce n'est ni un certificat de compétence universelle,
ni une probabilité de succès statistiquement calibrée.

Les compteurs de succès et d'échecs cumulés servent à l'audit ; ils ne
constituent pas les poids de décision. La quantité d'évidence effective est
plafonnée, mais ce plafond ne signifie pas que seuls les huit derniers
événements sont conservés ou consultés.

La possibilité de rejeu dépend de plusieurs critères : confiance, récompense
moyenne, quantité d'évidence et seuils de promotion/rétention. L'interface
affiche l'éligibilité calculée du candidat, pas uniquement son indicateur
interne de rétention.

L'historique complet des expériences, lui, n'est pas borné par ce plafond :
la vue limite son affichage aux 12 dernières expériences, sans supprimer
les précédentes. La compaction du journal n'est pas implémentée.

### 4.4. Le raisonneur

Le fournisseur utilisé est un simulateur déterministe, pas un LLM distant.
Il reçoit les observations, les candidats et les échecs récents. Il infère
le sens des déplacements à partir de résultats observés, sans lire la
direction cachée du monde.

Les actions disponibles sont prédéfinies : commandes +1 et −1. La démo
n'invente pas de nouvelles capacités et n'entraîne aucun modèle neuronal.

## 5. Vérifications et résultats

Les commandes suivantes ont été relancées le 8 septembre 2026 sur le dépôt
local, avec les dépendances SpikyPanda liées :

| Vérification | Résultat |
| --- | --- |
| `npm test` | Compilation réussie ; 29 tests réussis, aucun échec. |
| `npm run test:bundle` | Construction de la démo et du plugin réussie ; 1 test de bundle réussi. |
| `npm run experiment:counter` | 20 épisodes réussis, avec inversions aux épisodes 11 et 16. |

L'expérience Counter a produit 68 actions, dont 60 décisions issues de la
mémoire et 8 appels au raisonneur simulé :

- Premier épisode : 3 actions et 3 appels au raisonneur.
- Épisodes 2 à 10 : 3 actions par épisode, sans appel au raisonneur.
- Première inversion, épisode 11 : 7 actions et 3 appels au raisonneur.
- Retour à la dynamique normale, épisode 16 : 7 actions et 2 appels au raisonneur.
- Les épisodes suivants de chaque phase reviennent à 3 actions sans raisonneur.

La réussite d'un épisode signifie que sa cible a été atteinte. Elle ne
signifie pas que toutes ses actions ont produit un progrès. Les épisodes
d'inversion comprennent justement des actions contradictoires avec l'objectif.

Les tests couvrent notamment :

- L'équivalence entre les exécutions sans interface et par graphe, sur
  36 actions et deux inversions.
- Le rejet des câblages incomplets, des contournements de garde-fou et des
  propositions invalides avant action.
- Les refus d'autorisation, les observations périmées, les délais et
  l'annulation avant exécution.
- La réversibilité des décisions après 10 000 succès historiques.
- La séparation des intentions et la restauration sans perte de plasticité.
- La fidélité de la projection mémoire et l'absence de croissance fictive
  lorsqu'une exécution est refusée.
- Le partage du core par le bundle externe et le comportement du lanceur
  lorsqu'un port est occupé.

Des contrôles visuels ont également été effectués pendant le développement :
mémoire vide, premier lien, entraînement, baisse de confiance après inversion,
apparition de l'action opposée, sélection d'une expérience et récupération de
la mémoire précédente sans modifier la sauvegarde navigateur. Ce sont des
contrôles manuels, pas une suite automatisée complète de tests d'interface.

Ces résultats établissent le fonctionnement des mécanismes testés, pas leur
validité pour tous les environnements possibles.

## 6. Limite centrale identifiée : retour à un fonctionnement connu

Pour une même cible, les dynamiques normale et inversée partagent actuellement
le contexte « sous la cible ». Le modèle ne possède pas d'hypothèse persistante
de fonctionnement normal ou inversé.

Lors d'une inversion, l'action auparavant pertinente échoue et son lien est
dégradé. Une autre action est apprise. Au retour à la première dynamique,
le même processus dégrade l'autre lien et reconsolide le premier.

Le problème n'est donc pas un transfert du score de +1 vers −1. C'est
l'absence de distinction entre :

- La fiabilité d'une action dans des conditions données.
- La pertinence actuelle de ces conditions.

La V1 adapte les scores dans un contexte trop grossier. Elle ne sait pas
encore reconnaître et réactiver proprement une compétence conditionnelle
déjà apprise. Afficher davantage de nœuds ne résoudrait pas ce défaut du modèle.

## 7. Autres limites et dépendances

- Aucun adaptateur LLM réel ni intégration opérationnelle d'outils externes.
- Aucun apprentissage de contextes latents ni de modèle général des conséquences.
- Pas de cycles arbitraires, de branches parallèles ou de workflows imbriqués.
- Garde-fou permissif par défaut dans le runtime générique ; un hôte réel doit
  fournir ses propres règles et capacités autorisées.
- Les adaptateurs exécutent du JavaScript dans le même processus : le harnais
  n'est pas un bac à sable contre du code malveillant.
- Une annulation ne revient pas sur une action déjà réalisée. Une action
  externe au résultat incertain exige une réconciliation propre à l'application.
- Aucun stockage chiffré, mécanisme de masquage automatique des données sensibles,
  journal compacté ou gestion de plusieurs rédacteurs concurrents.
- Le Node Editor reste un paquet privé du dépôt amont dans l'environnement
  actuel. L'installation locale utilise des liens vers SpikyPanda.
- Un chargeur ESM Node et un adaptateur de session asynchrone compensent
  actuellement des contraintes du core amont.
- Le scénario HELIOS existant est illustratif : son raisonneur lit une phase
  cachée et le CO2 est réinitialisé entre épisodes. Il ne prouve pas la
  résilience d'un système de survie ou d'un site de production.
- La qualification d'un cas industriel continu, sans information privilégiée,
  avec perturbations et contrôleurs de référence, reste à réaliser.

## 8. Orientation retenue pour la V2, non implémentée

L'évolution proposée est une mémoire de contextes de fonctionnement appris.

Elle devra distinguer la fiabilité conditionnelle d'une branche de son
applicabilité présente, conserver les observations qui soutiennent ou
contredisent chaque hypothèse, et reconnaître un fonctionnement déjà rencontré.

Une expérience devra garder la trace de ce qui était supposé avant l'action
et de l'attribution retenue après observation. Une attribution incertaine
devra rester explicite et révisable. Le système ne devra pas créer une
branche à chaque échec pour protéger indéfiniment une compétence supposée.

Pour Counter, le mode de fonctionnement devra être inféré des commandes et
des effets observés, jamais du bouton d'inversion ou de la variable cachée.
En l'absence d'indice observable, une première erreur après un changement
caché ne peut pas être exclue.

Critères proposés avant de développer cette V2 :

1. Sur A → B → A → B, reconnaître les fonctionnements déjà rencontrés au lieu
   de créer des copies équivalentes.
2. Dans Counter déterministe, après une observation discriminante, permettre
   la réactivation d'une branche mature du fonctionnement reconnu sans
   recommencer toute sa consolidation.
3. Ne pas attribuer directement le résultat d'une autre action à son score.
4. Ne pas dégrader automatiquement la compétence de A lorsqu'une expérience
   est attribuée de manière justifiée à B.
5. Garder une possibilité réelle de remise en question dans un fonctionnement
   reconnu ; ne pas transformer « mature » en « irréversible ».
6. Éviter la prolifération de branches sur des anomalies isolées et vérifier
   séparément le comportement en présence de bruit ou d'ambiguïté.
7. Enregistrer de véritables liens de mémoire utilisés par les décisions,
   avec une provenance consultable, pas seulement une représentation visuelle.
8. Préserver ces propriétés après sauvegarde et restauration. Versionner
   l'évolution des documents sans inventer des contextes manquants dans les
   anciennes expériences.

Ces critères constituent un point de départ pour la V2. Certains prolongent
des invariants de la V1 ; la réussite de la suite actuelle ne valide pas
pour autant les nouvelles exigences de reconnaissance et d'attribution.

## 9. Reprendre et consolider le travail

Dans un environnement dont les dépendances sont installées et liées :

```sh
npm test
npm run test:bundle
npm run experiment:counter
npm run demo
```

Le lanceur utilise le port fixe 4175. Une instance identifiée de la même démo
est réutilisée ; un service inconnu sur ce port entraîne une erreur explicite.
Il ne recherche pas de port libre et ne termine pas un processus existant.

La démo peut charger une mémoire déjà sauvegardée. « Repartir sans mémoire »
crée une mémoire temporaire vide, récupérable avec « Retrouver la mémoire
précédente » jusqu'au rechargement ou à la fermeture de la page. Ces commandes
ne modifient pas la sauvegarde du navigateur.

Le commit de consolidation doit archiver le runtime, le plugin, la démo,
les scripts, les tests et cette documentation. À la rédaction de ce constat,
aucun commit, push, changement de version ou développement V2 n'a été effectué
dans le cadre de cette demande documentaire.

Documents complémentaires :

- [Contrat d'exécution](EXECUTION.md).
- [Protocole de validation et limites](VALIDATION.md).
- [Plan d'implémentation](../IMPLEMENTATION_PLAN.md).
