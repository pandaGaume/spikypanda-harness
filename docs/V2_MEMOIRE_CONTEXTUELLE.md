# V2 : mémoire conditionnelle des fonctionnements

Jalon expérimental du 8 septembre 2026, après la refactorisation
`e08a002`. Les paquets restent en version `0.1.0`. Cette V2 n'est pas une
qualification pour un système de survie ou un site de production.

## Résultat attendu et obtenu dans Counter

La mémoire distingue désormais :

- la fiabilité d'une action dans un fonctionnement appris ;
- l'applicabilité de ce fonctionnement à la situation actuelle.

Une action +1 exécutée sous l'hypothèse M1 peut révéler un autre
fonctionnement M2. Si cette attribution est confirmée, son échec appartient
au lien « M2, commande +1 », pas à la compétence « M1, commande +1 ».
La branche +1 de M1 conserve donc sa fiabilité, tout en cessant d'être rejouable
tant que M1 n'est pas reconnu comme applicable.

Au retour à M1, un effet discriminant suffit à reconnaître ce fonctionnement
déjà appris. La branche mature correspondante redevient utilisable, sous
réserve des contrôles d'exécution habituels.

Le bouton d'inversion ne modifie ni la mémoire ni l'hypothèse du runtime.
Une première erreur reste possible après un changement caché : aucun indice
ne permet alors d'anticiper ce changement.

## Architecture et points d'extension

| Élément | Rôle |
| --- | --- |
| `ContextualPolicyGraph` | Conserve les hypothèses, les expériences, leurs attributions et les compétences conditionnelles. |
| `OperatingContextTracker` | Porte l'hypothèse courante et les confirmations en attente pour un monde donné. Il est propre au runtime. |
| `EffectSignatureProvider` | Décrit une relation commande/effet à partir de données observées et immuables. C'est un service de l'hôte. |
| `ContextualPolicyLookupNode` | Surcharge la recherche V1 pour lire les compétences du fonctionnement reconnu. |
| `ContextualExperienceRecorderNode` | Surcharge l'enregistrement V1 pour attribuer l'expérience avant de réviser une compétence. |

Le runtime reste sans scénario implicite et sans `runStage`.
Les flux sont toujours construits avec `RuntimeGraphBuilder` de core.
Le graphe de mémoire est matérialisé avec `GraphBuilder`, les classes de
nœuds de mémoire et des liens de provenance explicites.

Deux runtimes peuvent partager les compétences mémorisées, mais pas leur
tracker. Une hypothèse active dans un monde ne devient pas automatiquement
active dans l'autre.

La bibliothèque ne connaît ni Counter, ni la commande +1, ni la direction du
simulateur. Le modèle de signature de Counter est défini dans
`examples/counter/contextual.mjs`. Il calcule le rapport entre le déplacement
observé et la commande exécutée, uniquement pour des effets unitaires valides.
Un effet nul, non unitaire ou un résultat d'exécution en échec est ambigu.
M1 et M2 sont créés par les observations, pas préchargés depuis le simulateur.

Le catalogue contient les douze nœuds V1 et deux spécialisations V2.
La démo Counter utilise toujours douze nœuds, en remplaçant la recherche
et l'enregistrement par leurs variantes contextuelles.

## Attribution et plasticité

L'applicabilité est un état révisable : inconnue, reconnue ou incertaine.
Ce n'est pas une probabilité calibrée ni un poids permanent.
L'éligibilité exige à la fois un fonctionnement reconnu, une compétence
assez fiable et les contrôles de sécurité.

Le comportement par défaut est le suivant :

1. Un effet correspondant à un fonctionnement connu réactive son hypothèse.
2. Un effet inédit ouvre une attribution en attente. Il ne modifie pas encore
   le score de la compétence précédemment supposée.
3. Deux effets inédits consécutifs et cohérents, dans le même contexte de base,
   confirment une nouvelle hypothèse. Les expériences en attente lui sont
   alors attribuées, avec leurs succès et leurs échecs réels.
4. Si la confirmation est interrompue, les expériences concernées sont
   attribuées provisoirement à l'hypothèse précédente comme anomalies, quand
   cette hypothèse existe. Leurs échecs diminuent alors sa fiabilité.
5. En l'absence d'hypothèse antérieure, une expérience ambiguë reste non
   résolue. Elle n'est pas transformée en preuve de compétence.

Chaque expérience conserve l'hypothèse avant action, la signature observée
et l'historique ordonné de ses attributions. Les statuts sont `pending`,
`confirmed`, `anomaly`, `unresolved` et `revised`.
L'état courant correspond à la dernière révision, sans effacer les précédentes.

`policy.attribute(id, "revised", modeId, reason)` permet une correction
explicite par l'hôte. Les statistiques sont alors reconstruites à partir des
attributions courantes, dans l'ordre du journal : une expérience retirée de
M1 n'y laisse pas son ancienne pénalité. Ce mécanisme ne prétend pas découvrir
automatiquement la bonne attribution de tous les événements ambigus.

Les règles EMA et les bornes de plasticité V1 sont conservées, séparément
pour chaque contexte de fonctionnement et chaque invocation.
Les compteurs d'audit ne deviennent jamais des poids cumulatifs.
Un test couvre 10 000 succès suivis d'évaluations négatives, y compris avec
un effet correspondant au fonctionnement connu : le rejeu est désactivé
dans un nombre borné d'observations.

La nouveauté exige au moins deux confirmations. Le nombre de fonctionnements
est plafonné à huit par contexte de base par défaut. Ces paramètres sont
validés et persistés. Une fois le plafond atteint, les anomalies ne créent
plus de contextes pour soustraire indéfiniment une compétence à la critique.

