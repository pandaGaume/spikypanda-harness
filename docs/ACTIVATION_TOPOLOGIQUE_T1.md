# T1 : la topologie détermine les propositions

Date : 9 septembre 2026.
Statut : prototype exécutable, opt-in. Les variantes V3 et la démo navigateur restent inchangées.

## Ce qui fonctionne maintenant

Le harnais peut appeler une mémoire dont les conditions et les combinaisons
sont réellement exécutées par Core. Il n'appelle ni l'observateur V3 ni un
lookup de branches filtré par régime.

Le sample contient deux chemins qui partagent une condition :

```text
X -> condition X --+
                  +-> X ET Y -> branche a -> proposer route("a")
Y -> condition Y -+
                 |
                 +-> Y ET Z -> branche b -> proposer route("b")
Z -> condition Z -+
```

Une proposition n'est pas une action. L'arbitrage reçoit les propositions, puis
le flux passe par les contrôles existants avant une éventuelle invocation.

La fixture est construite à la main dans [examples/topology](../examples/topology/fixture.mjs).
Ses huit succès synthétiques par branche sont des données de test explicites,
pas des résultats d'apprentissage du prototype. Ses confiances initiales sont
calculées par la fonction de plasticité existante, pas définies comme des
poids définitifs.

T1 vérifie la propagation et le raccordement. La construction autonome de cette
topologie et la mise à jour de ses fiabilités restent au lot T3.

## Essayer

Depuis la racine du dépôt, avec Core déjà lié :

```sh
npm run experiment:topology
```

La commande affiche les propositions, les parcours, les compteurs internes,
puis quatre décisions prises par le harnais complet. Elle n'ouvre pas de
navigateur et ne modifie pas les sauvegardes de la démo V3.

| Entrée ou modification | Propositions | Résultat de l'arbitrage |
| --- | --- | --- |
| X=1, Y=1, Z=0 | a : 1 | a |
| X=0, Y=1, Z=1 | b : 1 | b |
| X=1, Y=1, Z=1 | a : 1, b : 1 | Conflit, repli |
| X=1, Y absent, Z=0 | Aucune | Repli |
| X=0,4, Y=1, Z=0 | a : 0,4 | Soutien insuffisant, repli |
| Première entrée, liaison Y vers XY supprimée | Aucune | Repli |
| Deux branches actives proposant toutes deux route("a") | Deux branches, une invocation | Une seule sélection |

La liaison coupée fait passer de 9 à 8 livraisons. Les 8 nœuds exécutables
restent présents : 7 nœuds sémantiques et une source technique.
L'absence de soutien se propage aussi, pour clore les convergences.

Sur le harnais complet, les quatre premiers cas exécutent respectivement
`a`, `b`, `hold`, `hold` : 4 décisions, 4 actions, 4 expériences.
Un garde qui refuse donne 0 action et 0 expérience, même si a est reconnue.
Le reset final remet les compteurs d'activation à zéro et conserve ces
4 expériences dans le journal.

`hold` est ici un repli déterministe du sample. Il n'y a pas de LLM, de
raisonnement industriel ou de mesure de rendement. L'évaluateur vérifie
simplement que la route demandée a été appliquée.

## Algorithme exact

### 1. Observation identifiée et datée

L'hôte fournit une observation publique et les identifiants
`observationId`, `decisionId`, `memoryRevision`, `schemaVersion`.
Les temps sont en secondes : mesure, disponibilité et décision.
Ils doivent être ordonnés. Une nouvelle décision utilise un temps strictement
croissant ; les apports simultanés doivent être regroupés par l'hôte.

Un doublon exactement identique du dernier passage ouvert renvoie son
résultat en cache, sans exécution. Un même apport présenté comme une autre
décision ou avec d'autres valeurs est rejeté.

Les données périmées ou d'une autre révision sont rejetées. La fraîcheur est
revérifiée après les attentes asynchrones et à la frontière d'exécution.
L'identité d'observation doit venir de l'hôte, pas être inventée pour chaque
chemin interne.

### 2. Conditions locales

Une condition numérique lit un chemin dans `state.features` et calcule :

