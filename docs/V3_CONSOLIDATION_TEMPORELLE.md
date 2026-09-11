# V3 : consolidation temporelle, indépendante des spikes

9 septembre 2026. Variante expérimentale : `harness-v3-consolidated`.

## Décision et périmètre

Une hypothèse momentanée n'est pas encore un régime durable. Cette étape
sépare sa persistance de la confiance dans une action et de la reconnaissance
par les indices. Aucun neurone, spike, CNN ou nouveau fournisseur n'est ajouté.

La V2, la V3 en observation seule et la V3 active historique restent disponibles
sans consolidation temporelle. Le nouveau comparateur utilise exactement le
même graphe V3 actif, le même observateur et les mêmes seuils de reconnaissance.
Seule la politique de consolidation des effets observés change.

Le navigateur Counter conserve son comportement précédent. Le nouveau
comportement se teste sur le banc de production ; les sauvegardes existantes
ne sont pas migrées silencieusement.

## Mécanisme

`consolidation.ts` expose une transition pure, sans connaissance du simulateur,
du métier, d'un embedding ou d'un modèle de spikes.

Pour chaque contexte et intention, le tracker conserve localement une fenêtre
candidate : signature de réponse, premier instant, dernier instant et nombre
d'observations. Une nouvelle branche durable demande simultanément :

1. des signatures commande/effet identiques selon l'encodeur du sample ;
2. un nombre minimal d'observations ;
3. une durée minimale entre la première et la dernière ;
4. aucun intervalle entre observations dépassant la tolérance déclarée.

Un changement de signature, une ambiguïté ou une interruption explicitement
signalée par l'hôte termine la fenêtre. Les expériences abandonnées prennent le
statut `transient`. Elles restent auditables, mais ne créent ni branche,
ni score d'action, ni exemple étiqueté pour l'observateur.

Un effet nul/non attribuable reste `unresolved`, sans imputation automatique à
l'ancien régime. Un refus de commande, un délai d'actionneur ou une mesure
manquante du banc interrompt la fenêtre, sans fabriquer une expérience causale.

Une signature déjà consolidée peut être reconnue immédiatement à partir d'un
nouvel effet observé : le retour à un acquis n'exige pas un nouvel apprentissage.
Cette étape ne change pas la règle pré-action de la V3, qui peut toujours
recourir au raisonneur si ses indices sont ambigus.

## Acquis, activation et résultat

- La fenêtre en cours appartient au tracker d'un runtime, pas à la mémoire partagée.
- Une restauration ne reprend ni hypothèse active ni fenêtre inachevée.
- Une branche durable conserve la liste des expériences qui ont justifié sa création.
- Les signatures des anciennes traces transitoires ne sont pas réattribuées
  automatiquement si un régime de même signature devient durable plus tard.
- Une observation ultérieure d'un régime connu continue d'actualiser sa fiabilité.
- Un régime durable peut être mauvais : consolidation ne signifie pas réussite.
- Une expérience réellement négative dans son régime connu peut toujours
  démobiliser une action mature. Il n'existe pas de poids de réussite définitif.

Les règles de sécurité et d'autorisation ne changent pas. L'attente de
consolidation n'autorise pas le maintien d'une commande dangereuse.

## Paramètres et horloge

| Paramètre | Bibliothèque, exemple par défaut | Sample production |
| --- | --- | --- |
| minimumObservations | 6 | 6 |
| minimumDurationMs | 5000 | 10000 |
| maximumGapMs | 2000 | 2000 |
| maximumPendingObservations | 128 | 128 |

Ces valeurs sont des choix expérimentaux explicites, pas une définition
universelle de la stabilité. Dans le sample, les observations sont espacées
d'une seconde simulée. Dix secondes de durée exigent donc au moins onze
observations contiguës, même si le minimum déclaré est six.

Le temps est `observedAt`, fourni par l'horloge de l'hôte. Pour le banc, il
vient de `timeSeconds`, jamais du temps CPU. Des observations répétées au même
instant ne créent aucune durée. Un retour de l'horloge en arrière est rejeté
avant l'ajout d'une expérience à la mémoire.

