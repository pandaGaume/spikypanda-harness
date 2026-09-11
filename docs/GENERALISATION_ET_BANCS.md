# Généralisation : ce que le banc ne doit pas nous faire oublier

État du 9 septembre 2026. Orientation transversale, pas capacité déjà validée.

## Le banc est un instrument, pas le domaine du produit

Le banc de production actuel contient dix familles de perturbations. Ses graines
font varier le bruit, l'ambiance et le moment des incidents. Il utilise des états
numériques continus, mais une physique synthétique intégrée par pas d'une seconde,
quatre commandes et un horizon fini. C'est un échantillon de comportements.

Réussir ces 330 cas ne signifie ni comprendre tous les systèmes de production,
ni généraliser à une panne nouvelle. Des graines nouvelles ne créent pas à elles
seules des familles de phénomènes nouvelles. Les trois jeux actuels sont publics
et partagent les mêmes familles. Leur nom « évaluation » ne les rend pas aveugles.

Nous voulons un harnais réutilisable, pas un contrôleur spécialisé qui reconnaît
les dix scénarios de notre démonstration. Le simulateur et les cas restent hors
de la bibliothèque. Aucun numéro de scénario, phase cachée, graine ou préfixe
d'action indiquant la bonne stratégie n'entre dans les observations.

## Deux instruments complémentaires

Un corpus fixe sert à comparer des révisions sur une base stable et à détecter
les régressions. Il reste utile et doit être conservé.

Un générateur d'environnements paramétrés doit explorer un domaine déclaré :
intensité, vitesse de dérive, durée, ordre et combinaison des perturbations,
délais, bruit, informations manquantes, état initial et charge. Chaque tirage
reste reproductible et identique pour les concurrents, sans fournir sa vérité
cachée au contrôleur. Une exploration reproductible n'est pas un catalogue fermé.

Le générateur actuel ne couvre qu'une petite partie de ces axes. La génération
des intensités, des combinaisons réservées, des longues trajectoires et des autres
systèmes reste à implémenter. Changer les plages après lecture des résultats
impose une nouvelle campagne pour tous, pas une amélioration rétroactive du score.

## Niveaux d'évidence séparés

| Niveau | Question | Réserve nécessaire | État actuel |
| --- | --- | --- | --- |
| Régression | La nouvelle version conserve-t-elle les acquis ? | Cas fixes connus. | Instrument et adaptateurs V1/V2/V3 livrés ; premier corpus seulement. |
| Interpolation | Réussit-elle entre les conditions d'apprentissage ? | Intensités et durées non utilisées au réglage, dans les mêmes plages. | Non mesuré. |
| Composition | Réutilise-t-elle des acquis combinés autrement ? | Combinaisons et ordres entiers absents du réglage, pas seulement nouvelles graines. | Non mesuré. |
| Extrapolation | Que se passe-t-il au-delà des conditions connues ? | Plages de sévérité, de délai et de bruit hors apprentissage. | Non mesuré. |
| Continuité | Reste-t-elle plastique sur une longue histoire changeante ? | Longues trajectoires, retours, dérives et ruptures sans remise à zéro. | Non mesuré hors du petit sample. |
| Transfert | Le même mécanisme sert-il dans un autre système ? | Autre modèle physique, autre objectif ou autre espace d'actions. | Non mesuré. |

La récupération face à une nouveauté et l'abstention justifiée comptent aussi.
Aucun système ne peut anticiper une rupture réellement inobservable. L'absence
d'indice préalable doit être distinguée d'une occasion de reconnaissance manquée.

## Ce que nous réservons avant de régler les candidats

La séparation doit porter sur les facteurs générateurs, les combinaisons et les
familles, pas seulement sur des seeds. Déclarer pour chaque campagne :

- Les environnements utilisables pour développer et régler les architectures.
- Les plages et combinaisons réservées à l'évaluation.
- Le protocole de mémoire : à froid, préentraînée, restaurée ou apprentissage continu.
- Les budgets de raisonnement, d'apprentissage et de réglage de chaque candidat.
- Les versions du générateur, du simulateur, du contrôleur, des métriques et des modèles.
- Les critères de service et les situations dont la faisabilité n'est pas établie.

Un résultat qui sert ensuite au réglage devient une donnée de développement.
Une nouvelle réserve est nécessaire pour une nouvelle revendication d'évaluation.
L'apprentissage en ligne peut rester autorisé pendant une épreuve ; il doit être
le même droit pour tous, avec son coût compté, sans mise à jour manuelle cachée.

Le transfert du mécanisme et le transfert d'une mémoire sont deux expériences :
le premier change l'adaptateur métier en gardant le moteur et ses règles génériques ;
le second tente aussi de réutiliser les acquis. Dans les deux cas, déclarer
ce qui a été changé et le temps d'intégration nécessaire.

## Mesures qui rendent visibles les limites

Garder production, contraintes, énergie, délais, échecs et coût de raisonnement.
Les publier par famille et par plage de difficulté, avec effectifs et quantiles,
pas seulement sous la forme d'une moyenne de tous les cas.

Ajouter aux campagnes futures :

- Courbes de qualité et de coût selon la sévérité, le bruit et le délai.
- Écart entre conditions vues et réservées, à tâches et budgets comparables.
- Temps et nombre d'expériences nécessaires après une nouveauté.
- Coût d'un retour connu et perte éventuelle d'un acquis antérieur.
- Erreurs de rappel, abstentions et fiabilité des décisions dites réutilisables.
- Croissance de mémoire et temps de recherche sur de longues trajectoires.
- Effort d'adaptation à un second système, sans modifications du cœur.

La confiance interne n'est pas automatiquement une probabilité calibrée de succès.
Ne pas lui appliquer un score probabiliste sans définir l'événement prédit,
l'horizon et une calibration vérifiable. Séparer la fiabilité d'une compétence
et son applicabilité au contexte, comme dans la V2.

Les pires cas observés sont utiles, mais ne sont pas une garantie sur les pires
cas possibles. Une recherche ciblée de contre-exemples peut compléter les tirages ;
son budget doit être identique pour les concurrents, ses résultats conservés,
et sa campagne identifiée séparément d'un échantillonnage représentatif.

## Conséquence pour notre décision produit

Une victoire sur le seul corpus fixe ne suffit pas à décider de conserver le
harnais. L'avantage recherché doit survivre à des variations réservées pertinentes
et à un coût d'adaptation acceptable. Le domaine utile et le gain minimal restent
à convenir ; il ne s'agit pas d'exiger une généralisation universelle.

Si LangGraph ou une solution plus simple répond mieux à ces exigences, nous
devons pouvoir l'adopter, garder seulement la partie différenciante, ou abandonner
le harnais. L'échec sur un scénario artificiellement impossible ne prouve pas
non plus qu'une architecture est mauvaise : il faut établir ce qui était
observable et physiquement faisable.

Les graphes V1/V2/V3 sont désormais raccordés au contrat public.
Priorité : élargir le générateur
selon ces réserves, puis introduire un second système avant une conclusion de
généralisation. Le premier banc demeure la référence de régression. Les poids,
les représentations et les hypothèses apprises restent révisables.

Voir le [protocole de production](BENCHMARK_PRODUCTION_V1.md).