```text
support = max(0, 1 - abs(valeur - centre) / tolérance)
```

Les conditions du sample ont centre=1 et tolérance=1.
Une mesure absente ou non numérique est inconnue, pas un zéro observé.
Une valeur non finie invalide l'enveloppe JSON.

Avec `vetoOnMismatch=true`, un support nul produit une contradiction
bloquante. Ce choix est explicite dans la définition, pas déduit d'une
absence de capteur.

### 3. Propagation et clôture

- ET : toutes les entrées déclarées sont connues, support égal à leur minimum.
- OU : au moins une entrée est connue, support égal au maximum des entrées connues.
- Une contradiction bloquante reçue annule le soutien en aval, même dans un OU.
- Un port requis non relié produit un état inconnu.
- Une branche propose seulement si son soutien courant est connu, positif et non bloqué.

Chaque liaison câblée transmet exactement un paquet de passage, même sans
soutien positif. Cela distingue « calcul terminé sans soutien » de « entrée
pas encore arrivée ». Les paquets portent identités et provenance ; un paquet
étranger ou déjà consommé est refusé.

Un passage traite chaque nœud une fois dans l'ordre topologique de Core.
Les cycles exécutables sont rejetés dans T1. Il n'y a ni récurrence, ni LIF,
ni seuil neuronal, ni spike : `spikeEvents` vaut explicitement zéro.

Les traces indiquent les nœuds et relations visités, les mesures consultées,
les absences et les blocages. La provenance d'un OU inclut ses alternatives
examinées, pas seulement l'alternative gagnante. Ce n'est pas une attribution
de mérite. Les références d'une mesure partagée sont dédupliquées.

### 4. Arbitrage

1. Toutes les branches actives participent, y compris les nouvelles.
2. Regrouper par invocation exacte : action, capacité et paramètres.
3. Le soutien d'un groupe est le maximum, jamais la somme de ses chemins.
4. Demander un soutien suffisant et une marge sur toute invocation concurrente.
5. Dans le groupe gagnant seulement, chercher une branche suffisamment fiable
   dont le propre soutien respecte ces conditions.
6. Sinon, demander le repli. Ne pas essayer successivement les actions concurrentes.

Une branche mature peu activée ne peut pas emprunter le soutien d'une branche
nouvelle pour obtenir une autorisation. Les raisons inspectables sont
`selected`, `empty`, `insufficient`, `ambiguous`, `unreliable`.

Paramètres par défaut du prototype :

| Paramètre | Valeur | Fonction |
| --- | --- | --- |
| minimumSupport | 0,6 | Applicabilité courante minimale |
| minimumMargin | 0,15 | Séparation entre invocations |
| minimumConfidence | 0,75 | Fiabilité minimale de la branche sélectionnée |
| maximumObservationAgeSeconds | 2 | Âge maximal de la mesure |
| maximumNodes / maximumEdges | 256 / 1024 | Taille de la définition |
| maximumPasses | 10 000 | Tentatives par session avant reset explicite |
| maximumNodeFirings | Nombre de nœuds exécutables | Budget d'un passage |

Ce sont des paramètres configurables de la révision expérimentale, pas des
constantes de réussite apprises. Aucun réglage optimal n'est revendiqué.

### 5. Action et journal

Les classes `TopologyLookupNode`, `TopologyGateNode` et
`TopologyExperienceRecorderNode` surchargent les nœuds du flux.
Le runtime générique et son autorité d'exécution ne sont pas modifiés.

Le repli reçoit les observations, les candidats et les échecs réels précédents.
Il pourrait être remplacé par un fournisseur LLM compatible. Ses propositions
resteraient soumises aux mêmes validations, droits, garde-fous, approbations et
contrôles de fraîcheur. Une capacité indisponible ne déclenche pas l'essai
automatique d'une autre branche.

Après une exécution autorisée et évaluée, le journal conserve le résultat,
le passage d'activation complet et son arbitrage, avec leurs identifiants.
L'arbitrage de reconnaissance reste distinct de la décision finale, qui peut
venir du repli. Ni les branches dormantes ni les branches actives ne sont
renforcées automatiquement dans T1.

