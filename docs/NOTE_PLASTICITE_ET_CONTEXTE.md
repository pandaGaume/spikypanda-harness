# Note de conception : apprendre les conditions, pas préfixer les actions

Date : 9 septembre 2026.
Statut : clarification de l'intention du projet et proposition d'évolution.
Cette note ne modifie pas le comportement de la V2.

## Le point à préserver

Le harnais ne doit pas exiger que l'auteur du scénario associe à l'avance
chaque action à tous ses contextes possibles. Définir « +1 en mode A » et
« -1 en mode B » dans une table fournie par le développeur déplacerait la
décision dans le sample, au lieu de permettre son apprentissage.

L'hôte définit les capacités disponibles, leurs arguments, les observations
accessibles et les limites d'exécution. Le harnais doit apprendre les relations
entre circonstances, commandes, effets et utilité pour un objectif.
Déclarer une capacité est nécessaire pour agir sur le monde ; déclarer
manuellement toutes ses conditions d'utilité ne doit pas l'être.

Les primitives restent donc explicites et autorisées. La généralisation à
d'autres paramètres ou la composition de plusieurs actions sont des problèmes
distincts, non résolus automatiquement par l'ajout d'embeddings. Le système
ne peut pas inventer un accès physique ni s'octroyer une nouvelle permission.

## Ce que signifie réellement « une branche fiable »

Il faut distinguer quatre informations :

- L'action : la commande exécutée, avec ses arguments.
- L'effet : le changement effectivement observé après cette commande.
- La fiabilité conditionnelle : ce que les expériences disent de l'utilité
  de cette action pour un objectif, dans des circonstances données.
- L'applicabilité : les indices qui permettent de penser que ces circonstances
  sont actuellement réunies.

« +1 est fiable à 90 % » est donc une formulation trop courte. Il faut lire :
« les expériences attribuées à ces conditions soutiennent actuellement cette
action pour cet objectif ». Le score V2 reste une estimation adaptative,
pas une probabilité calibrée ni une garantie.

Ne plus reconnaître les conditions d'une compétence n'impose pas d'oublier
cette compétence. Inversement, reconnaître ces conditions ne doit jamais
interdire aux nouveaux résultats de remettre sa fiabilité en question.

## Pourquoi la V2 exécute encore +1 après l'inversion

Dans Counter, le bouton change la dynamique du simulateur sans transmettre
son sens au harnais. Le compteur observé ne révèle pas immédiatement ce sens.
La révision technique de l'état sert à vérifier la fraîcheur d'une décision ;
elle ne constitue pas une étiquette « normal » ou « inversé ».

Le harnais conserve donc son hypothèse précédente jusqu'à un nouvel effet.
La première commande peut être inadaptée. L'expérience contradictoire permet
ensuite de reconnaître un fonctionnement connu ou d'en confirmer un nouveau.

C'est un choix expérimental, pas une obligation de prévenir le harnais avant
chaque action. Il ne faudrait pas le généraliser en contrat d'architecture.

La [V2 actuelle](V2_MEMOIRE_CONTEXTUELLE.md) apprend des modes à partir d'une
signature d'effet programmée dans le sample : déplacement divisé par commande.
Elle ne découvre pas encore les indices qui définissent un contexte. C'est
la limite que la V3 proposée doit traiter, sans annoncer qu'elle est déjà levée.

## Un observateur d'indices, oui ; un oracle de contexte, non

Un observateur pourrait lire les observations autorisées, une fenêtre de
traces antérieures et les relations sémantiques du réseau. Il produirait des
représentations numériques, ou embeddings, de motifs potentiellement utiles.

Ces embeddings serviraient à retrouver des expériences et à proposer plusieurs
hypothèses de fonctionnement, y compris « inconnu » ou « indices insuffisants ».
Le résultat ne serait ni une commande, ni une autorisation, ni une vérité
définitive sur le monde.

« Pointer des embeddings d'indices » doit aussi signifier pointer leurs
sources : mesure, nœud, lien, événement et intervalle de temps. Un vecteur
proche d'un autre peut aider la recherche ; cette proximité ne prouve ni
une cause ni l'applicabilité d'une action.

La [trajectoire transversale](TRAJECTOIRE_V1_V2_V3.md) détaille cette proposition,
les modèles à comparer et les tests. Un CNN temporel peut être un candidat
pour des signaux ; un modèle de graphe peut l'être pour des relations entre
composants. Aucun de ces choix n'est imposé à la bibliothèque.

L'observateur ne doit pas seulement contempler les poids qu'il a contribué
à produire : les prédictions restent des hypothèses, les observations restent
des faits datés. Réinjecter une prédiction comme nouvelle preuve créerait une
boucle de confirmation artificielle.

## La limite qui restera vraie

Si deux mondes ont exactement les mêmes observations et le même historique
accessible, mais réagissent différemment à la prochaine action, aucun
observateur ne peut les distinguer avec certitude avant une information
supplémentaire. Un embedding ne crée pas cette information.

Trois situations doivent être testées séparément :

1. Un changement annoncé par un signal opérationnel accessible : reconnaître
   les conditions avant l'action, si le signal est suffisamment informatif.
2. Des indices indirects et bruités : raisonner avec une incertitude explicite,
   puis vérifier les conséquences.
3. Aucun indice préalable : acquérir une observation supplémentaire, proposer
   un essai discriminant autorisé ou s'abstenir selon le risque.

La V2 n'a pas encore de stratégie dédiée pour choisir le meilleur diagnostic.
L'essai habituel n'est pas présenté comme une politique d'exploration optimale.

## La plasticité doit aussi concerner la perception

Une association entre indices et fonctionnement doit pouvoir être affaiblie,
scindée, fusionnée ou retirée. Une branche mature ne doit ni devenir
irréversible, ni être protégée en inventant un nouveau contexte à chaque échec.

Le même principe vaut pour l'encodeur : ses représentations peuvent évoluer,
avec des versions identifiables, des comparaisons contrôlées et un retour
possible à une version antérieure. Conserver un checkpoint pour reproduire
une expérience n'est pas figer pour toujours la connaissance qu'il représente.

La séparation à conserver est celle-ci : connaissances et hypothèses
révisables, autorisations et garde-fous définis par l'hôte. Une confiance
élevée ne permet jamais d'apprendre à contourner les contrôles.

## Prochaine étape proposée

Commencer par un observateur en lecture seule, sans influence sur les décisions.
Comparer ses indices aux effets ultérieurs, puis démontrer sur des données
séparées qu'ils améliorent réellement la reconnaissance des conditions.

L'activer dans la sélection des branches seulement après ce contrôle.
Les étapes V3, V4 et V5 du document transversal sont des propositions soumises
à validation, pas une liste de fonctionnalités déjà livrées.