Le nombre d'expériences candidates est borné. Si une fenêtre en attente
atteint sa capacité, elle est terminée sans consolidation et une autre
commence. Un flux trop dense exige un réglage adapté ou un agrégateur en amont.
La rétention de toutes les traces du harnais reste, elle, un sujet distinct.

La configuration et les preuves de consolidation sont sérialisées avec la
mémoire. La restauration contrôle signatures, contexte, instants, durée,
nombre de preuves et intervalles. Les instantanés V2/V3 historiques sans
cette configuration gardent leur ancienne sémantique.

## Lancer et inspecter

```sh
npm run benchmark:production -- --controller harness-v3-consolidated --scenario nominal --seed 101 --out dist/benchmarks
npm run benchmark:production -- --controller harness-v3-consolidated --seed 101 --out dist/benchmarks
npm run test:benchmark:harness
npm test
```

Le rapport inclut la configuration, les nombres d'attributions par statut et
les compteurs de décision. Avec `--traces`, chaque pas expose aussi l'état de
la fenêtre. Les rapports sont créés sous un nouveau nom, sans écrasement.

L'adaptateur accepte également une option `consolidation` pour comparer des
horizons sans changer l'observateur. La réparation du filtre d'extensions du
collecteur d'empreintes rend désormais effectifs les hashes des fichiers JS
compilés du core et du harnais ; les anciens rapports peuvent ne pas les avoir.

## Ce que le brief du détecteur de bascule apporte

Le brief utilisateur sur `regime_switch_detector.py` distingue mouvement,
persistance et alarme sur front montant. Son portage existe déjà dans le dépôt
SpikyPanda : `packages/dev/plugins/ml/src/detect/motion.ts` et son nœud
`ML.Detect:motion`. La note `docs/regime_detection_deux_canaux.md` décrit sa
complémentarité avec le détecteur par position. Ces sources ont été inspectées,
mais leurs anciennes campagnes n'ont pas été réexécutées ici.

Trois enseignements sont directement utiles :

- une mesure instantanée ne décrit pas une dynamique ;
- une oscillation peut avoir un déplacement net nul tout en gardant une
  longueur de chemin importante sur une fenêtre ;
- un événement de bascule ne doit pas être recréé à chaque observation
  du même état persistant.

La présente étape ne réimplémente ni ne branche MotionWatch. Elle traite
l'admission en mémoire durable, pas l'extraction de signatures de mouvement.
Le portage existant pourra être évalué séparément comme producteur d'indices,
sans le confondre avec une décision de consolidation ou une autorisation d'action.

Une référence fixe de mesure peut aider à voir une dérive ; elle ne doit pas
être confondue avec une confiance de réussite immuable. Le warmup supposé sain
du détecteur n'est pas une hypothèse ajoutée à la consolidation V3.

Enfin, une alarme qui nomme un canal atypique n'établit pas à elle seule la cause
physique d'une panne. Le brief rapporte six graines et zéro faux positif sur
son banc ; ces résultats ne qualifient ni tous les moteurs ni notre harnais.
La note du dépôt corrige aussi son diagnostic de câblage PMSM : ne pas appliquer
la réparation d'arête proposée dans l'ancien brief sans revérification.

## Limites à garder visibles

La signature de réponse du sample reste discrétisée. Cette étape n'apprend
pas encore une trajectoire, une relation dynamique continue ni une classe
d'oscillations. Un transitoire assez long peut toujours être consolidé ;
une signature trop bruitée peut ne jamais l'être.

La V3 ne sait toujours apprendre une métrique discriminante qu'à partir de
deux régimes suffisamment documentés. Avec un seul régime, elle utilise son
chemin `learning -> effect-history`. Un gain sur le nominal dans cette
situation est un effet du nettoyage des régimes mémorisés, pas une amélioration
de la reconnaissance par les capteurs.

La saturation de la capacité des régimes ne permet pas d'attribuer
artificiellement le nouveau fonctionnement à un ancien. Elle maintient
l'incertitude et le recours au raisonneur. Les traces restent disponibles
pour une réévaluation explicite.

Aucun résultat de cette étape ne démontre une généralisation. La sensibilité
à l'horizon, les changements lents, le retour de régimes et les variations
réservées restent des critères de comparaison.

## Résultats de cette étape

Voir [la campagne comparative et la sensibilité à la durée](RESULTATS_CONSOLIDATION_V3.md).