Un refus avant action ne devient pas une expérience de réussite ou d'échec.
Un effet externe suivi d'une interruption ou d'un échec d'observation peut
rester sans expérience complète ; sa réconciliation appartient à l'hôte,
comme dans le harnais existant. Ce journal n'est pas une transaction distribuée.

## Où vivent la mémoire et les états ?

`TopologyMemory` contient une définition JSON immuable par révision.
Elle produit une vue de données avec `GraphBuilder` et une projection
exécutable avec `RuntimeGraphBuilder`. La définition est l'unique source de
connaissance, pas deux mémoires entraînées séparément.

`TopologyActivationSession` conserve les états locaux dans une `Session`
Core : visites, dernier signal, identités consommées, passage courant et journal.
Cette session dure plusieurs décisions. Les tampons de transport sont vidés
après chaque passage, pas les compteurs ni le journal.

Deux sessions peuvent partager les mêmes définitions exécutables sans partager
leurs états. Un reset explicite efface l'activation mais conserve le journal.
T1 n'intègre pas encore les export/import de session ou la persistance disque.

Changer une liaison ou un paramètre exige une nouvelle définition/révision
et sa compilation. Modifier directement la projection exécutable est détecté
et invalide le passage. La vue `memoryGraph` n'est pas un éditeur autorisant
des mutations à chaud. Le transfert d'états entre révisions reste hors T1.

## Vérifications et limites

Les tests dédiés se lancent avec :

```sh
npm run build
node --import ./scripts/register-spikypanda-loader.mjs --test tests/topology-activation.test.mjs tests/topology-runtime.test.mjs
```

Relevé de validation : 30 tests T1, 225 tests au total. Les 252 résultats
historiques de signaux restent identiques, vérifiés par leur empreinte de référence.

Ils vérifient les coupures et ajouts, ET/OU, contradictions, concurrence des
branches nouvelles, groupement d'invocations, permutations, doublons, clôture,
sessions partagées, révisions, limites de calcul et protections réelles.

Dans les termes du [contrat T0](ACTIVATION_TOPOLOGIQUE_CONTRAT.md) :

- TOP-01 à TOP-08, TOP-11, TOP-14 à TOP-16 ont des vérifications T1.
- TOP-12 vérifie les permutations de définition et de ports ; les livraisons
  asynchrones et l'éditeur ne sont pas des modes d'exécution de ce lot.
- TOP-09 vérifie le reset séparé du journal, pas la persistance d'un potentiel
  neuronal, encore absent.
- TOP-13 vérifie les dates, l'ordre et la péremption, pas la dynamique LIF.
- TOP-18 vérifie que des entrées identiques restent indiscernables, pas la
  généralisation à des histoires temporelles.
- TOP-10 et TOP-17, apprentissage et révision sur effets attribuables, restent à faire.

Le coût CPU n'est pas celui du seul chemin retenu : T1 parcourt tout le DAG,
valide la projection et copie la provenance. Moins de propositions ne signifie
donc pas moins de calcul. Aucune comparaison de performance avec V3 ou
LangGraph n'est publiée pour cette fixture.

Aucune dépendance n'est ajoutée. Les samples restent hors bibliothèque.
Les tests V3, leurs variantes et leurs rapports ne sont pas remplacés.

## Suite

T2 utilisera cette même topologie et les mêmes cas pour comparer une lecture
continue et une activation temporelle, puis les variantes de reset séparément.
T3 devra construire et réviser les chemins depuis les expériences, avec un
algorithme d'attribution expliqué avant implémentation. T4 raccordera la voie
retenue au banc produit et aux conditions réservées.

Ce prototype tranche une question précise : couper un chemin de mémoire
change effectivement ce qu'elle peut proposer. Il ne tranche pas encore
l'intérêt des spikes ni la capacité à apprendre cette mémoire.


Mise à jour : le [premier comparateur T2](ACTIVATION_TOPOLOGIQUE_T2.md) est
maintenant disponible. T1 et les chiffres ci-dessus restent son témoin.
Les [résultats T2](RESULTATS_TOPOLOGIE_T2.md) ne justifient pas de le remplacer.