Une expérience en attente à la fin d'une exécution peut rester en attente
dans le journal. Elle n'autorise pas pour autant un rejeu : l'applicabilité
est alors incertaine. La V2 ne comporte ni expiration temporelle ni compaction
du journal.

## Relations de mémoire et interface

Les compétences utilisent des clés de contexte comprenant l'identifiant du
fonctionnement. Les expériences restent accompagnées de leur contexte observé
initial ; l'attribution est une information distincte, révisable.

Le snapshot contient des relations explicites :

- fonctionnement vers contexte conditionnel ;
- expérience vers situation observée et action exécutée ;
- expérience vers hypothèse supposée avant l'action ;
- expérience vers fonctionnement attribué ;
- expérience vers hypothèse contredite par l'effet observé.

Ces relations sont reconstruites à partir du journal canonique et matérialisées
en liens de core. La restauration vérifie que les relations enregistrées
correspondent bien aux expériences. Les scores de compétence sont eux aussi
vérifiés contre leur reconstruction.

L'interface affiche les fonctionnements, les contextes, les actions et les
capacités. Une branche peut afficher une fiabilité élevée et être « en sommeil » :
elle n'est pas applicable actuellement, mais sa compétence n'a pas été oubliée.

Quatre expériences récentes sont dessinées, douze sont sélectionnables, et
toutes sont conservées. La sélection fait apparaître les liens de provenance
correspondants. Une expérience plus ancienne sélectionnée peut également être
ajoutée au dessin. Les valeurs affichées sont les statistiques actuelles,
pas une reconstitution des anciens scores.

## Persistance et migration

Le document de harnais reste en version 1 : les types des deux nœuds
spécialisés identifient le flux V2. Dans la démo Counter, le chargement d'un
graphe V1 remplace ces deux types en mémoire, sans changer les positions,
les liens ni les fichiers sauvegardés.

Le snapshot de mémoire V2 est en version 2. Il contient les données de policy,
les modes, l'identifiant du modèle de signature, sa configuration, les
attributions révisées et les relations de provenance.

Utiliser `ContextualPolicyGraph.restore(snapshot)` pour une mémoire V2.
Un snapshot V1 peut être importé avec
`ContextualPolicyGraph.restore(snapshot, modelId)`.
Ses expériences et ses scores sont conservés comme historique non attribué.
Aucun fonctionnement n'est inventé rétroactivement et ces anciens scores
ne sont pas transférés vers une compétence conditionnelle.

Après restauration, un nouveau tracker repart avec une applicabilité inconnue.
Les compétences restent mémorisées, mais un effet observé doit reconnaître
le fonctionnement avant leur rejeu. Le service de signature doit être fourni
par l'hôte avec le même identifiant de modèle ; aucune fonction n'est sérialisée.

Une trace V2 peut avoir `transitionAfter` absent lorsqu'aucune compétence
n'est encore attribuée. Les consommateurs doivent traiter explicitement ce
cas, au lieu d'afficher un faux score initial.

## Validation

Commandes : `npm test`, `npm run test:bundle`,
`npm run experiment:counter` et `npm run demo`.

Les tests V1 sont conservés, notamment la comparaison exacte avec la trace
de référence du commit `da8f9f5`. La suite V2 couvre A → B → A → B,
les anomalies, l'ambiguïté, le plafond de modes, les corrections d'attribution,
la migration, les imports corrompus, l'isolation des trackers, la fidélité
de la projection et les contrôles d'exécution.

Counter V2 produit 25 épisodes réussis sur A → B → A → B :

| Phase notable | Actions | Appels au raisonneur |
| --- | --- | --- |
| Démarrage, épisode 1 | 3 | 3 |
| Première découverte de B, épisode 11 | 5 | 3 |
| Retour à A, épisode 16 | 5 | 0 |
| Retour à B, épisode 21 | 5 | 0 |

Les autres épisodes demandent trois actions sans raisonneur.
Total : 81 actions, dont 75 décisions de mémoire et 6 appels au raisonneur.
Les épisodes de changement contiennent une action sans progrès ; leur réussite
signifie que la cible est finalement atteinte.

Le navigateur a également été vérifié sur mémoire vide, première attribution
en attente, découverte de M1 puis M2 et retour à M1 sans appel supplémentaire
au raisonneur. La sauvegarde préexistante a été restaurée sans être réécrite.
Le lanceur conserve son port fixe 4175.

## Limites à ne pas masquer

Il s'agit d'une reconnaissance de signatures exactes choisies par l'hôte,
pas d'un apprentissage général de représentations latentes.
Les modes sont isolés par identifiant d'état, intention et paramètres :
aucun transfert automatique de compétence entre objectifs n'est revendiqué.

Une anomalie ressemblant exactement à un fonctionnement déjà connu peut
faire basculer temporairement l'applicabilité. Le test correspondant le
montre. Deux anomalies cohérentes peuvent aussi confirmer une hypothèse
erronée. Les confirmations et le plafond limitent la prolifération, ils
ne prouvent pas une robustesse universelle au bruit.

L'hypothèse courante ne remplace pas les garde-fous. Permissions, approbation
fraîche, fraîcheur de l'observation, annulation et validation des arguments
restent hors apprentissage. Le code hôte reste de confiance et les opérations
distantes ne sont pas transactionnelles.

Aucun LLM réel ni modèle industriel continu n'a été ajouté. HELIOS reste
le scénario illustratif V1, avec les limites décrites dans le bilan historique.
